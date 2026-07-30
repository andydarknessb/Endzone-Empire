const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const guards = require('../../scripts/backtest/lib/guards');
const gate = require('../../scripts/backtest/lib/priorGamesGate');
// The REAL production functions the gate exercises. Injected, because nothing
// in scripts/backtest may require them.
const {
  buildPriorGames, buildVersusOpponentMeetings,
} = require('../services/projectionFeatures');
const model = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// Canaries
// ---------------------------------------------------------------------------

/** A probe that fails the way a `--network none` container makes them fail. */
const blocked = (code) => () => Promise.reject(Object.assign(new Error('blocked'), { code }));
/** A probe that SUCCEEDS - the thing that must abort the sweep. */
const reached = (value) => () => Promise.resolve(value);

function allBlocked(overrides = {}) {
  return {
    tcp: blocked('EPERM'),
    https: blocked('ENETUNREACH'),
    globalPool: blocked('ECONNREFUSED'),
    freshPgClient: blocked('ENOTFOUND'),
    ...overrides,
  };
}

test('every escape route has a canary, and the four are the ones that matter', () => {
  assert.deepEqual([...guards.CANARY_NAMES], ['tcp', 'https', 'globalPool', 'freshPgClient']);
});

test('all four blocked is the only passing outcome', async () => {
  const report = await guards.assertOffline({ probes: allBlocked() });
  assert.equal(report.ok, true);
  assert.equal(report.results.length, 4);
  assert.equal(report.results.every((r) => r.outcome === guards.OUTCOMES.BLOCKED), true);
  assert.deepEqual(report.reached, []);
});

test('ANY canary reaching something aborts the sweep, and every hole is named', async () => {
  for (const name of guards.CANARY_NAMES) {
    await assert.rejects(
      () => guards.assertOffline({ probes: allBlocked({ [name]: reached('open') }) }),
      (err) => {
        assert.match(err.message, /refusing to start the sweep/);
        assert.match(err.message, new RegExp(`${name}:`));
        assert.match(err.message, /could come from live data rather than the frozen snapshot/);
        return true;
      },
      `a reachable ${name} must abort`
    );
  }
  // Two holes are BOTH reported: every probe runs even after one succeeds, so
  // an operator fixes both rather than discovering the second on the next run.
  await assert.rejects(
    () => guards.assertOffline({
      probes: allBlocked({ tcp: reached('open'), freshPgClient: reached('connected') }),
    }),
    /2 of 4 canaries REACHED something .*tcp.*freshPgClient/s
  );
});

test('a probe that resolves with ANYTHING counts as reaching, including an error status', async () => {
  // An HTTP 502 still means something answered. The canary tests reachability,
  // not success.
  const report = await guards.runCanaries({ probes: allBlocked({ https: reached('HTTP 502') }) });
  assert.equal(report.ok, false);
  assert.equal(report.reached[0].name, 'https');
  assert.match(report.reached[0].detail, /HTTP 502/);
});

test('a missing probe is a failure, never a skip', async () => {
  const { tcp, ...withoutTcp } = allBlocked();
  await assert.rejects(
    () => guards.assertOffline({ probes: withoutTcp }),
    /canary probes missing for tcp.*unproven route is an open one/s
  );
  await assert.rejects(() => guards.runCanaries({ probes: null }), /requires a probes object/);
});

test('the canary report never stringifies a connection object', () => {
  // A pg client carries a password. The detail line describes the shape and
  // stops there.
  class FakePgClient { constructor() { this.password = 'hunter2'; } }
  const detail = guards.describeReached(new FakePgClient());
  assert.equal(detail, 'the probe resolved with a FakePgClient');
  assert.ok(!detail.includes('hunter2'));
  assert.match(guards.describeReached(undefined), /resolved instead of failing/);
  assert.match(guards.describeReached('x'), /resolved with "x"/);
});

test('interpretProbe rejects an unknown canary name', () => {
  assert.throws(
    () => guards.interpretProbe({ name: 'ftp', settled: { status: 'rejected', reason: new Error('x') } }),
    /unknown canary "ftp"/
  );
});

// ---------------------------------------------------------------------------
// In-process guards
// ---------------------------------------------------------------------------

