const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const lineupService = require('../services/lineup.service');
const projectionService = require('../services/projection.service');
const decision = require('../services/decision.service');
const teamRouter = require('../routes/team.router');
const model = require('../services/projectionModel');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'start-sit-advice-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);
const token = () => signToken({ id: 7, username: 'member' });

const ROSTER_SLOTS = [
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
];

const lineupEntry = (id, position, slot, overrides = {}) => ({
  id, name: `p${id}`, position, nfl_team: 'BUF', slot,
  injury_status: null, locked: false, onBye: false, bye_week: null, ...overrides,
});

const distribution = (median) => ({
  p10: median - 6, p25: median - 3, median, p75: median + 3, p90: median + 6,
});

const projectionFor = (playerId, median, extra = {}) => ({
  playerId,
  modelVersion: model.MODEL_VERSION,
  mean: median,
  ...distribution(median),
  activeProbability: 1,
  confidence: 'medium',
  sampleSize: 5,
  factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'NYJ' } },
  ...extra,
});

/**
 * Wraps a `getPositionDefense` mock's returned Map so that iterating it
 * (`.entries()`, `.keys()`, `.forEach()`, or spreading it) throws, while
 * plain `.get()`/`.has()` reads still work.
 *
 * #1154 removed `decision.service`'s `foldedDefense` JS remap, whose sole
 * reason to exist was to iterate `defense.entries()` and re-key a local
 * copy before startSitAdvice reads it. Once getPositionDefense returns a
 * canonical-keyed map, a reinstated remap would be a silent no-op on every
 * VALUE this suite checks (re-normalizing an already-canonical key returns
 * the same key), so a value-based assertion can never catch its return.
 * This guard catches its ONE structural signature instead: only a second
 * normalization site needs to iterate the map at all.
 */
function guardAgainstDefenseIteration(map) {
  const forbidden = new Set(['entries', 'keys', 'forEach', Symbol.iterator]);
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (forbidden.has(prop)) {
        throw new Error(
          `getPositionDefense's map was iterated via .${String(prop)}() - a second ` +
            'normalization/remap site over its keys is present again (#1154 removed ' +
            'exactly this, the foldedDefense JS remap); startSitAdvice must read the ' +
            'canonical map directly with .get()/.has() instead'
        );
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function mockAdviceDependencies(t, {
  entries,
  projections,
  rosterSlots = ROSTER_SLOTS,
  league = { id: 3, best_ball: false, scoring_rules: null },
  // Defaults to today's behaviour: an nfl_games row per entry, echoing the
  // entry's own nfl_team back as both sides of the schedule comparison. That
  // means these two defaults can never express a spelling mismatch between
  // players.nfl_team and nfl_games.nfl_team - pass gameRows explicitly (as
  // the DEF/WSH tests below do) whenever team keying is the point of the
  // test: the DEF test's players.nfl_team genuinely disagrees with its
  // schedule row and must be normalized to match; the WSH test's schedule
  // row matches raw-on-raw and guards that the already-working case doesn't
  // regress (#428).
  gameRows,
  positionDefense = new Map([['NYJ', { RB: 21.4, WR: 15.2 }]]),
} = {}) {
  const projectionCalls = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "nfl_games"')) {
      return { rows: gameRows || entries.map((e) => ({ nfl_team: e.nfl_team, opponent: 'NYJ' })) };
    }
    throw new Error(`unexpected query: ${text.slice(0, 90)}`);
  });
  t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots, benchSlots: 5, irSlots: 1, entries,
  }));
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => {
    projectionCalls.push(options);
    return {
      season: options.season,
      week: options.week,
      modelVersion: model.MODEL_VERSION,
      scoringHash: 'abc123',
      generatedAt: '2026-10-08T12:00:00.000Z',
      inputCutoff: '2026-10-11T17:00:00.000Z',
      sourceCoverage: {
        opponent: { status: 'available' },
        weather: { status: 'unavailable', reason: 'no verified stadium coordinates' },
        expertConsensus: { status: 'unavailable', source: null },
      },
      projections: new Map(projections),
    };
  });
  const guardedDefense = guardAgainstDefenseIteration(positionDefense);
  t.mock.method(projectionService, 'getPositionDefense', async () => guardedDefense);
  return projectionCalls;
}

