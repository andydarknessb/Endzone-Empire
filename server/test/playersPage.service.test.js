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
    byeWeeksRaw: null,
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

// A risk review on #1497 caught the pre-module handler's three pure-input
// refusals (availability, view/sort, byeWeeks) losing their relative order
// once split across the route and this module: a request that fails more
// than one at once must still surface the SAME one it did before the move,
// not just the same status code. These three pin that order directly
// against the module, independent of which of the three checks happens to
// live in the route vs. here.
test('refusal precedence: availability beats view/sort beats byeWeeks, same as before the module existed', async () => {
  const fake = createFakePool([]);

  await assert.rejects(
    () => readPlayersPage(baseQuery({ view: 'cards', availability: 'bogus' }), { db: fake }),
    (error) => {
      assert.equal(error.code, 'AVAILABILITY_REQUIRES_LEAGUE');
      return true;
    },
  );

  await assert.rejects(
    () => readPlayersPage(
      baseQuery({ availability: 'bogus', leagueId: '1', byeWeeksRaw: '99' }),
      { db: fake },
    ),
    (error) => {
      assert.equal(error.code, 'AVAILABILITY_REQUIRES_LEAGUE');
      return true;
    },
  );

  await assert.rejects(
    () => readPlayersPage(
      baseQuery({ availability: 'free_agent', leagueId: '1', byeWeeksRaw: 'abc' }),
      { db: fake },
    ),
    (error) => {
      // `availability=free_agent` with a leagueId passes the availability
      // check, and `view`/`sortField` are absent, so byeWeeks - the only
      // remaining failing check - is the one that must fire.
      assert.equal(error.code, 'INVALID_BYE_WEEKS_FILTER');
      return true;
    },
  );
});

// #1574: every row carries `nfl_opponent` for the league's current week,
// null on a bye (never absent, #1132), from ONE schedule read for the page.
test('readPlayersPage attaches nfl_opponent to every row, null on a bye, in one schedule read (#1574)', async () => {
  const league = { id: 1, name: 'L', roster_limit: 14, waiver_type: 'faab', current_season: 2026, current_week: 3 };
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [{ id: 17, league_id: 1, owner_id: 7 }] })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({
      rows: [
        { id: 1, name: 'Plays', position: 'RB', nfl_team: 'KC', total_count: '2', identity_ids: [1] },
        { id: 2, name: 'On Bye', position: 'WR', nfl_team: 'MIA', total_count: '2', identity_ids: [2] },
      ],
    })],
    [/"opponent" FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'KC', opponent: 'BUF' }] })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/FROM "team_players"|FROM "waiver_players"/, () => ({ rows: [] })],
  ]);

  const result = await readPlayersPage(baseQuery({ leagueId: '1' }), { db: fake });

  assert.deepEqual(
    result.players.map((p) => [p.id, p.nfl_opponent]),
    [[1, 'BUF'], [2, null]],
  );
  const scheduleReads = fake.calls.filter((c) => /"opponent" FROM "nfl_games"/.test(c.text));
  assert.equal(scheduleReads.length, 1);
  assert.deepEqual(scheduleReads[0].params, [2026, 3]);
});

