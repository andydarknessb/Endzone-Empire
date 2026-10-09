const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const byeService = require('../services/bye.service');
const decisionCardContextService = require('../services/decisionCardContext.service');
const irPolicy = require('../services/irPolicy.service');
const practiceParticipation = require('../services/practiceParticipation.service');
const { getPlayerCard, upgradesFor } = require('../services/playerCard.service');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEAGUE = {
  id: 3,
  current_season: 2026,
  current_week: 1,
  best_ball: false,
  waiver_type: 'faab',
  regular_season_weeks: 14,
  playoff_teams: 4,
  waivers_clear_at: null,
};

// Upgrade fixtures want a FULL lineup, so a candidate has to beat someone: the
// default league has empty slots he would simply fill (ADR 0055).
const wrSlots = (count) => ({ ...LEAGUE, roster_slots: [{ key: 'WR', label: 'WR', count, eligiblePositions: ['WR'] }] });
const RB_FLEX_LEAGUE = {
  ...LEAGUE,
  roster_slots: [
    { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
    { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] },
  ],
};

const PLAYER = {
  id: 55,
  name: 'Test Player',
  position: 'WR',
  nfl_team: 'BUF',
  jersey_number: '17',
  photo_url: null,
  injury_status: null,
  injury_detail: null,
  news: null,
  adp: null,
};

const TEAM = {
  id: 10, league_id: 3, owner_id: 7, name: 'My Team', faab_remaining: 50, waiver_priority: 3,
};

/**
 * The full set of `pool`/client queries `getPlayerCard` issues, each matched
 * on its distinctive leading clause so two different queries against the
 * same table never collide (`fakePool.js`'s own `select()` helper matches on
 * the first FROM table alone, which `players` and `team_players` each hit
 * twice here with different columns).
 */
function buildHandlers({
  league = LEAGUE,
  player = PLAYER,
  team = TEAM,
  rosteredBy = null, // { team_id, team_name } | null
  waiverRow = null, // { available_at } | null
  rosterCount = 0,
  identityIds = [player.id], // every players row loadIdentityIds resolves for this player
  ownRosterRows = [], // rows for the caller's OWN team_players (own-roster Upgrade check)
  starterRows = [], // loadUpgradeContext's own lineup rows, starters and bench ({ player_id, slot, name, position?, nfl_team? })
  kickedOffTeams = [], // nfl_team codes whose game has kicked off (the lock predicate's read)
  schedule = [], // { nfl_team, week, kickoff_at } rows: the first-playable-week read (#2166); none = unsynced schedule
  waiverRows = [], // { player_id, available_at } rows: the clear times the first-playable-week read compares with `now`
  rosteredElsewhere = [], // player ids another team holds (they keep the current week, #2167)
} = {}) {
  return [
    [/^SELECT "nfl_team", "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: schedule })],
    [/^SELECT "player_id", "available_at" FROM "waiver_players" WHERE "league_id" = \$1 AND "player_id" = ANY\(\$2::int\[\]\)$/, () => ({ rows: waiverRows })],
    [/^SELECT "player_id" FROM "team_players" WHERE "league_id" = \$1 AND "player_id" = ANY\(\$2::int\[\]\)$/, () => ({
      rows: rosteredElsewhere.map((player_id) => ({ player_id })),
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [league] })],
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, () => ({ rows: [team] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [player] })],
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [] })],
    // #1667: the player's own game this week (line/weather); no game by default.
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: starterRows.map((r) => ({ position: 'WR', nfl_team: null, ...r })) })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: kickedOffTeams.map((nfl_team) => ({ nfl_team })) })],
    [/^WITH "target" AS \(/, () => ({ rows: identityIds.map((id) => ({ id })) })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: ownRosterRows })],
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({ rows: [{ id: player.id, position: player.position }] })],
    [/^SELECT "team_players"\."team_id", "teams"\."name"/, () => ({ rows: rosteredBy ? [rosteredBy] : [] })],
    [/^SELECT "available_at" FROM "waiver_players"/, () => ({ rows: waiverRow ? [waiverRow] : [] })],
    [/^SELECT COUNT\(\*\)::int AS "roster_count" FROM "team_players"/, () => ({ rows: [{ roster_count: rosterCount }] })],
    [/^SELECT "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: [] })],
    // #1356 seasons[]: getRescoredPositionRank's position-group read, for the
    // current season entry every card now builds (Cory's ruling on #1356) -
    // no rows by default; the seasons[]-specific tests override this.
    [/^SELECT "pss"\."player_id"/, () => ({ rows: [] })],
    // #1923: the Practice participation read; none by default.
    [/FROM "player_practice_observations"/, () => ({ rows: [] })],
  ];
}

/**
 * A raw Weekly-projection run entry for `id` (#1703: `getWeeklyProjections`
 * itself now returns the result object, so every mock below has to build the
 * same shape the real engine does - mean/median/factors - rather than the
 * old legacy-map `{ points, ... }` shape). `weekPoints` overrides `id` with a
 * fixed point value (mean and median both set to it, so either ranking
 * statistic reads it the same) and/or `factors`, from a bare number (every
 * pre-existing test) or a full `{ points, factors }` entry (the
 * opponentRankVsPosition cases) - the two fixture shapes. Anything `weekPoints` does not cover falls back to
 * `weeklyProjection(week, id)`.
 */
function rawEntryFor(weekPoints, weeklyProjection, week, id) {
  if (!weekPoints.has(id)) return weeklyProjection(week, id);
  const value = weekPoints.get(id);
  if (value == null) return { mean: null, median: null, factors: {} };
  if (typeof value !== 'object') {
    return { mean: Number(value), median: Number(value), factors: {} };
  }
  const points = value.points;
  return {
    mean: points == null ? null : Number(points),
    median: points == null ? null : Number(points),
    factors: value.factors || {},
  };
}

/** Mocks every cross-module seam `getPlayerCard` reads through, so a test can
 * fix each one's answer instead of exercising the real projection engine,
 * lineup materialization, or bye/usage lookups. Returns the spy call logs the
 * tests need. */
function mockServices(t, {
  weekPoints = new Map(),
  weeklyProjection = () => ({ median: 5, factors: { availability: { available: true } } }),
  byeWeek = null,
  restOfSeason = { total: 0, perGame: 0 },
  rosterCapacity = 16,
  realUsage = false, // leave loadUsage to the fake pool (the IDP side case)
} = {}) {
  // `getWeekProjections` (the Pool-wide bridge) is not a reader this ticket
  // touches (#1703's Pool-projection carve-out) and playerCard.service.js no
  // longer calls it at all; mocked only so a stray call surfaces loudly
  // rather than hitting the real pool.
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  const weekProjectionCalls = [];
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => {
    weekProjectionCalls.push(options);
    const projections = new Map(
      options.playerIds.map((id) => [id, rawEntryFor(weekPoints, weeklyProjection, options.week, id)])
    );
    return projectionService.toWeeklyProjectionResult({ projections });
  });
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks, playerIds }) => new Map(
    weeks.map((week) => [week, projectionService.toWeeklyProjectionResult({
      week,
      projections: new Map(playerIds.map((id) => [id, rawEntryFor(weekPoints, weeklyProjection, week, id)])),
    })]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => {
    return new Map(playerIds.map((id) => [id, restOfSeason]));
  });
  t.mock.method(byeService, 'computeByeWeek', async () => byeWeek);
  if (!realUsage) t.mock.method(decisionCardContextService, 'loadUsage', async () => null);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(irPolicy, 'rosterCapacity', async () => rosterCapacity);
  return { weekProjectionCalls };
}

// ---------------------------------------------------------------------------
// getPlayerCard
// ---------------------------------------------------------------------------

test('getPlayerCard: a best_ball league yields upgrade: null', async (t) => {
  createFakePool(buildHandlers({ league: { ...LEAGUE, best_ball: true } })).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 12]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.decision.upgrade, null);
});

test('getPlayerCard: a past, non-bye week with no player_stats row ships kind "actual" with points null (formal review f3, open interpretation)', async (t) => {
  const league = { ...LEAGUE, current_week: 3 };
  createFakePool(buildHandlers({ league })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.weeks[0].kind, 'actual');
  assert.equal(card.weeks[0].points, null);
  assert.equal(card.weeks[1].kind, 'actual');
  assert.equal(card.weeks[1].points, null);
});