test('the advice endpoint preserves every legacy response field and type', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(2, 'WR', 'FLEX'),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [
      [1, projectionFor(1, 6)],
      [2, projectionFor(2, 9)],
      [3, projectionFor(3, 18)],
    ],
  });

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3&season=2026&week=6')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  const body = response.body;
  assert.equal(body.season, 2026);
  assert.equal(body.week, 6);
  assert.equal(typeof body.projectedTotal, 'number');
  assert.equal(typeof body.optimalTotal, 'number');
  assert.ok(Array.isArray(body.suggestions));
  const suggestion = body.suggestions[0];
  assert.equal(typeof suggestion.slot, 'string');
  assert.equal(typeof suggestion.gain, 'number');
  assert.equal(typeof suggestion.current.projection, 'number');
  assert.equal(typeof suggestion.suggested.projection, 'number');
  assert.equal(typeof suggestion.current.playerId, 'number');
  assert.equal(typeof suggestion.suggested.playerId, 'number');
  // Opponent display context still rides along untouched.
  assert.equal(suggestion.suggested.opponent, 'NYJ');
  assert.equal(suggestion.suggested.opponentPointsAllowed, 21.4);
});

test('the advice endpoint adds model, distribution and coverage fields', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    // RB-only, so the better bench RB is a straight swap rather than a
    // reshuffle into the (otherwise empty) FLEX.
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }],
    projections: [[1, projectionFor(1, 6)], [3, projectionFor(3, 18)]],
  });

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.modelVersion, model.MODEL_VERSION);
  assert.equal(response.body.generatedAt, '2026-10-08T12:00:00.000Z');
  assert.equal(response.body.inputCutoff, '2026-10-11T17:00:00.000Z');
  assert.equal(response.body.sourceCoverage.expertConsensus.status, 'unavailable');
  assert.ok(Array.isArray(response.body.movePlan));
  assert.ok(Array.isArray(response.body.players));
  const suggestion = response.body.suggestions[0];
  assert.equal(suggestion.suggested.distribution.p90, 24);
  assert.equal(suggestion.confidence, 'medium');
  assert.ok(suggestion.probabilityBetter > 0.9);
  assert.equal(suggestion.verdict, 'start');
});

test('advice scopes the projection request to the roster and passes the league', async (t) => {
  const entries = [lineupEntry(1, 'RB', 'RB'), lineupEntry(3, 'RB', 'BENCH')];
  const calls = mockAdviceDependencies(t, {
    entries,
    projections: [[1, projectionFor(1, 6)], [3, projectionFor(3, 18)]],
    league: { id: 3, best_ball: false, scoring_rules: { receiving: { reception: 1 } } },
  });

  await decision.startSitAdvice({ leagueId: 3, userId: 7 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].playerIds, [1, 3], 'never the whole NFL pool for one lineup');
  assert.deepEqual(calls[0].league.scoring_rules, { receiving: { reception: 1 } });
});

test('best-ball leagues still refuse advice with a 409', async (t) => {
  const projectionCalls = mockAdviceDependencies(t, {
    entries: [lineupEntry(1, 'RB', 'RB')],
    projections: [[1, projectionFor(1, 6)]],
    league: { id: 3, best_ball: true, scoring_rules: null },
  });
  // #274. This endpoint is a GET, which makes it look read-only, and it is
  // not: getLineup calls materializeLineup and INSERTs a lineup_entries row
  // for every un-materialized roster row, and getWeeklyProjections caches into
  // projection_runs and player_week_projections. Both are mocked here, so a
  // guard moved below them calls the mocks and answers the identical 409.
  const lineupReads = t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots: [], benchSlots: 5, irSlots: 1, entries: [],
  }));

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3')
    .set('Authorization', `Bearer ${token()}`);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /best-ball/);
  assert.equal(lineupReads.mock.callCount(), 0, 'no lineup was materialized');
  assert.equal(projectionCalls.length, 0, 'and no projection run was cached');
});

test('a starter on a bye is reported unavailable and replaced', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB', { onBye: true }),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [[1, projectionFor(1, 20)], [3, projectionFor(3, 8)]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  assert.deepEqual(advice.unavailable.map((u) => [u.playerId, u.reason]), [[1, 'bye']]);
  assert.equal(advice.projectedTotal, 0);
  assert.equal(advice.suggestions[0].suggested.playerId, 3);
});

test('a DEF unit resolves its opponent even though players.nfl_team is a full team name (#423)', async (t) => {
  // players.nfl_team for a DEF is seeded as a full team name ('Denver
  // Broncos') by syncTeamDefenses, while nfl_games.nfl_team is Tank01's raw
  // abbreviation ('DEN'). getWeekOpponents must normalize both sides of that
  // comparison rather than compare them raw.
  const entries = [
    lineupEntry(1, 'DEF', 'DEF', { nfl_team: 'Denver Broncos' }),
  ];
  mockAdviceDependencies(t, {
    entries,
    rosterSlots: [{ key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] }],
    gameRows: [{ nfl_team: 'DEN', opponent: 'KC' }],
    positionDefense: new Map([['KC', { DEF: 5.5 }]]),
    projections: [[1, projectionFor(1, 7, {
      factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'KC' } },
    })]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const defPlayer = advice.players.find((p) => p.playerId === 1);
  assert.equal(defPlayer.opponent, 'KC');
  assert.equal(defPlayer.opponentPointsAllowed, 5.5);
});