test('readPlayersPage without a league carries nfl_opponent: null on every row (#1574)', async () => {
  const fake = createFakePool([
    [/FROM "players" AS "source"/, () => ({
      rows: [{ id: 1, name: 'Plays', position: 'RB', nfl_team: 'KC', total_count: '1', identity_ids: [1] }],
    })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
  ]);
  const result = await readPlayersPage(baseQuery(), { db: fake });
  assert.equal(result.players[0].nfl_opponent, null);
});

// #1778 (spec #1774): sorting by projection puts every Position-baseline
// projection after every evidenced one, whatever its hidden number, and the
// payload carries the `no_history` verdict reason on those rows only.
const projectionService = require('../services/projection.service');

function positionBaselineWorld(t, { backupIds } = {}) {
  const league = {
    id: 1, name: 'Baseline League', roster_limit: 14, waiver_type: 'faab', current_season: 2026, current_week: 5,
  };
  const players = [
    { id: 1, name: 'Starter A', position: 'QB', nfl_team: 'KC', total_count: '5', identity_ids: [1] },
    { id: 2, name: 'Starter B', position: 'QB', nfl_team: 'DAL', total_count: '5', identity_ids: [2] },
    { id: 3, name: 'Backup With Big Old Numbers', position: 'QB', nfl_team: 'ARI', total_count: '5', identity_ids: [3] },
    { id: 4, name: 'Backup Nothing', position: 'QB', nfl_team: 'LV', total_count: '5', identity_ids: [4] },
    { id: 5, name: 'Evidenced No Prior Season', position: 'QB', nfl_team: 'PIT', total_count: '5', identity_ids: [5] },
  ];
  // Prior-season pace: 2 > 1; 3 is the hidden number that would win (5000
  // yards); 4 and 5 have no prior season at all (projected_points null).
  const seasonRow = (playerId, passingYards) => ({
    player_id: playerId, season: 2025, games_played: 17, stats: { passingYards }, fantasy_points: 0,
  });
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/FROM "player_season_stats"/, () => ({
      rows: [seasonRow(1, 3000), seasonRow(2, 4000), seasonRow(3, 5000)],
    })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
  ]);
  const reads = [];
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => {
    reads.push(options);
    const entry = (reasons) => ({
      median: 15.37,
      factors: { availability: { available: true }, dataQuality: { reasons } },
    });
    return projectionService.toWeeklyProjectionResult({
      week: options.week,
      projections: new Map([
        [1, entry([])], [2, entry([])], [3, entry(['position baseline'])],
        [4, entry(['position baseline'])], [5, entry([])],
      ]),
      backupIds,
    });
  });
  return { fake, reads };
}

test('projection sort DESC: Position-baseline rows come after every evidenced row, in id order (#1778)', async (t) => {
  const { fake, reads } = positionBaselineWorld(t);

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'DESC' }),
    { db: fake },
  );

  // 2 (160) > 1 (120) > 5 (no prior season, reads as 0), then the baseline rows 3 and 4 - although 3's hidden number is the
  // highest of the pool.
  assert.deepEqual(result.players.map((p) => p.id), [2, 1, 5, 3, 4]);
  assert.equal(reads.length, 1, 'one Weekly projection read for the whole pool, not per row');
  assert.equal(reads[0].week, 5);
  assert.deepEqual([...reads[0].playerIds].sort(), [1, 2, 3, 4, 5]);
});

test('projection sort ASC: Position-baseline rows still come last (#1778)', async (t) => {
  const { fake } = positionBaselineWorld(t);

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'ASC' }),
    { db: fake },
  );

  // Player 5 has no prior season: `Number(null)` is 0, so it leads an ascending
  // sort exactly as it did before this change.
  assert.deepEqual(result.players.map((p) => p.id), [5, 1, 2, 3, 4]);
});

test('payload carries verdictReason no_history on Position-baseline rows only (#1778)', async (t) => {
  const { fake } = positionBaselineWorld(t);

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'DESC' }),
    { db: fake },
  );

  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.equal(byId.get(3).verdictReason, 'no_history');
  assert.equal(byId.get(4).verdictReason, 'no_history');
  for (const id of [1, 2, 5]) assert.equal('verdictReason' in byId.get(id), false, `player ${id} is evidenced`);
});

test('a Backup quarterback carries verdictReason backup and keeps his place in a projection sort (ADR 0057)', async (t) => {
  const { fake } = positionBaselineWorld(t, { backupIds: new Set([2, 3]) });

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'DESC' }),
    { db: fake },
  );

  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.deepEqual(result.players.map((p) => p.id), [2, 1, 5, 3, 4], 'the sort is the same as without the verdict');
  assert.equal(byId.get(2).verdictReason, 'backup');
  assert.equal(byId.get(3).verdictReason, 'backup', 'backup wins over Position-baseline (ADR 0057, amended 2026-10-07)');
  assert.equal('verdictReason' in byId.get(1), false);
});