test('getPlayerCard: a player on bye in week N yields weeks[N-1].kind === "bye" with no points', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { byeWeek: 5 });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.weeks.length, 18);
  assert.equal(card.weeks[4].week, 5);
  assert.equal(card.weeks[4].kind, 'bye');
  assert.equal('points' in card.weeks[4], false);
  // f2: opponentRankVsPosition is a `kind: 'projected'` field (Ruling item 3);
  // a bye row carries no such key, not even a null one.
  assert.equal('opponentRankVsPosition' in card.weeks[4], false);
});

test('getPlayerCard (#1675): weeks[].reason is the Unavailable reason CODE - bye reads bye, a released player reads no_team, IR reads ir', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    byeWeek: 5,
    weeklyProjection: (week) => {
      if (week === 7) return { median: null, factors: { availability: { available: false, reason: 'no_team' } } };
      if (week === 8) return { median: null, factors: { availability: { available: false, reason: 'ir' } } };
      if (week === 9) return { median: null, factors: { availability: { available: false, reason: 'out' } } };
      return { median: 5, factors: { availability: { available: true } } };
    },
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.weeks[4].reason, 'bye');
  assert.equal(card.weeks[6].kind, 'unavailable');
  assert.equal(card.weeks[6].reason, 'no_team');
  assert.equal(card.weeks[7].reason, 'ir');
  assert.equal(card.weeks[8].reason, 'out');
});

test('getPlayerCard: a rostered player yields availability.teamId and teamName', async (t) => {
  createFakePool(buildHandlers({ rosteredBy: { team_id: 77, team_name: 'Rival Team' } })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.availability.state, 'rostered');
  assert.equal(card.availability.teamId, 77);
  assert.equal(card.availability.teamName, 'Rival Team');
});

test('getPlayerCard: seasonEnd equals the league\'s last playoff week', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.seasonEnd, projectionService.lastPlayoffWeek(LEAGUE));
  assert.equal(card.decision.ros.throughWeek, card.seasonEnd);
});

test('getPlayerCard: projWeek.points comes from getWeeklyProjections for the current week, under the league\'s own scoring', async (t) => {
  // A current starter (999) alongside the card's own player (55) makes
  // `loadUpgradeContext`'s ONE combined-ids call (Ruling item 2) distinguishable
  // from `buildWeeklyBars`'s own per-week calls, which only ever ask for the
  // card player alone (#1703 formal review f3).
  createFakePool(buildHandlers({
    starterRows: [{ player_id: 999, slot: 'RB', name: 'Other Starter' }],
  })).install(t);
  const { weekProjectionCalls } = mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  const combinedIdsCalls = weekProjectionCalls.filter(
    (call) => call.playerIds.includes(999) && call.playerIds.includes(PLAYER.id)
  );
  assert.equal(combinedIdsCalls.length, 1, 'loadUpgradeContext makes exactly ONE combined-ids call');
  assert.equal(combinedIdsCalls[0].season, LEAGUE.current_season);
  assert.equal(combinedIdsCalls[0].week, LEAGUE.current_week);
  // formal review f2: the ticket exists because the legacy pool-projection
  // path called getWeekProjections with no `league` (default-scoring pool
  // extrapolation) - assert the actual call carries the league object and
  // the player, not just that A call happened, so dropping `league` here
  // goes red.
  assert.equal(combinedIdsCalls[0].league, LEAGUE);
  assert.equal(card.decision.projWeek.week, LEAGUE.current_week);
  assert.equal(card.decision.projWeek.points, 14.5);
});

// #1765: the Decision strip reads the same Unavailable verdict as the weekly
// bars - 0 plus the reason, never the engine's Point estimate for the week.
for (const reason of ['no_team', 'out', 'ir', 'practice_squad']) {
  test(`getPlayerCard (#1765): an Unavailable (${reason}) player's projWeek is 0 with the weekly bar's reason`, async (t) => {
    createFakePool(buildHandlers()).install(t);
    mockServices(t, {
      // The engine still carries a full estimate for the week; the strip must not print it.
      weeklyProjection: () => ({
        mean: 14, median: 14, factors: { availability: { available: false, reason } },
      }),
    });

    const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

    const bar = card.weeks.find((w) => w.week === LEAGUE.current_week);
    assert.equal(bar.kind, 'unavailable');
    assert.equal(card.decision.projWeek.points, 0);
    assert.equal(card.decision.projWeek.reason, reason);
    assert.equal(card.decision.projWeek.reason, bar.reason);
  });
}

// The Waiver Wire's Upgrade sort reads the same Upgrade: an Unavailable free
// agent cannot improve this week's lineup, so he is no Upgrade at all, even
// though the engine still carries his full estimate (ADR 0044). The player
// row carries a real nfl_team so the No NFL team refusal cannot mask this.
function upgradeHandlers() {
  return [
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: PLAYER.id, position: PLAYER.position, nfl_team: PLAYER.nfl_team }],
    })],
    ...buildHandlers({ league: wrSlots(1), starterRows: [{ player_id: 999, slot: 'WR', name: 'Weak Starter' }] }),
  ];
}

function upgradeProjection(availability) {
  return (week, id) => (id === 999
    ? { mean: 5, median: 5, factors: { availability: { available: true } } }
    : { mean: 14, median: 14, factors: { availability } });
}

for (const reason of ['out', 'ir', 'bye', 'practice_squad']) {
  test(`getPlayerCard: an Unavailable (${reason}) free agent is no Upgrade over a healthy starter`, async (t) => {
    createFakePool(upgradeHandlers()).install(t);
    mockServices(t, { weeklyProjection: upgradeProjection({ available: false, reason }) });

    const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

    assert.equal(card.decision.upgrade, null);
  });
}

// #1809 (spec #1774): a Position-baseline projection is the position's average,
// not this player's own evidence, so the Upgrade refuses him as it refuses No
// NFL team and Unavailable candidates - the 15.37 backup QB is never an
// Upgrade, however high the hidden number is. An evidenced candidate keeps his.
test('upgradesFor (#1809): a Position-baseline candidate at 15.37 gets null, an evidenced candidate keeps his Upgrade', async (t) => {
  const BASELINE_ID = 55;
  const EVIDENCED_ID = 56;
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [
        { id: BASELINE_ID, position: 'WR', nfl_team: 'BUF' },
        { id: EVIDENCED_ID, position: 'WR', nfl_team: 'KC' },
      ],
    })],
    ...buildHandlers({
      league: wrSlots(1),
      starterRows: [{ player_id: 999, slot: 'WR', name: 'Weak Starter' }],
      identityIds: [BASELINE_ID],
    }),
  ]).install(t);
  mockServices(t, {
    weeklyProjection: (week, id) => {
      if (id === 999) return { mean: 5, median: 5, factors: { availability: { available: true } } };
      if (id === BASELINE_ID) {
        return {
          mean: 15.37,
          median: 15.37,
          factors: { availability: { available: true }, dataQuality: { reasons: ['position baseline'] } },
        };
      }
      return { mean: 12, median: 12, factors: { availability: { available: true }, dataQuality: { reasons: [] } } };
    },
  });

  const upgrades = await upgradesFor({
    league: wrSlots(1), team: TEAM, season: 2026, week: 1, playerIds: [BASELINE_ID, EVIDENCED_ID],
  });

  assert.equal(upgrades.get(BASELINE_ID), null);
  assert.deepEqual(upgrades.get(EVIDENCED_ID), {
    points: 7,
    overPlayer: { id: 999, name: 'Weak Starter', points: 5, unavailable: null },
    slot: 'WR',
    week: 1,
  });
});

