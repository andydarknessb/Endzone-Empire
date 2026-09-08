const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const pool = require("../modules/pool");
const { signToken } = require("../modules/auth");
const playerRouter = require("../routes/player.router");
const irPolicy = require("../services/irPolicy.service");
const { draftRosterSize } = require("../services/rosterShape");

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "player-browser-availability-route-test-secret";
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use("/api/players", playerRouter);

test("GET players returns league-authoritative availability without disclosing a rival team", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    const text = String(sql);
    if (text.startsWith('SELECT * FROM "teams"')) {
      return {
        rows: [
          {
            id: 17,
            league_id: 1,
            owner_id: 7,
            faab_remaining: 82,
            waiver_priority: 3,
          },
        ],
      };
    }
    if (text.startsWith('SELECT * FROM "leagues"')) {
      return {
        rows: [
          {
            id: 1,
            name: "Sunday Ballers",
            roster_limit: 14,
            waiver_type: "faab",
            current_season: 2026,
          },
        ],
      };
    }
    if (text.includes('FROM "players" AS "source"')) {
      return {
        rows: [
          {
            id: 1,
            name: "Free Agent",
            position: "RB",
            nfl_team: "ATL",
            total_count: "4",
            identity_ids: [1],
          },
          {
            id: 2,
            name: "Rival Player",
            position: "WR",
            nfl_team: "DAL",
            total_count: "4",
            identity_ids: [2],
          },
          {
            id: 3,
            name: "Waiver Player",
            position: "TE",
            nfl_team: "KC",
            total_count: "4",
            identity_ids: [3],
          },
          {
            id: 4,
            name: "My Player",
            position: "QB",
            nfl_team: "NYJ",
            total_count: "4",
            identity_ids: [4, 44],
          },
        ],
      };
    }
    if (
      text.includes('FROM "nfl_games"') ||
      text.includes('FROM "player_season_stats"')
    )
      return { rows: [] };
    if (text.includes('COUNT(*)::int AS "roster_count"'))
      return { rows: [{ roster_count: 1 }] };
    if (text.includes('FROM "team_players"')) {
      return {
        rows: [
          { team_id: 99, player_id: 2 },
          { team_id: 17, player_id: 44 },
        ],
      };
    }
    if (text.includes('FROM "waiver_players"')) {
      return {
        rows: [{ player_id: 3, available_at: "2026-09-01T00:00:00.000Z" }],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players?leagueId=1")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.players.map(({ id, availability }) => ({ id, availability })),
    [
      { id: 1, availability: { state: "free_agent" } },
      { id: 2, availability: { state: "rostered" } },
      {
        id: 3,
        availability: {
          state: "waivers",
          availableAt: "2026-09-01T00:00:00.000Z",
        },
      },
      { id: 4, availability: { state: "my_team" } },
    ],
  );
  assert.equal(res.body.context.rosterCount, 1);
  assert.equal(res.body.context.rosterCapacity, 14);
  assert.equal(res.body.context.faabRemaining, 82);
  assert.equal(
    JSON.stringify(res.body.players[1].availability).includes("99"),
    false,
  );
});

// The Player Browser's league context is scoped to the viewer's own team
// (rosterCount is that team's count), so the capacity it publishes is that
// team's enforced roster capacity: irPolicy.rosterCapacity, never the
// IR-inclusive league.roster_limit column. These two cases pin the published
// number to the enforcement math so the display and the gate cannot drift.