test('an Unavailable Position-baseline row keeps its own place and carries no no_history (#1778)', async (t) => {
  const { fake } = positionBaselineWorld(t);
  projectionService.getWeeklyProjections.mock.mockImplementation(async (options) => projectionService.toWeeklyProjectionResult({
    week: options.week,
    projections: new Map([
      [1, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
      [2, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
      [3, { median: 15.37, factors: { availability: { available: false, reason: 'out' }, dataQuality: { reasons: ['position baseline'] } } }],
      [4, { median: 15.37, factors: { availability: { available: true }, dataQuality: { reasons: ['position baseline'] } } }],
      [5, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
    ]),
  }));

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'DESC' }),
    { db: fake },
  );

  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.equal('verdictReason' in byId.get(3), false, 'Out wins over no history');
  assert.equal(byId.get(4).verdictReason, 'no_history');
  assert.equal(result.players[result.players.length - 1].id, 4);
});

// #2044: the sort-last set is Position-baseline AND not Unavailable. A stored-IR
// row that is also Backup keeps its own place in the sort (its hidden number
// leads a DESC sort) and carries no tag; dropping the outcome gate sorts it last.
test('a stored-Unavailable Position-baseline Backup row keeps its own place and carries no tag (#2044)', async (t) => {
  const { fake } = positionBaselineWorld(t, { backupIds: new Set([3]) });
  projectionService.getWeeklyProjections.mock.mockImplementation(async (options) => projectionService.toWeeklyProjectionResult({
    week: options.week,
    backupIds: new Set([3]),
    projections: new Map([
      [1, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
      [2, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
      [3, { median: 15.37, factors: { availability: { available: false, reason: 'ir' }, dataQuality: { reasons: ['position baseline'] } } }],
      [4, { median: 15.37, factors: { availability: { available: true }, dataQuality: { reasons: ['position baseline'] } } }],
      [5, { median: 5, factors: { availability: { available: true }, dataQuality: { reasons: [] } } }],
    ]),
  }));

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', sortField: 'projected_points', dir: 'DESC' }),
    { db: fake },
  );

  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.equal('verdictReason' in byId.get(3), false, 'IR wins over backup and no history');
  assert.equal(result.players[result.players.length - 1].id, 4, 'only the available Position-baseline row sorts last');
  assert.equal(result.players[0].id, 3, 'his own number leads a DESC sort');
});

test('other sorts do not take the Weekly projection read (#1778)', async (t) => {
  const { fake, reads } = positionBaselineWorld(t);

  const result = await readPlayersPage(baseQuery({ leagueId: '1', sortField: 'name', dir: 'ASC' }), { db: fake });

  assert.equal(reads.length, 0);
  assert.deepEqual(result.players.map((p) => p.id), [1, 2, 3, 4, 5]);
});

// #1809 (spec #1774): the Upgrade sort is the default Waivers order outside
// best ball, and it orders by the hidden number through `upgrade.points`. A
// Position-baseline candidate gets no Upgrade, so his 15.37 cannot outrank an
// evidenced candidate with a lower number: he sorts after every candidate with
// an Upgrade, and his row carries `upgrade: null`. Runs the real `upgradesFor`
// through the Players page; only the Weekly projection read and the page-scoped
// card readers this test does not exercise are mocked.
test('sort=upgrade: a Position-baseline candidate sorts after an evidenced one with a lower number and carries upgrade: null (#1809)', async (t) => {
  const lineupService = require('../services/lineup.service');
  const playerCardService = require('../services/playerCard.service');
  const league = {
    id: 1, name: 'Baseline League', roster_limit: 14, waiver_type: 'faab', current_season: 2026, current_week: 5,
    best_ball: false,
  };
  const players = [
    { id: 1, name: 'Backup Baseline', position: 'QB', nfl_team: 'ARI', total_count: '3', identity_ids: [1] },
    { id: 2, name: 'Evidenced Lower', position: 'QB', nfl_team: 'KC', total_count: '3', identity_ids: [2] },
    { id: 3, name: 'Evidenced Higher', position: 'QB', nfl_team: 'DAL', total_count: '3', identity_ids: [3] },
  ];
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: players.map(({ id, position, nfl_team }) => ({ id, position, nfl_team })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [{ player_id: 999, slot: 'QB', name: 'Weak Starter', position: 'QB', nfl_team: null }] })],
    [/^WITH "target" AS \(/, () => ({ rows: players.map(({ id }) => ({ id })) })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "player_watchlist"/, () => ({ rows: [] })],
    [/FROM "player_ownership"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const entry = (median, reasons) => ({
    mean: median, median, factors: { availability: { available: true }, dataQuality: { reasons } },
  });
  const weeklyResult = (week) => projectionService.toWeeklyProjectionResult({
    week,
    projections: new Map([
      [999, entry(5, [])],
      [1, entry(15.37, ['position baseline'])],
      [2, entry(9, [])],
      [3, entry(12, [])],
    ]),
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => weeklyResult(options.week));
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks }) => new Map(
    weeks.map((week) => [week, weeklyResult(week)]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async () => new Map());
  t.mock.method(playerCardService, 'availabilityForMany', async () => new Map());
  t.mock.method(playerCardService, 'buildWeeksForPage', async () => new Map());

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', view: 'cards', sortField: 'upgrade', dir: 'DESC' }),
    { db: fake },
  );

  // 3 (12 - 5 = 7) > 2 (9 - 5 = 4) > 1 (Position baseline: no Upgrade, although his number is 15.37).
  assert.deepEqual(result.players.map((p) => p.id), [3, 2, 1]);
  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.equal(byId.get(1).upgrade, null);
  assert.equal(byId.get(2).upgrade.points, 4);
  assert.equal(byId.get(3).upgrade.points, 7);
});