test('getPlayerCard: an available free agent\'s Upgrade is his Point estimate over the starter he beats', async (t) => {
  createFakePool(upgradeHandlers()).install(t);
  mockServices(t, { weeklyProjection: upgradeProjection({ available: true }) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.upgrade, {
    points: 9,
    overPlayer: { id: 999, name: 'Weak Starter', points: 5, unavailable: null },
    slot: 'WR',
    week: 1,
  });
});

// #1793: the Upgrade must not trust an Unavailable starter's engine estimate
// either - he adds nothing to this week's lineup, so he counts as 0 in the
// optimal lineups, and the Upgrade names him as overPlayer.
function twoStarterHandlers() {
  return [
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: PLAYER.id, position: PLAYER.position, nfl_team: PLAYER.nfl_team }],
    })],
    ...buildHandlers({
      league: wrSlots(2),
      starterRows: [
        { player_id: 999, slot: 'WR', name: 'Unavailable Starter' },
        { player_id: 998, slot: 'WR', name: 'Healthy Starter' },
      ],
    }),
  ];
}

function twoStarterProjection(starter999Availability) {
  return (week, id) => {
    if (id === 999) return { mean: 20, median: 20, factors: { availability: starter999Availability } };
    if (id === 998) return { mean: 12, median: 12, factors: { availability: { available: true } } };
    return { mean: 10, median: 10, factors: { availability: { available: true } } }; // the candidate, PLAYER.id
  };
}

for (const reason of ['bye', 'out', 'ir', 'no_team', 'practice_squad']) {
  test(`getPlayerCard (#1793): a healthy candidate's Upgrade counts an Unavailable (${reason}) starter as 0, not his 20-point estimate`, async (t) => {
    createFakePool(twoStarterHandlers()).install(t);
    mockServices(t, { weeklyProjection: twoStarterProjection({ available: false, reason }) });

    const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

    assert.deepEqual(card.decision.upgrade, {
      points: 10,
      overPlayer: { id: 999, name: 'Unavailable Starter', points: 0, unavailable: reason },
      slot: 'WR',
      week: 1,
    });
  });
}

test('getPlayerCard (#1793): with both starters healthy and better than the candidate, the Upgrade is 0 with no overPlayer (#1910)', async (t) => {
  createFakePool(twoStarterHandlers()).install(t);
  mockServices(t, { weeklyProjection: twoStarterProjection({ available: true }) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.upgrade, { points: 0, overPlayer: null, slot: null, week: 1 });
});

// A candidate helper that pins the candidate's OWN position (and starter
// rows), for the FLEX and tie-break cases below, none of which fit
// `upgradeHandlers`'s or `twoStarterHandlers`'s fixed WR-vs-WR shape.
function starterHandlers(starterRows, candidatePosition = 'WR', league = LEAGUE) {
  return [
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: PLAYER.id, position: candidatePosition, nfl_team: PLAYER.nfl_team }],
    })],
    ...buildHandlers({ league, starterRows }),
  ];
}

// #1793 (f4): an Unavailable starter at FLEX must zero out the same way for
// an RB candidate, who is eligible at both RB and FLEX - not just for the
// WR-slot case above.
test('getPlayerCard (#1793): an Unavailable starter at FLEX counts as 0 for an RB candidate too', async (t) => {
  createFakePool(starterHandlers([
    { player_id: 996, slot: 'RB', name: 'Healthy RB', position: 'RB' },
    { player_id: 997, slot: 'FLEX', name: 'Unavailable Flex', position: 'RB' },
  ], 'RB', RB_FLEX_LEAGUE)).install(t);
  mockServices(t, {
    weeklyProjection: (week, id) => {
      if (id === 997) return { mean: 18, median: 18, factors: { availability: { available: false, reason: 'out' } } };
      if (id === 996) return { mean: 20, median: 20, factors: { availability: { available: true } } };
      return { mean: 10, median: 10, factors: { availability: { available: true } } };
    },
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.upgrade, {
    points: 10,
    overPlayer: { id: 997, name: 'Unavailable Flex', points: 0, unavailable: 'out' },
    slot: 'FLEX',
    week: 1,
  });
});

// #1910: the roster read covers the bench, and a player whose game has kicked
// off is read through the lineup lock's own predicate (nfl_games.kickoff_at).
test('getPlayerCard (#1910): a bench player who would start over an Unavailable starter nets the Upgrade out', async (t) => {
  createFakePool(starterHandlers([
    { player_id: 999, slot: 'WR', name: 'Unavailable Starter' },
    { player_id: 998, slot: 'BENCH', name: 'Bench WR' },
  ], 'WR', wrSlots(1))).install(t);
  mockServices(t, {
    weeklyProjection: (week, id) => {
      if (id === 999) return { mean: 20, median: 20, factors: { availability: { available: false, reason: 'out' } } };
      if (id === 998) return { mean: 12, median: 12, factors: { availability: { available: true } } };
      return { mean: 15, median: 15, factors: { availability: { available: true } } };
    },
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.upgrade, {
    points: 3,
    overPlayer: { id: 998, name: 'Bench WR', points: 12, unavailable: null },
    slot: 'WR',
    week: 1,
  });
});

test('getPlayerCard (#1910): a starter whose game has kicked off is pinned, so no candidate replaces him', async (t) => {
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: PLAYER.id, position: 'WR', nfl_team: PLAYER.nfl_team }],
    })],
    ...buildHandlers({
      league: wrSlots(1),
      starterRows: [{ player_id: 999, slot: 'WR', name: 'Locked Starter', nfl_team: 'KC' }],
      kickedOffTeams: ['KC'],
    }),
  ]).install(t);
  mockServices(t, {
    weeklyProjection: (week, id) => (id === 999
      ? { mean: 5, median: 5, factors: { availability: { available: true } } }
      : { mean: 14, median: 14, factors: { availability: { available: true } } }),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.upgrade, { points: 0, overPlayer: null, slot: null, week: 1 });
});

test('getPlayerCard (#1765): an available player\'s projWeek keeps the Point estimate and carries no reason', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.decision.projWeek.points, 14.5);
  assert.equal('reason' in card.decision.projWeek, false);
});

// ---------------------------------------------------------------------------
// #1342: decision.projWeek.opponentRankVsPosition (the opponent Factor is the
// one producer, ranked - see projection.service.js's rankOpponentDefense)
// ---------------------------------------------------------------------------

test('getPlayerCard: projWeek.opponentRankVsPosition is { rank, of } read off the opponent Factor', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weekPoints: new Map([[PLAYER.id, {
      points: 14.5,
      factors: { opponent: { available: true, rank: 24, of: 32 } },
    }]]),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.projWeek.opponentRankVsPosition, { rank: 24, of: 32 });
});

test('getPlayerCard: projWeek.opponentRankVsPosition is null when the opponent Factor is not available (never 0)', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weekPoints: new Map([[PLAYER.id, {
      points: 14.5,
      factors: { opponent: { available: false } },
    }]]),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.decision.projWeek.opponentRankVsPosition, null);
});

test('getPlayerCard: weeks[] projected rows carry their OWN run\'s opponentRankVsPosition (Ruling item 3, the canvas hover)', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weeklyProjection: (week) => ({
      median: 5,
      factors: {
        availability: { available: true },
        opponent: week === 1 ? { available: true, rank: 3, of: 32 } : { available: false },
      },
    }),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.weeks[0].week, 1);
  assert.equal(card.weeks[0].kind, 'projected');
  assert.deepEqual(card.weeks[0].opponentRankVsPosition, { rank: 3, of: 32 });
  assert.equal(card.weeks[1].kind, 'projected');
  assert.equal(card.weeks[1].opponentRankVsPosition, null);
});

// ---------------------------------------------------------------------------
// formal review f1: identity resolution (a plain `players` row never carries
// `identity_ids` - that only exists as player.router.js's list CTE alias)
// ---------------------------------------------------------------------------

test('getPlayerCard: the caller\'s roster holding a SIBLING identity row (not the requested id itself) still reads my_team and upgrade: null', async (t) => {
  const SIBLING_ID = 999; // same real athlete as PLAYER.id, a duplicate players row
  createFakePool(buildHandlers({
    identityIds: [PLAYER.id, SIBLING_ID],
    ownRosterRows: [{ player_id: SIBLING_ID }],
    rosteredBy: { team_id: TEAM.id, team_name: TEAM.name },
  })).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 12]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.availability.state, 'my_team');
  assert.equal(card.decision.upgrade, null);
});

