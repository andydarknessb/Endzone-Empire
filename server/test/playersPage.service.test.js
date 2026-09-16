const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readPlayersPage, PlayersPageError } = require('../services/playersPage.service');
const irPolicy = require('../services/irPolicy.service');
const { draftRosterSize } = require('../services/rosterShape');
const { holdKickedOffPlayers } = require('../services/waiver.service');
const { createFakePool, select } = require('./helpers/fakePool');

// The Players page module test (#1497, parent spec #1490): the assertions
// that used to live in player.browser-availability.route.test.js, driven
// through `readPlayersPage` directly instead of supertest, with the same
// fixtures - now expressed as the shared fake-pool helper's matcher tables
// and passed straight in as `{ db }`, no module import mocked.

function baseQuery(overrides = {}) {
  return {
    userId: 7,
    page: 1,
    requestedPositions: null,
    search: '',
    leagueId: null,
    availableOnly: false,
    availability: null,
    view: null,
    byeWeeksFilter: [],
    sortField: null,
    dir: 'ASC',
    ...overrides,
  };
}

test('readPlayersPage returns league-authoritative availability without disclosing a rival team', async () => {
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({
      rows: [{ id: 1, name: 'Sunday Ballers', roster_limit: 14, waiver_type: 'faab', current_season: 2026 }],
    })],
    [/FROM "players" AS "source"/, () => ({
      rows: [
        { id: 1, name: 'Free Agent', position: 'RB', nfl_team: 'ATL', total_count: '4', identity_ids: [1] },
        { id: 2, name: 'Rival Player', position: 'WR', nfl_team: 'DAL', total_count: '4', identity_ids: [2] },
        { id: 3, name: 'Waiver Player', position: 'TE', nfl_team: 'KC', total_count: '4', identity_ids: [3] },
        { id: 4, name: 'My Player', position: 'QB', nfl_team: 'NYJ', total_count: '4', identity_ids: [4, 44] },
      ],
    })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 1 }] })],
    [/FROM "team_players"/, () => ({
      rows: [
        { team_id: 99, player_id: 2 },
        { team_id: 17, player_id: 44 },
      ],
    })],
    [/FROM "waiver_players"/, () => ({
      rows: [{ player_id: 3, available_at: '2026-09-01T00:00:00.000Z' }],
    })],
  ]);

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake });

  assert.deepEqual(
    result.players.map(({ id, availability }) => ({ id, availability })),
    [
      { id: 1, availability: { state: 'free_agent' } },
      { id: 2, availability: { state: 'rostered' } },
      { id: 3, availability: { state: 'waivers', availableAt: '2026-09-01T00:00:00.000Z' } },
      { id: 4, availability: { state: 'my_team' } },
    ],
  );
  assert.equal(result.context.rosterCount, 1);
  assert.equal(result.context.rosterCapacity, 14);
  assert.equal(result.context.faabRemaining, 82);
  assert.equal(JSON.stringify(result.players[1].availability).includes('99'), false);
});

// #1375, ADR 0043: run the scheduler's kickoff waiver tick, then read the
// Players page for the same league against the same stateful world. Both the
// tick (`holdKickedOffPlayers`, which always reads/writes the shared pool -
// it takes no `db` parameter) and `readPlayersPage` must see the same
// fixture, so the fake is installed onto the shared pool (`fake.install(t)`)
// rather than injected only into this call.
test('kickoff waiver hold seam: the scheduler tick, then readPlayersPage, against the same world (#1375)', async (t) => {
  const league = {
    id: 1,
    name: 'Kickoff League',
    roster_limit: 14,
    waiver_type: 'faab',
    current_season: 2026,
    current_week: 2,
    waiver_period_hours: 24,
  };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' },
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' },
  ];
  const players = [
    { id: 1, name: 'Kicked Off', position: 'RB', nfl_team: 'KC', total_count: '3', identity_ids: [1] },
    { id: 2, name: 'Not Yet', position: 'WR', nfl_team: 'DAL', total_count: '3', identity_ids: [2] },
    { id: 3, name: 'Bye Team', position: 'TE', nfl_team: 'MIA', total_count: '3', identity_ids: [3] },
  ];
  const waiverRows = []; // the one waiver_players table both the tick and the read share

  const fake = createFakePool([
    [/^SELECT "id", "current_season", "current_week", "waiver_period_hours"/, () => ({ rows: [league] })],
    [/^SELECT "nfl_team" FROM "nfl_games" WHERE "season" = \$1 AND "week" = \$2 AND "kickoff_at" <= \$3/, (text, params) => {
      const [season, week, now] = params;
      return {
        rows: nflGames
          .filter((g) => g.season === season && g.week === week && new Date(g.kickoff_at) <= new Date(now))
          .map((g) => ({ nfl_team: g.nfl_team })),
      };
    }],
    [/^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/, (text, params) => {
      const [season, week] = params;
      return {
        rows: nflGames
          .filter((g) => g.season === season && g.week === week)
          .map((g) => ({ nfl_team: g.nfl_team, kickoff_at: g.kickoff_at })),
      };
    }],
    [/^SELECT "players"\."id", "players"\."nfl_team"/, () => ({
      rows: players.map((p) => ({ id: p.id, nfl_team: p.nfl_team })),
    })],
    [/^INSERT INTO "waiver_players"/, (text, params) => {
      const [leagueId, playerId, availableAt] = params;
      const resolved = new Date(availableAt).toISOString();
      const existing = waiverRows.find((r) => r.league_id === leagueId && r.player_id === playerId);
      if (existing) {
        if (new Date(resolved) > new Date(existing.available_at)) existing.available_at = resolved;
      } else {
        waiverRows.push({ league_id: leagueId, player_id: playerId, available_at: resolved });
      }
      return { rows: [] };
    }],
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({
      rows: waiverRows.map((r) => ({ player_id: r.player_id, available_at: r.available_at })),
    })],
  ]);
  fake.install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });
  assert.equal(held, 1, "only the kicked-off team's unrostered player is held");

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }));

  assert.deepEqual(
    result.players.map(({ id, availability }) => ({ id, availability })),
    [
      { id: 1, availability: { state: 'waivers', availableAt: '2026-09-16T23:15:00.000Z' } },
      { id: 2, availability: { state: 'free_agent' } },
      { id: 3, availability: { state: 'free_agent' } },
    ],
  );
});