// #1911 (#1800 Ruling item 2): equal Upgrades tie-break on the candidate's own
// Weekly projection descending (the number `loadUpgradeContext` hands
// `upgradeFor`), then id; a null Upgrade stays last whatever it projects.
test('sort=upgrade: equal Upgrades order by the candidate\'s Weekly projection, a null Upgrade stays last (#1911)', async (t) => {
  const lineupService = require('../services/lineup.service');
  const playerCardService = require('../services/playerCard.service');
  const league = {
    id: 1, name: 'Tie League', roster_limit: 14, waiver_type: 'faab', current_season: 2026, current_week: 5,
    best_ball: false,
  };
  const players = [
    { id: 1, name: 'Projects Four', position: 'QB', nfl_team: 'ARI', total_count: '3', identity_ids: [1] },
    { id: 2, name: 'Projects Nine', position: 'QB', nfl_team: 'KC', total_count: '3', identity_ids: [2] },
    { id: 3, name: 'Baseline Twenty', position: 'QB', nfl_team: 'DAL', total_count: '3', identity_ids: [3] },
  ];
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: players.map(({ id, position, nfl_team }) => ({ id, position, nfl_team })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [{ player_id: 999, slot: 'QB', name: 'Strong Starter', position: 'QB', nfl_team: null }] })],
    [/^WITH "target" AS \(/, () => ({ rows: players.map(({ id }) => ({ id })) })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "player_watchlist"/, () => ({ rows: [] })],
    [/FROM "player_ownership"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const entry = (median, reasons) => ({
    mean: median, median, factors: { availability: { available: true }, dataQuality: { reasons } },
  });
  const weeklyResult = (week) => projectionService.toWeeklyProjectionResult({
    week,
    projections: new Map([
      [999, entry(15, [])],
      [1, entry(4, [])],
      [2, entry(9, [])],
      [3, entry(20, ['position baseline'])],
    ]),
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => weeklyResult(options.week));
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks }) => new Map(
    weeks.map((week) => [week, weeklyResult(week)]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async () => new Map());
  t.mock.method(playerCardService, 'availabilityForMany', async () => new Map());
  t.mock.method(playerCardService, 'buildWeeksForPage', async () => new Map());

  const result = await readPlayersPage(
    baseQuery({ leagueId: '1', view: 'cards', sortField: 'upgrade', dir: 'DESC' }),
    { db: fake },
  );

  // 2 (Upgrade 0, projects 9) before 1 (Upgrade 0, projects 4) although 1 has the lower id;
  // 3 has a null Upgrade (Position baseline) and projects 20, yet comes last.
  assert.deepEqual(result.players.map((p) => p.id), [2, 1, 3]);
  const byId = new Map(result.players.map((p) => [p.id, p]));
  assert.equal(byId.get(1).upgrade.points, 0);
  assert.equal(byId.get(2).upgrade.points, 0);
  assert.equal(byId.get(3).upgrade, null);
});