test('disarm replaces methods with throwing stubs and restores them exactly once', () => {
  const target = { query: () => 'live', connect: () => 'live', release: () => 'ok' };
  const handle = guards.disarm(target, ['query', 'connect'], { label: 'pool' });
  assert.throws(() => target.query(), /pool\.query\(\) is disarmed/);
  assert.throws(() => target.connect(), /pool\.connect\(\) is disarmed/);
  assert.equal(target.release(), 'ok', 'untouched methods still work');
  assert.deepEqual(handle.disarmedMethods, ['query', 'connect']);
  assert.throws(() => guards.disarm(target, ['query']), /already disarmed/);
  assert.equal(handle.restore(), true);
  assert.equal(target.query(), 'live');
  assert.equal(handle.restore(), false, 'a second restore is a no-op');
  assert.throws(() => guards.disarm(null, ['query']), /requires an object/);
});

test('the holdout service must not be loadable inside the sweep', () => {
  const loaded = [
    '/repo/server/services/projection.service.js',
    '/repo/scripts/backtest/lib/snapshotClient.js',
  ];
  assert.equal(guards.assertModuleNotLoaded(loaded, ['holdout.service']), true);
  assert.throws(
    () => guards.assertModuleNotLoaded(
      [...loaded, 'C:\\repo\\server\\services\\holdout.service.js'], ['holdout.service']
    ),
    /forbidden module\(s\) are loaded - holdout\.service.*2026 holdout is prospective/s
  );
});

test('the canary runner is the only place that holds a real probe', () => {
  const runner = path.join(__dirname, '..', 'scripts', 'run-backtest-canaries.js');
  const code = fs.readFileSync(runner, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const spec of ['net', 'https', '../modules/pool', 'pg']) {
    assert.ok(code.includes(spec), `the runner must hold the real ${spec} probe`);
  }
  // And the pure logic it delegates to holds none of them.
  const lib = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'guards.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const spec of ['require(\'net\')', 'require(\'https\')', 'require(\'pg\')', 'modules/pool']) {
    assert.ok(!lib.includes(spec), `guards.js must not import ${spec}`);
  }
  assert.ok(!/process\.env/.test(lib), 'guards.js reads no environment');
});

// ---------------------------------------------------------------------------
// The buildPriorGames fail gate
// ---------------------------------------------------------------------------

const RULES = { passing: { yards: 0.04, td: 4 }, rushing: { yards: 0.1, td: 6 }, receiving: { yards: 0.1, td: 6, reception: 0.5 } };

/** A schedule map in the shape loadFeatureBundle builds. */
function opponentMap(entries) {
  return new Map(entries.map(([key, opponent, isHome]) => [key, { opponent, isHome }]));
}

function playerWeek(overrides = {}) {
  return {
    playerId: 1,
    season: 2025,
    week: 10,
    statRows: [
      { season: 2025, week: 1, stats: { rushingYards: 100, gameTeam: 'KC' } },
      { season: 2025, week: 2, stats: { rushingYards: 50, gameTeam: 'KC' } },
    ],
    opponentByTeamWeek: opponentMap([
      ['2025:1:KC', 'BUF', true],
      ['2025:2:KC', 'DEN', false],
    ]),
    retainedTeam: 'KC',
    correctedTeam: 'KC',
    targetOpponent: 'BUF',
    ...overrides,
  };
}

function runGate(playerWeeks, constants = model.MODEL_CONSTANTS) {
  return gate.assertPriorGamesGate({
    playerWeeks,
    rules: RULES,
    constants,
    buildPriorGames,
    buildVersusOpponentMeetings,
    versusOpponentEffect: model.versusOpponentEffect,
  });
}

test('the gate passes when the two team resolutions agree and versusOpponent stays off', () => {
  const result = runGate([playerWeek(), playerWeek({ playerId: 2, retainedTeam: 'BUF', correctedTeam: 'KC' })]);
  assert.equal(result.status, 'passed');
  assert.equal(result.playerWeeksChecked, 2);
  assert.equal(result.tradedPlayerWeeks, 1, 'the traded player-week is counted, not skipped');
});