// The Players page's league context is scoped to the viewer's own team
// (rosterCount is that team's count), so the capacity it publishes is that
// team's enforced roster capacity: irPolicy.rosterCapacity, never the
// IR-inclusive league.roster_limit column. These three cases pin the
// published number to the enforcement math so the display and the gate
// cannot drift.
function capacityFakePool({ stashCount, leagueRow }) {
  return createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [leagueRow] })],
    [/COUNT\(\*\)::int AS n/, () => ({ rows: [{ n: stashCount }] })],
    [/FROM "players" AS "source"/, () => ({
      rows: [{ id: 1, name: 'Free Agent', position: 'RB', nfl_team: 'ATL', total_count: '1', identity_ids: [1] }],
    })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 1 }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
  ]);
}

test('readPlayersPage publishes draftRosterSize, not roster_limit, when IR slots are unfilled', async () => {
  const leagueRow = {
    id: 1, name: 'Sunday Ballers', roster_limit: 16, ir_slots: 2, waiver_type: 'faab', current_season: 2026,
  };
  const fake = capacityFakePool({ stashCount: 0, leagueRow });

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake });

  assert.equal(draftRosterSize(leagueRow), 14);
  assert.equal(leagueRow.roster_limit, 16);
  // Red-tell: restoring the direct `league.roster_limit` read publishes 16
  // and turns this assertion red.
  assert.equal(result.context.rosterCapacity, 14);
  assert.notEqual(result.context.rosterCapacity, leagueRow.roster_limit);
});

test('readPlayersPage publishes exactly what irPolicy.rosterCapacity enforces for the same league row', async () => {
  const leagueRow = {
    id: 1, name: 'Sunday Ballers', roster_limit: 16, ir_slots: 2, waiver_type: 'faab', current_season: 2026,
  };
  const fake = capacityFakePool({ stashCount: 1, leagueRow });

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake });

  // Bound to the enforcement function itself, on the SAME league row and the
  // same viewer team (id 17), against a second fake pool of its own - not a
  // literal: if the enforcement math changes, the published number must move
  // with it or this fails.
  const enforcementFake = capacityFakePool({ stashCount: 1, leagueRow });
  const enforced = await irPolicy.rosterCapacity(enforcementFake, { league: leagueRow, teamId: 17 });
  assert.equal(result.context.rosterCapacity, enforced);
  assert.notEqual(result.context.rosterCapacity, leagueRow.roster_limit);
});

test('readPlayersPage on a NULL roster_limit legacy row publishes the enforced number, not a null passthrough', async () => {
  const leagueRow = {
    id: 1, name: 'Legacy League', roster_limit: null, ir_slots: 0, waiver_type: 'faab', current_season: 2026,
  };
  const fake = capacityFakePool({ stashCount: 0, leagueRow });

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake });

  const enforcementFake = capacityFakePool({ stashCount: 0, leagueRow });
  const enforced = await irPolicy.rosterCapacity(enforcementFake, { league: leagueRow, teamId: 17 });
  assert.equal(result.context.rosterCapacity, enforced);
  assert.equal(result.context.rosterCapacity, 0);
  assert.notEqual(result.context.rosterCapacity, null);
});

// Green for the wrong reason (parent spec #1490's Testing Decisions): before
// player.browser-availability.route.test.js is thinned down to a wiring-only
// check, prove directly against the module that a non-member and a
// league-scoped sort/view field used without a league are each refused with
// the expected `code` - so the thinned route test's 403/400 assertions are
// known to exercise real refusal logic, not a route that always 200s.

test('green for the wrong reason: a non-member is refused with code NOT_A_MEMBER', async () => {
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [] })],
  ]);

  await assert.rejects(
    () => readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake }),
    (error) => {
      assert.ok(error instanceof PlayersPageError);
      assert.equal(error.code, 'NOT_A_MEMBER');
      assert.equal(error.statusCode, 403);
      assert.equal(error.message, 'not a member of this league');
      return true;
    },
  );
});

test('green for the wrong reason: sort=upgrade without a league is refused with code VIEW_OR_SORT_REQUIRES_LEAGUE', async () => {
  // No query should even reach the pool: this refusal is decided before any
  // read, so a pool call here would itself be a defect - the empty handler
  // table makes any query throw.
  const fake = createFakePool([]);

  await assert.rejects(
    () => readPlayersPage(baseQuery({ sortField: 'upgrade' }), { db: fake }),
    (error) => {
      assert.ok(error instanceof PlayersPageError);
      assert.equal(error.code, 'VIEW_OR_SORT_REQUIRES_LEAGUE');
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'view=cards and sort=upgrade require leagueId');
      return true;
    },
  );
});