// ---------------------------------------------------------------------------
// #1356: seasons[] - league-scored season summary, weeks and game log per
// season on record for the player.
// ---------------------------------------------------------------------------

// Full PPR (reception: 1) rather than the app-default half-PPR (0.5) that
// player_season_stats.fantasy_points is stored under - every points/rank
// assertion below that leans on "differs from the stored column" needs the
// league's rules to actually diverge from that default.
const FULL_PPR_LEAGUE = { ...LEAGUE, scoring_rules: { receiving: { reception: 1 } } };

/** One week's raw player_stats.stats: `receptions` receptions for `yards` receiving yards. */
function receivingStats(receptions, yards) {
  return { receptions, receivingYards: yards };
}

/**
 * Extends `buildHandlers` with the season-scoped queries `seasons[]` adds:
 * a per-season nfl_games schedule read and one player_season_stats
 * position-group read per season (`getRescoredPositionRank`). `weeklyRows`
 * and `seasonRows` seed the two base player_stats/player_season_stats
 * reads. `scheduleRows` (`{ season, team, week, opponent }`) seeds the
 * per-season schedule read - `team` is checked (formal review f2: a past
 * season's schedule query must use THAT season's played team, not today's
 * `player.nfl_team`) via a raw-value match; every fixture's team code (`KC`,
 * `DEN`, ...) is left untouched by `normalizeNflTeam`, so a plain equality
 * check is exact. `positionSeasonRows` (`{ player_id, position, season,
 * stats, fantasy_points }`, every position/season together) seeds the
 * position-rank read, filtered on BOTH `position` and `season` params
 * (formal review f3: the fake must actually check `position`, not just
 * `season`, or dropping the position filter from the real query would stay
 * green).
 */
function buildSeasonHandlers({
  league = LEAGUE,
  player = PLAYER,
  weeklyRows = [], // { season, week, stats } across every season, newest first
  seasonRows = [], // { season, games_played, stats } across every season
  scheduleRows = [], // { season, team, week, opponent }
  positionSeasonRows = [], // { player_id, position, season, stats, fantasy_points }
} = {}) {
  return [
    // Overrides first: `handlers.find` takes the FIRST match, and
    // `buildHandlers` below already answers the plain player_stats/
    // player_season_stats/nfl_games patterns these seasons[] tests need to
    // seed with real data instead.
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: weeklyRows })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: seasonRows })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id" = \$1 AND "season" = \$2/, (text, params) => ({
      rows: weeklyRows.filter((r) => r.season === params[1] && r.week < params[2]).map((r) => ({ week: r.week, stats: r.stats })),
    })],
    // Both the top-level (current-season) and the per-past-season schedule
    // reads share this exact SQL shape (`getPlayerCard`'s own design: a past
    // season reuses the current season's query, just with that season's own
    // team) - $1 is season, $2 is team.
    [/^SELECT "week", "opponent" FROM "nfl_games" WHERE "season" = \$1/, (text, params) => ({
      rows: scheduleRows.filter((r) => r.season === params[0] && r.team === params[1]),
    })],
    [/^SELECT "pss"\."player_id"/, (text, params) => ({
      rows: positionSeasonRows.filter((r) => r.position === params[0] && r.season === params[1]),
    })],
    ...buildHandlers({ league, player }),
  ];
}

test('getPlayerCard: a player with 2024, 2025 and 2026 (current) rows returns three seasons entries newest first', async (t) => {
  const league = { ...FULL_PPR_LEAGUE, current_season: 2026, current_week: 3 };
  const weeklyRows = [
    { season: 2026, week: 1, stats: receivingStats(4, 40) },
    { season: 2026, week: 2, stats: receivingStats(3, 30) },
    { season: 2025, week: 1, stats: receivingStats(5, 50) },
    { season: 2025, week: 2, stats: receivingStats(6, 60) },
    { season: 2024, week: 1, stats: receivingStats(2, 20) },
  ];
  // f4: the rollup `stats`/`fantasy_points` deliberately DON'T match the sum
  // of the seeded weekly rows - an implementation that rescored the rollup
  // aggregate instead of the weekly rows would produce a different number
  // than the assertion below expects, catching that substitution.
  const seasonRows = [
    { season: 2025, games_played: 2, stats: receivingStats(99, 999), fantasy_points: 16.5 },
    { season: 2024, games_played: 1, stats: receivingStats(50, 500), fantasy_points: 3 },
  ];
  createFakePool(buildSeasonHandlers({ league, weeklyRows, seasonRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026, 2025, 2024]);

  // 2024: full-PPR points over its own weekly rows (2 receptions * 1 + 20 * 0.1 = 4)
  // - not the rollup's aggregate stats (which would score very differently), and
  // that differs from the stored (half-PPR) fantasy_points column (3) too.
  const y2024 = card.seasons.find((s) => s.season === 2024);
  assert.equal(y2024.points, 4);
  assert.notEqual(y2024.points, seasonRows[1].fantasy_points);
  assert.equal(y2024.games, 1);
  assert.equal(y2024.adp, null);
  assert.ok(y2024.weeks.every((w) => w.kind !== 'projected'));
});

// ---------------------------------------------------------------------------
// formal review f1 (Cory's ruling on #1356, 2026-09-13): seasons[0] is ALWAYS
// league.current_season, built from the top-level weeks/log.current - even
// with zero current-season rows on file.
// ---------------------------------------------------------------------------

test('getPlayerCard: seasons[0] is the current season (built from the top-level weeks/log.current) even when the player has only PAST-season rows', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  const weeklyRows = [{ season: 2025, week: 1, stats: receivingStats(5, 50) }];
  createFakePool(buildSeasonHandlers({ league, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026, 2025]);
  assert.equal(card.seasons[0].season, 2026);
  assert.deepEqual(card.seasons[0].weeks, card.weeks);
  assert.deepEqual(card.seasons[0].log, card.log.current);
  assert.equal(card.seasons[0].games, 0);
  assert.equal(card.seasons[0].points, 0);
  assert.equal(card.seasons[0].posRank, null);
});

test('getPlayerCard: a player with no stats rows at all returns ONE seasons entry (the current season), never [] and never a throw', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  createFakePool(buildSeasonHandlers({ league })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026]);
  assert.equal(card.seasons[0].games, 0);
  assert.equal(card.seasons[0].points, 0);
  assert.equal(card.seasons[0].pointsPerGame, 0);
  assert.equal(card.seasons[0].posRank, null);
  assert.deepEqual(card.seasons[0].log, []);
});

test('getPlayerCard: adp is a number on the current-season entry and null on every past season', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 3 };
  const player = { ...PLAYER, adp: 12.4 };
  const weeklyRows = [
    { season: 2026, week: 1, stats: receivingStats(4, 40) },
    { season: 2025, week: 1, stats: receivingStats(5, 50) },
  ];
  createFakePool(buildSeasonHandlers({ league, player, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: player.id });

  assert.equal(card.seasons.find((s) => s.season === 2026).adp, 12.4);
  assert.equal(card.seasons.find((s) => s.season === 2025).adp, null);
});