test('the gate HALTS when versusOpponent activates, and says a plan amendment is needed', () => {
  // Two meetings with BUF inside one season is exactly the traded-player case
  // the plan flagged: it reaches minMeetings = 2 and the factor turns on.
  const activating = playerWeek({
    statRows: [
      { season: 2025, week: 1, stats: { rushingYards: 100, gameTeam: 'KC' } },
      { season: 2025, week: 2, stats: { rushingYards: 120, gameTeam: 'KC' } },
      { season: 2025, week: 3, stats: { rushingYards: 40, gameTeam: 'KC' } },
    ],
    opponentByTeamWeek: opponentMap([
      ['2025:1:KC', 'BUF', true],
      ['2025:2:KC', 'BUF', false],
      ['2025:3:KC', 'DEN', true],
    ]),
  });
  assert.throws(() => runGate([activating]), (err) => {
    assert.match(err.message, /versusOpponent ACTIVATED for 1 player-week/);
    assert.match(err.message, /PLAN AMENDMENT for a human to make - this run halts/);
    return true;
  });
});

test('the gate HALTS when the two resolutions see different rows', () => {
  // buildPriorGames is real, so a genuine points-series difference needs the
  // two calls to see different STAT ROWS. A fake stands in for that here,
  // because production cannot produce it - which is the point: if it ever
  // does, the gate catches it.
  const drifting = (() => {
    let call = 0;
    return ({ statRows }) => {
      call += 1;
      const rows = call === 1 ? statRows : statRows.slice(1);
      return rows.map((r) => ({ season: r.season, week: r.week, points: 10, opponent: null, isHome: null }));
    };
  })();
  assert.throws(() => gate.assertPriorGamesGate({
    playerWeeks: [playerWeek()],
    rules: RULES,
    constants: model.MODEL_CONSTANTS,
    buildPriorGames: drifting,
    buildVersusOpponentMeetings: () => [],
    versusOpponentEffect: () => ({ available: false }),
  }), /different points series.*seeing different ROWS/s);
});

test('the gate refuses to report success over an empty cohort', () => {
  assert.throws(() => runGate([]), /no player-weeks to check.*not that the check passed/s);
  assert.throws(() => gate.assertPriorGamesGate({
    playerWeeks: [playerWeek()], rules: RULES, constants: model.MODEL_CONSTANTS,
  }), /requires the production buildPriorGames to be injected/);
});

test('the gate checks BOTH resolutions, not just the corrected one', () => {
  // Activation under the RETAINED resolution alone must still halt: the study
  // has to know the choice is unobservable, whichever side it would have used.
  const seen = [];
  gate.checkPlayerWeek({
    ...playerWeek({ retainedTeam: 'KC', correctedTeam: 'BUF' }),
    rules: RULES,
    constants: model.MODEL_CONSTANTS,
    buildPriorGames,
    buildVersusOpponentMeetings: (args) => { seen.push(args.priorGames.length); return []; },
    versusOpponentEffect: () => ({ available: false }),
  });
  assert.equal(seen.length, 2, 'the factor is evaluated once per resolution');
});

test('pointsSeries compares season, week and points, and nothing else', () => {
  const games = [
    { season: 2025, week: 2, points: 12.5, opponent: 'BUF', isHome: true },
    { season: 2025, week: 1, points: 8, opponent: 'DEN', isHome: false },
  ];
  // The series carries EXACTLY three fields. Opponent and orientation are the
  // very things the two resolutions are allowed to differ on, so including
  // either would make the gate fail on the difference it exists to tolerate.
  for (const entry of gate.pointsSeries(games)) {
    assert.deepEqual(Object.keys(entry).sort(), ['points', 'season', 'week']);
  }
  // And the KEY is built from exactly those three, so a field smuggled into the
  // series still could not reach the comparison.
  assert.equal(gate.seriesKey([{ season: 2025, week: 1, points: 8, opponent: 'BUF' }]), '2025:1:8');

  const flipped = games.map((g) => ({ ...g, opponent: 'OTHER', isHome: !g.isHome }));
  assert.equal(gate.seriesKey(gate.pointsSeries(games)), gate.seriesKey(gate.pointsSeries(flipped)));
  const changed = [{ ...games[0], points: 12.6 }, games[1]];
  assert.notEqual(gate.seriesKey(gate.pointsSeries(games)), gate.seriesKey(gate.pointsSeries(changed)));
});
