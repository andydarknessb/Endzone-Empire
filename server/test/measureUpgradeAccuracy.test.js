const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs, measureUpgradeAccuracy, firstPlayableWeek, acquisitionsOf, weekAt,
} = require('../scripts/measure-upgrade-accuracy');

// One RB slot and a bench: the Upgrade is the candidate's number over the
// starter he beats, so every expected value below is a subtraction.
const RB1 = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];

// The week input: the stored lineup without the acquired player. `projection`
// is what the stored run said, `actual` what the player scored as played.
const starter = (projection, actual = projection) => ({
  playerId: 1, name: 'Starter', position: 'RB', slot: 'RB', projection, actual, unavailable: null, kickedOff: false,
});

const acquisition = (overrides) => ({
  playerId: 99, position: 'RB', rosterSlots: RB1, ...overrides,
});

test('(a) a candidate who had kicked off before the claim is a false promise under the old rule only', () => {
  // Week 4: his game was played before the claim, so the old rule still prices
  // him at 15 against the starter's 10 (+5). His first playable week is 5,
  // where he projects 8 and adds nothing; he scores 6 and still adds nothing.
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 4,
    firstPlayableWeek: 5,
    weeks: {
      4: { roster: [starter(10)], predicted: 15, actual: 20 },
      5: { roster: [starter(10)], predicted: 8, actual: 6 },
    },
  })]);
  assert.equal(result.old.positive, 1);
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.old.falsePromiseShare, 1);
  assert.equal(result.new.positive, 0);
  assert.equal(result.new.falsePromises, 0);
  assert.equal(result.new.falsePromiseShare, null);
});

test('(b) a candidate who realized exactly his prediction contributes zero error to both rules', () => {
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 6,
    firstPlayableWeek: 6,
    weeks: { 6: { roster: [starter(10)], predicted: 14, actual: 14 } },
  })]);
  assert.equal(result.count, 1);
  assert.equal(result.old.mae, 0);
  assert.equal(result.new.mae, 0);
});

test('(c) the mean absolute error over three acquisitions is the hand-computed value', () => {
  const result = measureUpgradeAccuracy([
    // old = new = 15 - 10 = 5; realized 12 - 9 = 3; error 2 under both rules.
    acquisition({
      acquiredWeek: 3,
      firstPlayableWeek: 3,
      weeks: { 3: { roster: [starter(10, 9)], predicted: 15, actual: 12 } },
    }),
    // old = new = 9 - 8 = 1; realized 10 - 11 < 0 so 0; error 1, a false promise.
    acquisition({
      acquiredWeek: 4,
      firstPlayableWeek: 4,
      weeks: { 4: { roster: [starter(8, 11)], predicted: 9, actual: 10 } },
    }),
    // old: week 5, 20 - 10 = 10. new: week 6, 13 - 10 = 3. realized 16 - 10 = 6.
    // error 4 under the old rule, 3 under the new.
    acquisition({
      acquiredWeek: 5,
      firstPlayableWeek: 6,
      weeks: {
        5: { roster: [starter(10)], predicted: 20, actual: 0 },
        6: { roster: [starter(10)], predicted: 13, actual: 16 },
      },
    }),
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.old.mae, 2.33); // (2 + 1 + 4) / 3
  assert.equal(result.new.mae, 2); // (2 + 1 + 3) / 3
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.old.positive, 3);
  assert.equal(result.new.falsePromises, 1);
  assert.equal(result.new.positive, 3);
});

test('a candidate with no playable week left realizes nothing and the new rule promises nothing', () => {
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 17,
    firstPlayableWeek: null,
    weeks: { 17: { roster: [starter(10)], predicted: 15, actual: 0 } },
  })]);
  assert.equal(result.old.mae, 5);
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.new.mae, 0);
  assert.equal(result.new.positive, 0);
});

test('an empty input reports no error and no share rather than NaN', () => {
  const result = measureUpgradeAccuracy([]);
  assert.deepEqual(result, {
    count: 0,
    old: { mae: null, positive: 0, falsePromises: 0, falsePromiseShare: null },
    new: { mae: null, positive: 0, falsePromises: 0, falsePromiseShare: null },
  });
});

test('firstPlayableWeek skips a bye and a game already kicked off, and is null past the last week', () => {
  const kickoffs = new Map([[4, new Date('2026-10-04T17:00:00Z')], [6, new Date('2026-10-18T17:00:00Z')]]);
  const joinAt = new Date('2026-10-05T12:00:00Z');
  assert.equal(firstPlayableWeek(kickoffs, 4, 18, joinAt), 6); // week 4 kicked off, week 5 is a bye
  assert.equal(firstPlayableWeek(kickoffs, 4, 5, joinAt), null);
  assert.equal(firstPlayableWeek(undefined, 4, 18, joinAt), 4); // no schedule locks nobody
});

test('acquisitionsOf credits a trade to the receiving team and skips an undone drop', () => {
  const at = '2026-10-05T12:00:00Z';
  const found = acquisitionsOf([
    { type: 'add', team_id: 1, detail: { playerId: 10 }, created_at: at },
    { type: 'add', team_id: 1, detail: { playerId: 11, undo: true }, created_at: at },
    { type: 'waiver', team_id: 2, detail: { playerId: 12, droppedPlayerId: null }, created_at: at },
    {
      type: 'trade', team_id: 3, created_at: at,
      detail: { items: [{ playerId: 13, fromTeamId: 3, toTeamId: 4 }, { playerId: 14, fromTeamId: 4, toTeamId: 3 }] },
    },
  ]);
  assert.deepEqual(found.map((a) => [a.teamId, a.playerId]), [[1, 10], [2, 12], [4, 13], [3, 14]]);
});