test('getPlayerCard: posRank ranks a seeded position of three players by the RESCORED points under a TE-premium rule, not the stored column, and excludes a different position (formal review f3)', async (t) => {
  // TE-premium: a 2-point-per-reception bonus on top of the reception rate
  // reorders a high-reception, low-yardage player above a low-reception,
  // high-yardage one relative to the stored half-PPR ranking.
  const league = { ...LEAGUE, current_season: 2026, current_week: 1, scoring_rules: { receiving: { reception: 2.5 } } };
  const weeklyRows = [
    { season: 2025, week: 1, stats: receivingStats(10, 40) }, // PLAYER (55): rescores highest
  ];
  const positionSeasonRows = [
    { player_id: 55, position: 'WR', season: 2025, stats: receivingStats(10, 40), fantasy_points: 24 }, // PLAYER: stored half-PPR rank 2nd
    { player_id: 56, position: 'WR', season: 2025, stats: receivingStats(2, 120), fantasy_points: 28 }, // stored half-PPR rank 1st
    { player_id: 57, position: 'WR', season: 2025, stats: receivingStats(1, 10), fantasy_points: 3.5 },
    // A different position in the SAME season: if the fake (or the real
    // query) dropped the position filter, this would inflate posRankOf to 4
    // and could shift PLAYER's rank.
    { player_id: 58, position: 'TE', season: 2025, stats: receivingStats(20, 200), fantasy_points: 60 },
  ];
  createFakePool(buildSeasonHandlers({ league, weeklyRows, positionSeasonRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  const y2025 = card.seasons.find((s) => s.season === 2025);
  // Rescored under reception: 2.5 -> PLAYER: 10*2.5 + 40*0.1 = 29; id56: 2*2.5 + 120*0.1 = 17.
  // PLAYER now ranks 1st, reversing the stored (half-PPR) order where id56 led.
  assert.equal(y2025.posRank, 1);
  // Only the 3 WRs count - the TE (id 58) is excluded from posRankOf.
  assert.equal(y2025.posRankOf, 3);
});

test('getPlayerCard: a rookie with only the current season returns one seasons entry', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 2 };
  const weeklyRows = [{ season: 2026, week: 1, stats: receivingStats(3, 30) }];
  createFakePool(buildSeasonHandlers({ league, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.seasons.length, 1);
  assert.equal(card.seasons[0].season, 2026);
});

// ---------------------------------------------------------------------------
// formal review f2: a past season's schedule and bye week come from the team
// the player actually played THAT season (stats.gameTeam), not today's
// player.nfl_team - and a log row prefers its own stats.gameOpponent.
// ---------------------------------------------------------------------------

test('getPlayerCard: a traded player\'s past-season bye/schedule come from that season\'s OWN team, not today\'s player.nfl_team', async (t) => {
  const player = { ...PLAYER, nfl_team: 'DEN' }; // today's team
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  // 2025: the player was on KC (every weekly row's stats.gameTeam), not DEN.
  const weeklyRows = [
    { season: 2025, week: 5, stats: { ...receivingStats(6, 60), gameTeam: 'KC', gameOpponent: 'LV' } },
    { season: 2025, week: 6, stats: { ...receivingStats(4, 40), gameTeam: 'KC', gameOpponent: 'DEN' } },
  ];
  const scheduleRows = [
    // The KC schedule's own week-6 opponent ('SF') deliberately differs from
    // that week's row-level stats.gameOpponent ('DEN') below, so the log
    // assertion can tell which one actually won.
    { season: 2025, team: 'KC', week: 5, opponent: 'LV' },
    { season: 2025, team: 'KC', week: 6, opponent: 'SF' },
  ];
  createFakePool(buildSeasonHandlers({ league, player, weeklyRows, scheduleRows })).install(t);
  const byeCallTeams = [];
  mockServices(t);
  t.mock.method(byeService, 'computeByeWeek', async (team, s) => {
    byeCallTeams.push([team, s]);
    // DEN's 2025 bye happens to land on week 5, the week the player actually
    // played (for KC) - the wrong-team lookup this reproduces.
    if (team === 'DEN' && s === 2025) return 5;
    if (team === 'KC' && s === 2025) return 9;
    return null;
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: player.id });

  // The bye/schedule lookups for 2025 ran against KC (the season's own
  // team), never DEN (today's).
  assert.ok(byeCallTeams.some(([team, s]) => team === 'KC' && s === 2025));
  assert.ok(!byeCallTeams.some(([team, s]) => team === 'DEN' && s === 2025));

  const y2025 = card.seasons.find((s) => s.season === 2025);
  const week5 = y2025.weeks.find((w) => w.week === 5);
  // The played week still ships 'actual' with points, not 'bye'.
  assert.equal(week5.kind, 'actual');
  assert.equal(week5.opponent, 'LV');
  assert.ok(week5.points > 0);

  // A log row prefers its OWN stats.gameOpponent ('DEN') over the derived
  // KC schedule's own week-6 opponent ('SF') - the bars use the schedule.
  const logWeek6 = y2025.log.find((w) => w.week === 6);
  assert.equal(logWeek6.opponent, 'DEN');
  const week6Bar = y2025.weeks.find((w) => w.week === 6);
  assert.equal(week6Bar.opponent, 'SF');
});

// ---------------------------------------------------------------------------
// #1667: the one read carries line, weather, usage (by side) and opponents
// ---------------------------------------------------------------------------

test('getPlayerCard: IDP usage reads the defense snap keys, not the offense ones (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  const lb = { ...PLAYER, id: 61, position: 'LB' };
  createFakePool([
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [{ week: 4 }] })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id"/, () => ({
      rows: [{ week: 4, stats: {
        gameTeam: 'BUF', usageDefenseSnaps: 60, usageDefenseSnapPct: 0.9, usageOffenseSnaps: 3, usageOffenseSnapPct: 0.05,
      } }],
    })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "season"/, () => ({ rows: [] })],
    ...buildHandlers({ league, player: lb }),
  ]).install(t);
  mockServices(t, { realUsage: true });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: lb.id });

  assert.equal(card.decision.usage.weeks[0].snaps, 60);
  assert.equal(card.decision.usage.weeks[0].snapShare, 0.9);
});

test('getPlayerCard: a free agent gets line, weather, usage and opponents (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  decisionCardContextService.clearLeagueContextMemo();
  createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [{ week: 5, opponent: 'DAL' }] })],
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_BUF_DAL', roof: 'outdoors', home_away: 'away' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({
      rows: [{ total: '47.00', spread: '-3.00', observed_at: '2026-10-01T12:00:00.000Z' }],
    })],
    [/^SELECT "temperature_f".*FROM "game_weather_snapshots"/, () => ({
      rows: [{ temperature_f: '45.5', wind_speed_mph: '10', wind_gust_mph: '18', precipitation_probability: 20, short_forecast: 'Cloudy', fetched_at: new Date() }],
    })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [{ player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } }],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }] })],
    ...buildHandlers({ league }),
  ]).install(t);
  mockServices(t);
  t.mock.method(decisionCardContextService, 'loadUsage', async () => ({ weeks: [], seasonAverage: null }));

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.availability.state, 'free_agent');
  assert.equal(card.line.total, 47);
  assert.equal(card.line.impliedTeamTotal, 22);
  assert.equal(card.weather.temperatureF, 45.5);
  assert.deepEqual(card.decision.usage, { weeks: [], seasonAverage: null });
  assert.equal(card.opponents.length, 1);
  assert.equal(card.opponents[0].opponent, 'DAL');
});

test('getPlayerCard: opponents cover the next three weeks, binding [week, week + 2] (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  decisionCardContextService.clearLeagueContextMemo();
  const fake = createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({
      rows: [{ week: 5, opponent: 'DAL' }, { week: 6, opponent: 'NYG' }, { week: 7, opponent: 'DAL' }],
    })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [
        { player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } },
        { player_id: 23, week: 1, position: 'WR', defense: 'NYG', stats: { receivingYards: 20 } },
      ],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }, { team: 'NYG', games: 4 }] })],
    ...buildHandlers({ league }),
  ]);
  fake.install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  const windowCall = fake.calls.find((c) => /^SELECT "week", "opponent" FROM "nfl_games" WHERE "season" = \$1 AND "week" >= \$2/.test(c.text));
  assert.deepEqual(windowCall.params, [2026, 5, 7, 'BUF']);
  assert.deepEqual(card.opponents.map((o) => [o.week, o.opponent, o.rankVsPosition]), [
    [5, 'DAL', 1], [6, 'NYG', 2], [7, 'DAL', 1],
  ]);
});

/** A memo fixture: counts season scans, with one game in the window. */
function memoFixture(t, { league = { ...LEAGUE, current_week: 5 } } = {}) {
  decisionCardContextService.clearLeagueContextMemo();
  const fake = createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [{ week: 5, opponent: 'DAL' }] })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [{ player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } }],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, (text, params) => ({
      rows: [{ ...PLAYER, id: params[0], position: params[0] === 99 ? 'RB' : 'WR' }],
    })],
    ...buildHandlers({ league }),
  ]);
  fake.install(t);
  mockServices(t);
  const scans = () => fake.calls.filter((c) => /FROM "player_stats" "ps"/.test(c.text)).length;
  return { scans };
}