test('a skill player raw-coded WSH still resolves against a raw-coded WSH schedule row (#423), opponent/opponentPointsAllowed unchanged by the #1136 fold', async (t) => {
  const entries = [
    lineupEntry(2, 'WR', 'RB', { nfl_team: 'WSH' }),
  ];
  mockAdviceDependencies(t, {
    entries,
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['WR'] }],
    gameRows: [{ nfl_team: 'WSH', opponent: 'DAL' }],
    positionDefense: new Map([['DAL', { WR: 12.3 }]]),
    projections: [[2, projectionFor(2, 9, {
      factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'DAL' } },
    })]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const wrPlayer = advice.players.find((p) => p.playerId === 2);
  // DAL's raw and folded spellings are identical, so this regression check
  // stays exactly what it was before #1136: a Washington player's own
  // opponent/opponentPointsAllowed pairing is unaffected by the value fold.
  assert.equal(wrPlayer.opponent, 'DAL');
  assert.equal(wrPlayer.opponentPointsAllowed, 12.3);
});

test('a raw-coded WSH opponent value folds to WAS, and the defense pairing resolves against getPositionDefense\'s canonical key with no local remap (#1154, supersedes the #1136 raw-key pairing)', async (t) => {
  // Superseded ruling: this test used to pair a raw 'WSH' key in
  // `positionDefense` against `startSitAdvice`'s own JavaScript
  // `foldedDefense` remap, because getPositionDefense returned a map keyed
  // by the schedule's raw spelling (ADR 0011). On Cory's 2026-09-10 ruling
  // (#1154), getPositionDefense itself folds its key through
  // fn_normalize_nfl_team and returns a Team-code-keyed map, so this mock
  // stands in for that canonical map directly, keyed 'WAS', and
  // startSitAdvice reads it with no second fold of its own.
  const entries = [
    lineupEntry(6, 'WR', 'RB', { nfl_team: 'DAL' }), // DAL's opponent this week is Washington
  ];
  mockAdviceDependencies(t, {
    entries,
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['WR'] }],
    gameRows: [{ nfl_team: 'DAL', opponent: 'WSH' }],
    // getPositionDefense now keys itself by the canonical Team code (#1154):
    // a Washington-opponent week aggregates under 'WAS', never the raw 'WSH'.
    positionDefense: new Map([['WAS', { WR: 9.1 }]]),
    projections: [[6, projectionFor(6, 11, {
      factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'WAS' } },
    })]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const wrPlayer = advice.players.find((p) => p.playerId === 6);
  assert.equal(wrPlayer.opponent, 'WAS', 'the wire opponent value is a Team code, never the schedule\'s raw WSH');
  assert.equal(
    wrPlayer.opponentPointsAllowed,
    9.1,
    'the folded opponent pairs directly with getPositionDefense\'s canonical-keyed aggregate; no local remap sits between them'
  );
});

test('a schedule row with a blank nfl_team produces no map entry, never a false match for a teamless player (#1136)', async (t) => {
  const entries = [
    lineupEntry(7, 'DEF', 'RB', { nfl_team: '' }),
  ];
  mockAdviceDependencies(t, {
    entries,
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['DEF'] }],
    gameRows: [{ nfl_team: '', opponent: 'KC' }],
    positionDefense: new Map(),
    projections: [[7, projectionFor(7, 3)]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const player = advice.players.find((p) => p.playerId === 7);
  assert.equal(player.opponent, null, 'a blank nfl_team row must never be read back as a match');
  assert.equal(player.opponentPointsAllowed, null);
});

test('advice never lists a player in two recommendations', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(2, 'WR', 'FLEX'),
    lineupEntry(3, 'RB', 'BENCH'),
    lineupEntry(4, 'WR', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [
      [1, projectionFor(1, 4)],
      [2, projectionFor(2, 5)],
      [3, projectionFor(3, 22)],
      [4, projectionFor(4, 19)],
    ],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const mentioned = advice.suggestions.flatMap((s) => [s.current.playerId, s.suggested.playerId]);
  assert.equal(new Set(mentioned).size, mentioned.length);
  assert.equal(advice.optimalTotal, 41, 'RB 22 at RB and WR 19 at FLEX, the exact optimum');
});