test('weekAt is the latest week started by then, null before the first', () => {
  const starts = new Map([[1, new Date('2026-09-08T00:00:00Z')], [2, new Date('2026-09-15T00:00:00Z')]]);
  assert.equal(weekAt(starts, new Date('2026-09-10T00:00:00Z')), 1);
  assert.equal(weekAt(starts, new Date('2026-09-16T00:00:00Z')), 2);
  assert.equal(weekAt(starts, new Date('2026-09-01T00:00:00Z')), null);
});

test('parseArgs reads league, season and the week range, and refuses a missing league', () => {
  assert.deepEqual(
    parseArgs(['--league', '7', '--season', '2026', '--from-week', '2', '--to-week', '5']),
    { help: false, league: 7, season: 2026, fromWeek: 2, toWeek: 5 }
  );
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--season', '2026']), /--league/);
  assert.throws(() => parseArgs(['--league', 'x', '--season', '2026']), /--league/);
});

// ---------------------------------------------------------------------------
// The database shell, against a pool that answers by statement. It pins the
// wiring the pure core cannot: which week each rule reads, the run cutoff, the
// acquired player leaving the roster, and that every statement is a read.
// ---------------------------------------------------------------------------

test('buildAcquisitions reads the old rule in the claim week and the new rule in his first playable week', async (t) => {
  const lineupService = require('../services/lineup.service');
  const { MODEL_VERSION } = require('../services/projection.service');
  const { calculateFantasyPoints, rulesForLeague } = require('../services/scoringRules');
  t.mock.method(lineupService, 'rowsHeldAsPlayed', async (_pool, { rows }) => rows);

  const league = { id: 1, best_ball: false, regular_season_weeks: 14, playoff_teams: 0 };
  const week5Kickoff = '2026-10-11T17:00:00Z';
  const statements = [];
  const runCutoffs = [];
  const lineupRows = (week) => [
    { player_id: 1, slot: 'RB', name: 'Starter', position: 'RB', nfl_team: 'BUF' },
    // The acquired player is already on the team in week 5's stored lineup.
    ...(week === 5 ? [{ player_id: 99, slot: 'BENCH', name: 'Pickup', position: 'RB', nfl_team: 'KC' }] : []),
  ];
  const projected = { 4: { 1: 10, 99: 15 }, 5: { 1: 10, 99: 8 } };
  const pool = {
    async query(sql, params) {
      statements.push(sql);
      if (sql.includes('MIN("created_at")')) {
        return { rows: [{ week: 4, started: '2026-10-01T00:00:00Z' }, { week: 5, started: '2026-10-08T00:00:00Z' }] };
      }
      if (sql.includes('BOOL_AND')) return { rows: [{ week: 4 }, { week: 5 }] };
      if (sql.includes('FROM "nfl_games"')) {
        return { rows: [
          { nfl_team: 'KC', week: 4, kickoff_at: '2026-10-04T17:00:00Z' },
          { nfl_team: 'KC', week: 5, kickoff_at: week5Kickoff },
          { nfl_team: 'BUF', week: 4, kickoff_at: '2026-10-04T17:00:00Z' },
          { nfl_team: 'BUF', week: 5, kickoff_at: week5Kickoff },
        ] };
      }
      if (sql.includes('FROM "transactions"')) {
        return { rows: [{ team_id: 1, type: 'add', detail: { playerId: 99 }, created_at: '2026-10-06T12:00:00Z' }] };
      }
      if (sql.includes('JOIN "players"')) return { rows: lineupRows(params[2]) };
      if (sql.includes('FROM "projection_runs"')) {
        runCutoffs.push(params[3]);
        return { rows: [{ id: params[1], model_version: MODEL_VERSION }] };
      }
      if (sql.includes('FROM "player_week_projections"')) {
        const week = params[0];
        return { rows: Object.entries(projected[week]).map(([id, mean]) => ({
          player_id: Number(id), mean, median: mean, factors: {},
        })) };
      }
      if (sql.includes('FROM "player_stats"')) {
        return { rows: [
          { player_id: 1, stats: { rushingYards: 100 } },
          { player_id: 99, stats: { rushingYards: 150 } },
        ] };
      }
      if (sql.includes('FROM "players"')) return { rows: [{ id: 99, position: 'RB', nfl_team: 'KC' }] };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };

  const { buildAcquisitions } = require('../scripts/measure-upgrade-accuracy');
  const { acquisitions, skipped } = await buildAcquisitions(pool, { league, season: 2026, fromWeek: 1, toWeek: null });

  assert.deepEqual(skipped, {});
  assert.equal(acquisitions.length, 1);
  const [a] = acquisitions;
  assert.equal(a.acquiredWeek, 4);
  assert.equal(a.firstPlayableWeek, 5);
  assert.equal(a.weeks[4].predicted, 15);
  assert.equal(a.weeks[5].predicted, 8);
  assert.deepEqual(a.weeks[5].roster.map((r) => r.playerId), [1]); // the pickup is out of his own baseline
  const rules = rulesForLeague(league);
  assert.equal(a.weeks[5].actual, calculateFantasyPoints({ rushingYards: 150 }, rules));
  assert.equal(a.weeks[5].roster[0].actual, calculateFantasyPoints({ rushingYards: 100 }, rules));
  // Both rules read the last run stored before the first playable kickoff.
  assert.deepEqual(runCutoffs.map((c) => new Date(c).toISOString()), [
    new Date(week5Kickoff).toISOString(), new Date(week5Kickoff).toISOString(),
  ]);
  assert.ok(statements.every((sql) => /^\s*SELECT/i.test(sql)), 'every statement is a read');
});