test('getPlayerCard: two reads at one position, league and week run the season scan once; another position runs it again (#1667)', async (t) => {
  const { scans } = memoFixture(t);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 56 });
  assert.equal(scans(), 1);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 99 });
  assert.equal(scans(), 2);
});

test('getPlayerCard: a read after the ten-minute lifetime runs the season scan again (#1667)', async (t) => {
  const { scans } = memoFixture(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  now += decisionCardContextService.LEAGUE_CONTEXT_TTL_MS - 1;
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 56 });
  assert.equal(scans(), 1);

  now += 2;
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  assert.equal(scans(), 2);
});

test('getPlayerCard (#1682): a failing loadGameContext degrades line and weather to null; the rest of the card still ships', async (t) => {
  createFakePool(buildHandlers({ league: LEAGUE })).install(t);
  mockServices(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(decisionCardContextService, 'loadGameContext', async () => { throw new Error('odds down'); });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.line, null);
  assert.equal(card.weather, null);
  assert.ok(Array.isArray(card.news));
});

test('getPlayerCard (#1682): a failing loadOpponents degrades opponents to []', async (t) => {
  createFakePool(buildHandlers({ league: LEAGUE })).install(t);
  mockServices(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(decisionCardContextService, 'loadOpponents', async () => { throw new Error('scan down'); });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.opponents, []);
});

// #1849: the Volatility tag rides decision.volatility, read off the card's own run entry.
test('getPlayerCard (#1849): decision.volatility is the tag read for the player\'s own entry; a failed read hides the tag, not the card', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });
  const calls = [];
  const read = t.mock.method(decisionCardContextService, 'loadVolatility', async (args) => {
    calls.push(args);
    return 'boom_or_bust';
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.decision.volatility, 'boom_or_bust');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].entry.mean, 14.5);
  assert.equal(calls[0].week, LEAGUE.current_week);
  assert.equal(calls[0].player.id, PLAYER.id);

  read.mock.mockImplementation(async () => { throw new Error('boom'); });
  t.mock.method(console, 'error', () => {});
  const failed = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(failed.decision.volatility, null);
});

test('getPlayerCard (#1849): an ineligible entry (no sample size on the fixture) carries decision.volatility: null', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t);
  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.decision.volatility, null);
});

// #1923: the practice line rides player.practice and moves nothing else.
test("getPlayerCard (#1923): player.practice is the week's entries, read for the card's own season and week; a rejected read is null and the card ships", async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t);
  const entries = [{ status: 'Limited', day: 'Wed' }];
  const read = t.mock.method(practiceParticipation, 'weekPracticeEntries', async () => entries);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id, week: 4 });
  assert.deepEqual(card.player.practice, entries);
  assert.deepEqual(read.mock.calls[0].arguments[1], { season: LEAGUE.current_season, week: 4, playerId: PLAYER.id });

  read.mock.mockImplementation(async () => { throw new Error('boom'); });
  t.mock.method(console, 'error', () => {});
  const failed = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(failed.player.practice, null);
  assert.equal(failed.player.name, PLAYER.name);
  assert.ok(Array.isArray(failed.news));
});

test('getPlayerCard (#1923): entries or none, the payload and every projection read are identical but for player.practice', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });
  const read = t.mock.method(practiceParticipation, 'weekPracticeEntries', async () => [{ status: 'Full', day: 'Fri' }]);
  const weekly = projectionService.getWeeklyProjections.mock;
  const forWeeks = projectionService.getWeeklyProjectionsForWeeks.mock;

  const withEntries = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  const weeklyCut = weekly.calls.length;
  const forWeeksCut = forWeeks.calls.length;
  read.mock.mockImplementation(async () => null);
  const without = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(withEntries.player.practice, [{ status: 'Full', day: 'Fri' }]);
  assert.equal(without.player.practice, null);
  delete withEntries.player.practice;
  delete without.player.practice;
  assert.deepEqual(withEntries, without);
  const args = (mock, from, to) => mock.calls.slice(from, to).map((c) => c.arguments);
  assert.deepEqual(args(weekly, 0, weeklyCut), args(weekly, weeklyCut));
  assert.deepEqual(args(forWeeks, 0, forWeeksCut), args(forWeeks, forWeeksCut));
});

// Backup quarterback (ADR 0057): Case Keenum, week 5 of 2026 - one start (24.48
// in week 3) gives him a real 20.25 projection, but the Depth chart has him
// QB3 behind an available Tyson Bagent (Caleb Williams Out), so he will not
// play. He is never an Upgrade, however high his own number is; the number
// itself stays (ADR 0044).
test('upgradesFor (ADR 0057): a Backup quarterback gets null, an evidenced starter keeps his Upgrade', async (t) => {
  const KEENUM_ID = 458;
  const STARTER_ID = 56;
  const qbSlots = { ...LEAGUE, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [
        { id: KEENUM_ID, position: 'QB', nfl_team: 'CHI' },
        { id: STARTER_ID, position: 'QB', nfl_team: 'DET' },
      ],
    })],
    ...buildHandlers({
      league: qbSlots,
      starterRows: [{ player_id: 999, slot: 'QB', name: 'Rostered QB', position: 'QB' }],
      identityIds: [KEENUM_ID],
    }),
  ]).install(t);
  mockServices(t);
  const entry = (points, reasons) => ({ mean: points, median: points, factors: { availability: { available: true }, dataQuality: { reasons } } });
  const points = new Map([[999, 16], [KEENUM_ID, 20.25], [STARTER_ID, 21]]);
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => projectionService.toWeeklyProjectionResult({
    projections: new Map(playerIds.map((id) => [id, entry(points.get(id), id === KEENUM_ID ? ['small sample'] : [])])),
    backupIds: new Set([KEENUM_ID]),
  }));

  const upgrades = await upgradesFor({
    league: qbSlots, team: TEAM, season: 2026, week: 5, playerIds: [KEENUM_ID, STARTER_ID],
  });

  assert.equal(upgrades.get(KEENUM_ID), null);
  assert.deepEqual(upgrades.get(STARTER_ID), {
    points: 5,
    overPlayer: { id: 999, name: 'Rostered QB', points: 16, unavailable: null },
    slot: 'QB',
    week: 5,
  });
});

// ADR 0057, rule 3: where a lineup is valued, a rostered Backup is worth 0 as an
// Unavailable roster player is (#1793). Keenum at 20.25 in the only QB slot
// would otherwise hide an 18-point free-agent QB's Upgrade over the 16 QB on the bench.
test('upgradesFor (ADR 0057): a rostered Backup quarterback does not mask a free-agent starter\'s Upgrade', async (t) => {
  const KEENUM_ID = 458;
  const FA_ID = 77;
  const qbSlots = { ...LEAGUE, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: FA_ID, position: 'QB', nfl_team: 'DET' }],
    })],
    ...buildHandlers({
      league: qbSlots,
      starterRows: [
        { player_id: KEENUM_ID, slot: 'QB', name: 'Case Keenum', position: 'QB' },
        { player_id: 999, slot: 'BENCH', name: 'Rostered QB', position: 'QB' },
      ],
      identityIds: [FA_ID],
    }),
  ]).install(t);
  mockServices(t);
  const entry = (points) => ({ mean: points, median: points, factors: { availability: { available: true }, dataQuality: { reasons: [] } } });
  const points = new Map([[999, 16], [KEENUM_ID, 20.25], [FA_ID, 18]]);
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => projectionService.toWeeklyProjectionResult({
    projections: new Map(playerIds.map((id) => [id, entry(points.get(id))])),
    backupIds: new Set([KEENUM_ID]),
  }));

  const upgrades = await upgradesFor({ league: qbSlots, team: TEAM, season: 2026, week: 5, playerIds: [FA_ID] });

  assert.deepEqual(upgrades.get(FA_ID), {
    points: 2,
    overPlayer: { id: 999, name: 'Rostered QB', points: 16, unavailable: null },
    slot: 'QB',
    week: 5,
  });

  // Control: the same roster without the verdict leaves the 18 no Upgrade.
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => projectionService.toWeeklyProjectionResult({
    projections: new Map(playerIds.map((id) => [id, entry(points.get(id))])),
  }));
  const control = await upgradesFor({ league: qbSlots, team: TEAM, season: 2026, week: 5, playerIds: [FA_ID] });
  assert.equal(control.get(FA_ID).points, 0);
});