// Shared fake pool for the capacity cases below. `irSlots` and `stashCount`
// drive the two arms; every other query mirrors the availability test above so
// the handler reaches the context block with a 200. `stashCount` answers the
// irPolicy stash count query (COUNT(*)::int AS n) directly, standing in for
// however many valid IR stashes the team currently holds.
function capacityPool(t, { rosterLimit, irSlots, stashCount, leagueRow }) {
  return t.mock.method(pool, "query", async (sql) => {
    const text = String(sql);
    if (text.startsWith('SELECT * FROM "teams"')) {
      return {
        rows: [
          {
            id: 17,
            league_id: 1,
            owner_id: 7,
            faab_remaining: 82,
            waiver_priority: 3,
          },
        ],
      };
    }
    if (text.startsWith('SELECT * FROM "leagues"')) {
      return { rows: [leagueRow] };
    }
    // The irPolicy stash count. Only reached when ir_slots > 0, which is why
    // both cases below set irSlots to a positive number: at 0 rosterCapacity
    // short-circuits to draftRosterSize with no read and proves nothing.
    if (text.includes("COUNT(*)::int AS n")) {
      return { rows: [{ n: stashCount }] };
    }
    if (text.includes('FROM "players" AS "source"')) {
      return {
        rows: [
          {
            id: 1,
            name: "Free Agent",
            position: "RB",
            nfl_team: "ATL",
            total_count: "1",
            identity_ids: [1],
          },
        ],
      };
    }
    if (
      text.includes('FROM "nfl_games"') ||
      text.includes('FROM "player_season_stats"')
    )
      return { rows: [] };
    if (text.includes('COUNT(*)::int AS "roster_count"'))
      return { rows: [{ roster_count: 1 }] };
    if (text.includes('FROM "team_players"')) return { rows: [] };
    if (text.includes('FROM "waiver_players"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

test("GET players publishes draftRosterSize, not roster_limit, when IR slots are unfilled", async (t) => {
  // ir_slots > 0 with nothing stashed: rosterCapacity runs the count query
  // (returns 0) and lands on base = draftRosterSize = 16 - 2 = 14. The old
  // code published roster_limit (16). The two differ precisely because an IR
  // slot is empty, which is the whole defect.
  const leagueRow = {
    id: 1,
    name: "Sunday Ballers",
    roster_limit: 16,
    ir_slots: 2,
    waiver_type: "faab",
    current_season: 2026,
  };
  capacityPool(t, {
    rosterLimit: 16,
    irSlots: 2,
    stashCount: 0,
    leagueRow,
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players?leagueId=1")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(draftRosterSize(leagueRow), 14);
  assert.equal(leagueRow.roster_limit, 16);
  // Red-tell: restoring the direct `league.roster_limit` read publishes 16
  // and turns this assertion red.
  assert.equal(res.body.context.rosterCapacity, 14);
  assert.notEqual(res.body.context.rosterCapacity, leagueRow.roster_limit);
});

test("GET players publishes exactly what irPolicy.rosterCapacity enforces for the same league row", async (t) => {
  // One valid stash filling one of two IR slots: enforced capacity is
  // 14 + min(2, 1) = 15, still below the IR-inclusive limit of 16.
  const leagueRow = {
    id: 1,
    name: "Sunday Ballers",
    roster_limit: 16,
    ir_slots: 2,
    waiver_type: "faab",
    current_season: 2026,
  };
  capacityPool(t, {
    rosterLimit: 16,
    irSlots: 2,
    stashCount: 1,
    leagueRow,
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players?leagueId=1")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Bound to the enforcement function itself, on the SAME league row and the
  // same viewer team (id 17), against the same fake pool. Not a literal: if
  // the enforcement math changes, the published number must move with it or
  // this fails. That is what stops the display and the gate drifting apart.
  const enforced = await irPolicy.rosterCapacity(pool, {
    league: leagueRow,
    teamId: 17,
  });
  assert.equal(res.body.context.rosterCapacity, enforced);
  assert.notEqual(res.body.context.rosterCapacity, leagueRow.roster_limit);
});

test("GET players on a NULL roster_limit legacy row publishes the enforced number, not a null passthrough", async (t) => {
  // A legacy row can carry roster_limit = null (#70). The old context read
  // published null on this row, so the browser rendered "-". Enforcement does
  // not: irPolicy.rosterCapacity runs draftRosterSize, which is 0 by design on
  // a null limit, so the gate would allow 0 here. Publishing null would put
  // the display back out of step with the gate on a case nobody had examined,
  // which is the exact divergence #945 exists to remove. So the context now
  // publishes the enforced 0. ir_slots is 0, so this is the shortcut path
  // (draftRosterSize with no read) that a null legacy row realistically hits.
  const leagueRow = {
    id: 1,
    name: "Legacy League",
    roster_limit: null,
    ir_slots: 0,
    waiver_type: "faab",
    current_season: 2026,
  };
  capacityPool(t, {
    rosterLimit: null,
    irSlots: 0,
    stashCount: 0,
    leagueRow,
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players?leagueId=1")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const enforced = await irPolicy.rosterCapacity(pool, {
    league: leagueRow,
    teamId: 17,
  });
  assert.equal(res.body.context.rosterCapacity, enforced);
  assert.equal(res.body.context.rosterCapacity, 0);
  // The deliberate behaviour change: no longer null. Documents F1.
  assert.notEqual(res.body.context.rosterCapacity, null);
});