// #1912 (#1800 Ruling items 4-5): `context.dropSuggestion` is the roster player
// with the lowest Rest of season total (ties by lower id) when the roster is
// at capacity, null when a spot is free, and never a player in an IR slot.
async function readDropSuggestionContext(t, { rosterCount, rosterRows, ros }) {
  const playerCardService = require('../services/playerCard.service');
  const league = {
    id: 1, name: 'Drop League', roster_limit: 3, waiver_type: 'faab', current_season: 2026, current_week: 5,
    best_ball: false,
  };
  const players = [{ id: 1, name: 'Candidate', position: 'QB', nfl_team: 'ARI', total_count: '1', identity_ids: [1] }];
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 17, league_id: 1, owner_id: 7, faab_remaining: 82, waiver_priority: 3 }],
    })],
    [select('leagues'), () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/^SELECT "players"\."id", "players"\."name" FROM "team_players"/, () => ({ rows: rosterRows })],
    [/FROM "nfl_games"|FROM "player_season_stats"/, () => ({ rows: [] })],
    [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: rosterCount }] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "player_watchlist"/, () => ({ rows: [] })],
    [/FROM "player_ownership"/, () => ({ rows: [] })],
  ]);
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async () => new Map());
  t.mock.method(projectionService, 'getRestOfSeason', ros);
  t.mock.method(playerCardService, 'availabilityForMany', async () => new Map());
  t.mock.method(playerCardService, 'buildWeeksForPage', async () => new Map());
  t.mock.method(playerCardService, 'upgradesFor', async () => new Map());
  const result = await readPlayersPage(baseQuery({ leagueId: '1', view: 'cards' }), { db: fake });
  return { context: result.context, fake };
}

const rosterOf = [{ id: 5, name: 'Star' }, { id: 9, name: 'Backup Nine' }, { id: 8, name: 'Backup Eight' }];
const rosTotals = async () => new Map([[5, { total: 40 }], [9, { total: 12 }], [8, { total: 12 }]]);

test('context.dropSuggestion is the roster player with the lowest Rest of season total, ties by lower id (#1912)', async (t) => {
  const { context, fake } = await readDropSuggestionContext(t, { rosterCount: 3, rosterRows: rosterOf, ros: rosTotals });
  assert.deepEqual(context.dropSuggestion, { id: 8, name: 'Backup Eight' });
  // Its own read over the roster's ids: positionRank ranks within the ids passed,
  // and the page's runs hold only the page's players, so none is reused.
  const call = projectionService.getRestOfSeason.mock.calls.find((c) => c.arguments[0].includes(5));
  assert.equal(call.arguments[2], undefined);
  assert.equal(fake.matching(/^SELECT "players"\."id", "players"\."name" FROM "team_players"/).length, 1);
});

test('context.dropSuggestion is null when the roster has a free spot, and no roster read is made (#1912)', async (t) => {
  const { context, fake } = await readDropSuggestionContext(t, { rosterCount: 2, rosterRows: rosterOf, ros: rosTotals });
  assert.equal(context.dropSuggestion, null);
  assert.equal(fake.matching(/^SELECT "players"\."id", "players"\."name" FROM "team_players"/).length, 0);
});

test('a failed Rest of season read leaves dropSuggestion null and never fails the players read (#1912)', async (t) => {
  const { context } = await readDropSuggestionContext(t, {
    rosterCount: 3, rosterRows: rosterOf, ros: async (ids) => { if (ids.includes(5)) throw new Error('projection down'); return new Map(); },
  });
  assert.equal(context.dropSuggestion, null);
});

test('the roster read leaves out a player in an IR slot this week (#1912)', async (t) => {
  const { fake } = await readDropSuggestionContext(t, { rosterCount: 3, rosterRows: rosterOf, ros: rosTotals });
  const [read] = fake.matching(/^SELECT "players"\."id", "players"\."name" FROM "team_players"/);
  assert.match(read.text, /"lineup_entries"\."slot" = 'IR'/);
  assert.match(read.text, /NOT EXISTS/);
});