// ADR 0057, amended 2026-10-07 (#2044): Backup outranks Position-baseline, so a
// rostered QB who is both is still worth 0 in the roster baseline and does not
// hide a free-agent starter's Upgrade.
test('upgradesFor (ADR 0057): a rostered QB who is both Position-baseline and Backup is valued 0, so a free-agent QB keeps his Upgrade', async (t) => {
  const BOTH_ID = 458;
  const FA_ID = 77;
  const qbSlots = { ...LEAGUE, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [{ id: FA_ID, position: 'QB', nfl_team: 'DET' }],
    })],
    ...buildHandlers({
      league: qbSlots,
      starterRows: [
        { player_id: BOTH_ID, slot: 'QB', name: 'Both QB', position: 'QB' },
        { player_id: 999, slot: 'BENCH', name: 'Rostered QB', position: 'QB' },
      ],
      identityIds: [FA_ID],
    }),
  ]).install(t);
  mockServices(t);
  const entry = (points, reasons = []) => ({ mean: points, median: points, factors: { availability: { available: true }, dataQuality: { reasons } } });
  const points = new Map([[999, 16], [BOTH_ID, 20.25], [FA_ID, 18]]);
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => projectionService.toWeeklyProjectionResult({
    projections: new Map(playerIds.map((id) => [id, entry(points.get(id), id === BOTH_ID ? ['position baseline'] : [])])),
    backupIds: new Set([BOTH_ID]),
  }));

  const upgrades = await upgradesFor({ league: qbSlots, team: TEAM, season: 2026, week: 5, playerIds: [FA_ID] });

  assert.deepEqual(upgrades.get(FA_ID), {
    points: 2,
    overPlayer: { id: 999, name: 'Rostered QB', points: 16, unavailable: null },
    slot: 'QB',
    week: 5,
  });
});

// Start verdict (spec #2042, #2044): the Upgrade follows the verdict alone.
// Unavailable, and Not recommended with an untrusted number (Position-baseline,
// Backup), get null; a Doubtful candidate's number is his own evidence, so he
// keeps his Upgrade. The verdicts are fixture data here, not derived, so the
// rule under test is the reader's.
test('upgradesFor (Start verdict): a Doubtful candidate keeps an Upgrade; Unavailable, Position-baseline and Backup get null', async (t) => {
  const [DOUBTFUL, BASELINE, BACKUP, OUT] = [61, 62, 63, 64];
  const qbSlots = { ...LEAGUE, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: [DOUBTFUL, BASELINE, BACKUP, OUT].map((id) => ({ id, position: 'QB', nfl_team: 'DET' })),
    })],
    ...buildHandlers({
      league: qbSlots,
      starterRows: [{ player_id: 999, slot: 'QB', name: 'Rostered QB', position: 'QB' }],
      identityIds: [DOUBTFUL, BASELINE, BACKUP, OUT],
    }),
  ]).install(t);
  mockServices(t);
  const verdicts = new Map([
    [DOUBTFUL, { outcome: 'not_recommended', reason: 'doubtful', numberTrusted: true }],
    [BASELINE, { outcome: 'not_recommended', reason: 'no_history', numberTrusted: false }],
    [BACKUP, { outcome: 'not_recommended', reason: 'backup', numberTrusted: false }],
    [OUT, { outcome: 'unavailable', reason: 'out', numberTrusted: true }],
  ]);
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => ({
    ...projectionService.toWeeklyProjectionResult({
      projections: new Map(playerIds.map((id) => [id, {
        mean: id === 999 ? 16 : 20, median: id === 999 ? 16 : 20, factors: { availability: { available: true }, dataQuality: { reasons: [] } },
      }])),
    }),
    startVerdictFor: (id) => verdicts.get(id) || { outcome: 'recommendable', reason: null, numberTrusted: true },
  }));

  const upgrades = await upgradesFor({
    league: qbSlots, team: TEAM, season: 2026, week: 5, playerIds: [DOUBTFUL, BASELINE, BACKUP, OUT],
  });

  assert.equal(upgrades.get(DOUBTFUL).points, 4);
  assert.equal(upgrades.get(BASELINE), null);
  assert.equal(upgrades.get(BACKUP), null);
  assert.equal(upgrades.get(OUT), null);
});

// Start verdict (spec #2042): the card payload carries the Weekly projection
// read's verdict, so every surface that opens the card shows its notes.
function cardWithRun(t, { designation = null, practice, backup = false }) {
  createFakePool(buildHandlers({ player: { ...PLAYER, injury_status: designation } })).install(t);
  mockServices(t);
  const factors = { availability: { available: true, status: designation, reason: designation === 'Q' ? 'questionable' : null } };
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => projectionService.toWeeklyProjectionResult({
    projections: new Map(playerIds.map((id) => [id, { mean: 12, median: 12, factors }])),
    backupIds: backup ? new Set([PLAYER.id]) : undefined,
    practiceById: practice ? new Map([[PLAYER.id, practice]]) : undefined,
  }));
  return getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
}

const SUNDAY_1PM = '2026-10-11T17:00:00Z';
const didNotPractice = (observedAt) => ({
  practiceStatus: 'Did Not Participate In Practice', practicePrimaryInjury: 'Hamstring', reportPrimaryInjury: 'Hamstring', observedAt,
});

test('getPlayerCard (start verdict): a Questionable player with no practice all week reads not_recommended, no_practice, number trusted', async (t) => {
  const card = await cardWithRun(t, {
    designation: 'Q',
    practice: { observations: [didNotPractice('2026-10-07T22:00:00Z'), didNotPractice('2026-10-08T22:00:00Z')], kickoffAt: SUNDAY_1PM },
  });
  assert.deepEqual(card.startVerdict, { outcome: 'not_recommended', reason: 'no_practice', numberTrusted: true });
});

test('getPlayerCard (start verdict): a Backup quarterback reads numberTrusted false', async (t) => {
  const backup = await cardWithRun(t, { backup: true });
  assert.deepEqual(backup.startVerdict, { outcome: 'not_recommended', reason: 'backup', numberTrusted: false });
});

test('getPlayerCard (start verdict): a Questionable player with no observations stays recommendable', async (t) => {
  const card = await cardWithRun(t, { designation: 'Q' });
  assert.deepEqual(card.startVerdict, { outcome: 'recommendable', reason: 'questionable', numberTrusted: true });
});

// ---------------------------------------------------------------------------
// #2166: a Free agent's or waiver player's Upgrade is read in his first
// playable week (ADR 0062). Every case injects `now`; the league is in week 1
// (last playoff week 16), the candidate plays for BUF, the one roster starter
// (999) is a weak WR1 in a one-WR league.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-13T12:00:00Z');
const game = (nfl_team, week, kickoff_at) => ({ nfl_team, week, kickoff_at: new Date(kickoff_at) });
const WK1_AFTER_NOW = '2026-09-13T17:00:00Z';
const WK1_BEFORE_NOW = '2026-09-13T08:00:00Z';
const WK2 = '2026-09-20T17:00:00Z';
const AVAILABLE = { available: true };

// The candidate projects 14 in week 1 and 11 in week 2; the starter 5 either week.
function weekAwareProjection(overrides = {}) {
  return (week, id) => {
    if (overrides[id]) return overrides[id](week);
    if (id === 999) return { mean: 5, median: 5, factors: { availability: AVAILABLE } };
    const points = week === 1 ? 14 : 11;
    return { mean: points, median: points, factors: { availability: AVAILABLE } };
  };
}

function firstWeekWorld(t, {
  league = wrSlots(1), schedule, waiverRows = [], rosteredElsewhere = [], weeklyProjection = weekAwareProjection(),
  candidates = [{ id: PLAYER.id, nfl_team: 'BUF' }],
}) {
  const kickedOffTeams = schedule
    .filter((g) => g.week === league.current_week && g.kickoff_at <= NOW)
    .map((g) => g.nfl_team);
  const fake = createFakePool([
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: candidates.map((c) => ({ position: 'WR', ...c })),
    })],
    ...buildHandlers({
      league,
      starterRows: [{ player_id: 999, slot: 'WR', name: 'Weak Starter' }],
      schedule,
      waiverRows,
      rosteredElsewhere,
      kickedOffTeams,
    }),
  ]).install(t);
  const { weekProjectionCalls } = mockServices(t, { weeklyProjection });
  return {
    fake,
    weekProjectionCalls,
    materializedWeeks: () => lineupService.materializeLineup.mock.calls.map((c) => c.arguments[1].week),
  };
}

