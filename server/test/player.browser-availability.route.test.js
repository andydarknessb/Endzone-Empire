const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const pool = require("../modules/pool");
const { signToken } = require("../modules/auth");
const playerRouter = require("../routes/player.router");

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