const readUpgrade = async (league, id = PLAYER.id) => (await upgradesFor({
  league, team: TEAM, season: 2026, week: league.current_week, playerIds: [id], now: NOW,
})).get(id);

test('upgradesFor (#2166 a): a Free agent whose team has not kicked off is read in the current week', async (t) => {
  firstWeekWorld(t, { schedule: [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)] });
  const upgrade = await readUpgrade(wrSlots(1));
  assert.equal(upgrade.week, 1);
  assert.equal(upgrade.points, 9);
});

test('upgradesFor (#2166 b): a Free agent whose team kicked off before now is read in the next week', async (t) => {
  const { materializedWeeks } = firstWeekWorld(t, { schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)] });
  const upgrade = await readUpgrade(wrSlots(1));
  assert.equal(upgrade.week, 2);
  assert.equal(upgrade.points, 6);
  assert.deepEqual(materializedWeeks(), [1], 'the later week is never materialized');
});

test('upgradesFor (#2166 c): a waiver player is read in the first week that kicks off after his Clear time', async (t) => {
  const schedule = [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)];
  const afterKickoff = firstWeekWorld(t, { schedule, waiverRows: [{ player_id: PLAYER.id, available_at: new Date('2026-09-14T00:00:00Z') }] });
  assert.equal((await readUpgrade(wrSlots(1))).week, 2);
  assert.deepEqual(afterKickoff.materializedWeeks(), [1]);
  t.mock.restoreAll();

  firstWeekWorld(t, { schedule, waiverRows: [{ player_id: PLAYER.id, available_at: new Date('2026-09-13T15:00:00Z') }] });
  assert.equal((await readUpgrade(wrSlots(1))).week, 1);
});

test('upgradesFor (#2166 c): a Clear time already past does not hold him; the comparison uses the injected now', async (t) => {
  firstWeekWorld(t, {
    schedule: [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)],
    waiverRows: [{ player_id: PLAYER.id, available_at: new Date('2026-09-12T00:00:00Z') }],
  });
  assert.equal((await readUpgrade(wrSlots(1))).week, 1);
});

test('upgradesFor (#2166): his own waiver row decides, not the later blanket clear time (processWaivers COALESCE)', async (t) => {
  // Own row clears at 15:00, before the 17:00 kickoff; the blanket clears at midnight, after it.
  const league = { ...wrSlots(1), waivers_clear_at: new Date('2026-09-14T00:00:00Z') };
  firstWeekWorld(t, {
    league,
    schedule: [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)],
    waiverRows: [{ player_id: PLAYER.id, available_at: new Date('2026-09-13T15:00:00Z') }],
  });
  assert.equal((await readUpgrade(league)).week, 1);
});

test('upgradesFor (#2166): with no waiver row the league\'s blanket clear time holds him', async (t) => {
  const league = { ...wrSlots(1), waivers_clear_at: new Date('2026-09-14T00:00:00Z') };
  firstWeekWorld(t, { league, schedule: [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)] });
  assert.equal((await readUpgrade(league)).week, 2);
});

test('upgradesFor (#2166): the injected now reaches the roster kickoff lock, not only the first-playable-week read', async (t) => {
  const { fake } = firstWeekWorld(t, { schedule: [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)] });
  await readUpgrade(wrSlots(1));
  const lockReads = fake.matching(/^SELECT "nfl_team" FROM "nfl_games"/);
  assert.equal(lockReads.length, 1);
  assert.deepEqual(lockReads[0].params, [2026, 1, NOW]);
});

test('upgradesFor (#2166 d): a Free agent on bye this week is read in the next week, with points', async (t) => {
  const { materializedWeeks } = firstWeekWorld(t, { schedule: [game('BUF', 2, WK2)] });
  const upgrade = await readUpgrade(wrSlots(1));
  assert.equal(upgrade.week, 2);
  assert.equal(upgrade.points, 6);
  assert.deepEqual(materializedWeeks(), [1]);
});

test('upgradesFor (#2166 e): a first playable week past the last playoff week is null', async (t) => {
  const league = { ...wrSlots(1), current_week: 16 };
  const { materializedWeeks } = firstWeekWorld(t, {
    league,
    schedule: [game('BUF', 16, WK1_BEFORE_NOW), game('BUF', 17, WK2)],
  });
  assert.equal(await readUpgrade(league), null);
  assert.deepEqual(materializedWeeks(), [16]);
});

test('upgradesFor (#2166 f): in a next-week read a roster player on bye that week counts zero in the baseline', async (t) => {
  const { materializedWeeks } = firstWeekWorld(t, {
    schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)],
    weeklyProjection: weekAwareProjection({
      999: (week) => ({
        mean: 5,
        median: 5,
        factors: { availability: week === 2 ? { available: false, reason: 'bye' } : AVAILABLE },
      }),
    }),
  });
  const upgrade = await readUpgrade(wrSlots(1));
  assert.equal(upgrade.week, 2);
  assert.equal(upgrade.points, 11);
  assert.deepEqual(upgrade.overPlayer, { id: 999, name: 'Weak Starter', points: 0, unavailable: 'bye' });
  assert.deepEqual(materializedWeeks(), [1]);
});

test('upgradesFor (#2166 g): an Out candidate is still null, judged on the verdict of his first playable week', async (t) => {
  firstWeekWorld(t, {
    schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)],
    weeklyProjection: weekAwareProjection({
      [PLAYER.id]: (week) => ({ mean: 14, median: 14, factors: { availability: week === 2 ? { available: false, reason: 'out' } : AVAILABLE } }),
    }),
  });
  assert.equal(await readUpgrade(wrSlots(1)), null);
});

test('upgradesFor (#2166): refusal uses the first playable week, so a candidate Out only this week keeps his next-week Upgrade', async (t) => {
  firstWeekWorld(t, {
    schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)],
    weeklyProjection: weekAwareProjection({
      [PLAYER.id]: (week) => ({ mean: 14, median: 14, factors: { availability: week === 1 ? { available: false, reason: 'out' } : AVAILABLE } }),
    }),
  });
  assert.equal((await readUpgrade(wrSlots(1))).week, 2);
});

test('upgradesFor (#2166): another team\'s player keeps today\'s behaviour, the current week (#2167)', async (t) => {
  firstWeekWorld(t, {
    schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)],
    rosteredElsewhere: [PLAYER.id],
  });
  assert.equal((await readUpgrade(wrSlots(1))).week, 1);
});

test('upgradesFor (#2166): an unsynced schedule (no game rows at all) falls back to the current week', async (t) => {
  firstWeekWorld(t, { schedule: [] });
  assert.equal((await readUpgrade(wrSlots(1))).week, 1);
});

test('upgradesFor (#2166): one getWeeklyProjections call per distinct first playable week', async (t) => {
  const { weekProjectionCalls } = firstWeekWorld(t, {
    schedule: [
      game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2),
      game('KC', 1, WK1_BEFORE_NOW), game('KC', 2, WK2),
      game('SF', 1, WK1_BEFORE_NOW), game('SF', 2, WK2),
    ],
    candidates: [
      { id: 55, nfl_team: 'BUF' },
      { id: 56, nfl_team: 'KC' },
      { id: 57, nfl_team: 'SF' },
    ],
  });
  const upgrades = await upgradesFor({
    league: wrSlots(1), team: TEAM, season: 2026, week: 1, playerIds: [55, 56, 57], now: NOW,
  });
  assert.deepEqual([55, 56, 57].map((id) => upgrades.get(id).week), [1, 2, 2]);
  assert.deepEqual(weekProjectionCalls.map((c) => c.week), [1, 2], 'two calls: this week and next, not one per candidate');
});
