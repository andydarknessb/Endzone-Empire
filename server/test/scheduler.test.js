const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const push = require('../services/push.service');
const prefs = require('../services/prefs.service');
const { alertCloseMatchups } = require('../modules/scheduler');

test('close-matchup push targets Game Center instead of the retired Matchups route', async (t) => {
  let sent;
  createFakePool([[/./, () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] })]]).install(t);
  t.mock.method(prefs, 'usersWanting', async (ownerIds, key) => {
    assert.deepEqual(ownerIds, [11, 22]);
    assert.equal(key, 'closeMatchups');
    return ownerIds;
  });
  t.mock.method(push, 'sendPushToUsers', async (ownerIds, payload) => {
    sent = { ownerIds, payload };
    return { sent: ownerIds.length };
  });

  await alertCloseMatchups({
    leagueId: 42,
    week: 7,
    scored: [{ matchupId: 987654, homeTeamId: 3, awayTeamId: 4, homeScore: 101, awayScore: 96.5 }],
  });

  assert.deepEqual(sent.ownerIds, [11, 22]);
  assert.equal(sent.payload.url, '/#/league/42/game-center');
  assert.equal(sent.payload.title, 'Your matchup is close!');
});

// ---- quota-aware stat-sync cadence -----------------------------------------

const scheduler = require('../modules/scheduler');
const tank01Client = require('../modules/tank01Client');
const pool = require('../modules/pool');
const pickClock = require('../services/pickClock.service');
const draftSweepLiveness = require('../modules/draftSweepLiveness');

test('syncEveryTicks doubles the box-score cadence once quota is degraded', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'degraded' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS * 2);
});

// ---- draft-clock tick containment (#600) -----------------------------------

test('draftTick stamps the draft-sweep liveness key after the sweep runs, and not on a skipped tick (#842)', async (t) => {
  const stamps = [];
  t.mock.method(draftSweepLiveness, 'recordDraftSweep', async () => { stamps.push(Date.now()); return true; });
  let locked = true;
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      throw new Error(`unexpected: ${text}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  // The sweep's one read: no active draft, so it returns at once.
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  await scheduler.draftTick();
  assert.equal(stamps.length, 1, 'an acquired tick stamps liveness exactly once');

  locked = false;
  await scheduler.draftTick();
  // Red tell: stamping before the lock (or on skip) would count 2 here and let a
  // worker that never runs its sweep look alive.
  assert.equal(stamps.length, 1, 'a skipped tick does not stamp');
});

test('draftTick contains a failure in the advisory-lock acquisition itself, without throwing', async (t) => {
  // The sweep contains its own failures, and draftTickUnlocked has always caught
  // the sweep. The gap #600 closes is withAdvisoryLock's OWN acquisition - the
  // pool.connect() and the try-lock query - which runs before the work callback
  // and is covered by no inner catch. A rejection there used to reach setInterval
  // as an unhandled rejection and could take the worker (and every live draft's
  // clock) down. draftTick now catches it. Red tell: drop draftTick's try/catch
  // and this rejects, failing the assertion below.
  t.mock.method(pool, 'connect', async () => { throw new Error('pool exhausted acquiring the draft-clock lock'); });

  let threw = false;
  let result;
  try {
    result = await scheduler.draftTick();
  } catch (err) {
    threw = true;
  }

  assert.equal(threw, false, 'draftTick swallowed the lock-acquisition failure instead of rejecting into setInterval');
  assert.equal(result, undefined);
});

test('stopScheduler tears down armed Pick-clock timers so none fire after a stop (#601)', (t) => {
  // Timers are torn down with the scheduler: after a stop, no armed in-process
  // expiry timer may fire, so a test run or a shutdown cannot leak a late
  // Autopick. autoPick's first act is to read the league row; counting that
  // read is a faithful proxy for "the timer fired autoPick".
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => pickClock.cancelAllExpiryTimers());
  let leagueReads = 0;
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM "leagues" WHERE "id" = $1')) leagueReads += 1;
    return { rows: [] };
  });

  pickClock.armExpiryTimer(9001, new Date(Date.now() + 5000));
  scheduler.stopScheduler();
  t.mock.timers.tick(10000); // well past the 5s deadline

  // Red tell: drop cancelAllExpiryTimers() from stopScheduler and the timer
  // survives the stop, fires autoPick on this tick, and leagueReads becomes 1.
  assert.equal(leagueReads, 0, 'no armed timer fired autoPick after the scheduler stopped');
});

test('syncEveryTicks keeps the normal cadence while quota is healthy', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'ok' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

test('syncEveryTicks falls back to the default when quota state is unavailable', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => {
    throw new Error('quota table missing');
  });
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

test('runDailyInjurySync runs once per local day and retries a failed day', async (t) => {
  const scoring = require('../services/scoring.service');
  const previousKey = process.env.RAPID_API_KEY;
  const previousHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  t.after(() => {
    if (previousKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = previousKey;
    if (previousHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = previousHost;
  });
  let calls = 0;
  let fail = false;
  t.mock.method(scoring, 'syncInjuries', async () => {
    calls += 1;
    if (fail) throw new Error('Tank01 unavailable');
    return { playersUpdated: 10, irFlags: 1 };
  });

  const firstDay = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyInjurySync({ now: firstDay }), {
    playersUpdated: 10,
    irFlags: 1,
  });
  assert.equal(await scheduler.runDailyInjurySync({ now: firstDay }), null);

  fail = true;
  const nextDay = new Date('2026-08-21T12:00:00-05:00');
  await assert.rejects(scheduler.runDailyInjurySync({ now: nextDay }), /Tank01 unavailable/);
  fail = false;
  assert.deepEqual(await scheduler.runDailyInjurySync({ now: nextDay }), {
    playersUpdated: 10,
    irFlags: 1,
  });
  assert.equal(await scheduler.runDailyInjurySync({ now: nextDay }), null);
  assert.equal(calls, 3);
});

test('tickUnlocked registers the daily injury sync duty', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );

  assert.match(tickBody, /await runDailyInjurySync\(\);/);
});

// ---- daily ADP sync (#747) --------------------------------------------------

test('runDailyAdpSync runs once per local day and retries a thrown day', async (t) => {
  // Same day-stamp-after-success contract as the injury sync, but with no
  // credential gate: FFC is free and keyless, so the ADP job runs all year.
  const adp = require('../services/adp.service');
  let calls = 0;
  let fail = false;
  t.mock.method(adp, 'syncAdp', async () => {
    calls += 1;
    if (fail) throw new Error('FFC unavailable');
    return { ok: true, playersUpdated: 180 };
  });

  const firstDay = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyAdpSync({ now: firstDay }), { ok: true, playersUpdated: 180 });
  // A second tick the same local day does not run it again.
  assert.equal(await scheduler.runDailyAdpSync({ now: firstDay }), null);

  fail = true;
  const nextDay = new Date('2026-08-21T12:00:00-05:00');
  // A throw does not stamp the day: the next tick retries.
  await assert.rejects(scheduler.runDailyAdpSync({ now: nextDay }), /FFC unavailable/);
  fail = false;
  assert.deepEqual(await scheduler.runDailyAdpSync({ now: nextDay }), { ok: true, playersUpdated: 180 });
  // ...and once it succeeds, the day is stamped so it does not run a third time.
  assert.equal(await scheduler.runDailyAdpSync({ now: nextDay }), null);
  assert.equal(calls, 3);
});

test('tickUnlocked runs the daily ADP sync in its own containment, so a throw does not stop the duties after it', () => {
  // The duty is contained exactly like runDailyInjurySync: a thrown ADP sync is
  // caught and logged, and the rest of the tick still runs (a source-order pin
  // in the same spirit as the injury-duty test above).
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runDailyAdpSync\(\);\s*\} catch/);
});

test('getSchedulerStatus reports the latest ADP run, and null when none has run', async (t) => {
  const noRuns = createFakePool([
    [/FROM "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);
  assert.equal((await scheduler.getSchedulerStatus()).lastAdpSync, null);
  noRuns.assertClean();

  t.mock.restoreAll();
  createFakePool([
    [/FROM "data_sync_runs"/, () => ({
      rows: [{ finished_at: '2026-09-02T06:00:00.000Z', ok: true, detail: { matched: 182, adpPlayers: 200 } }],
    })],
  ]).install(t);
  assert.deepEqual((await scheduler.getSchedulerStatus()).lastAdpSync, {
    finishedAt: '2026-09-02T06:00:00.000Z',
    ok: true,
    matched: 182,
  });
});

test('getSchedulerStatus never throws when the data_sync_runs read fails', async (t) => {
  createFakePool([
    [/FROM "data_sync_runs"/, () => { throw new Error('relation "data_sync_runs" does not exist'); }],
  ]).install(t);
  // Health probes and the worker heartbeat depend on this never throwing.
  const status = await scheduler.getSchedulerStatus();
  assert.equal(status.lastAdpSync, null);
});

// ---- scoring is decoupled from syncing -------------------------------------

test('syncAndScoreLiveWeeks still scores when the stat sync fetched nothing', async (t) => {
  // Every game final and already ingested (or quota exhausted): scoreMatchups is
  // DB-only, so it must still run — finals ingested via the recap path get
  // scored promptly this way.
  const scoring = require('../services/scoring.service');
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 42, current_season: 2026, current_week: 3 }] })],
    [/FROM "nfl_games"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/./, () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(scoring, 'syncWeekStats', async () => {
    throw new Error('quota exhausted');
  });
  let scoredFor = null;
  t.mock.method(scoring, 'scoreMatchups', async ({ leagueId, plays }) => {
    scoredFor = { leagueId, plays };
    return { scored: [] };
  });

  const prevKey = process.env.RAPID_API_KEY;
  const prevHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  try {
    const ran = await scheduler.syncAndScoreLiveWeeks();
    assert.equal(ran, true);
  } finally {
    if (prevKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = prevKey;
    if (prevHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = prevHost;
  }
  assert.deepEqual(scoredFor, { leagueId: 42, plays: [] });
});

// ---- pick'em-only season lifecycle -------------------------------------------

// Weeks 1..5 of a season: each week's last kickoff is Monday night, 00:15Z Tue.
const kickoffRows = (weeks) =>
  Array.from({ length: weeks }, (_, i) => {
    const mnf = new Date(Date.UTC(2026, 8, 15, 0, 15) + i * 7 * 24 * 60 * 60 * 1000);
    return [
      { week: i + 1, kickoff_at: new Date(mnf.getTime() - 32 * 60 * 60 * 1000).toISOString() },
      { week: i + 1, kickoff_at: mnf.toISOString() },
    ];
  }).flat();

test('runPickemWeekSync moves only the league whose week is stale, reading the schedule once per season', async (t) => {
  const leagues = [
    { id: 1, current_season: 2026, current_week: 3 }, // stale: week 3 closed on Monday night
    { id: 2, current_season: 2026, current_week: 4 }, // already right
  ];
  const { calls } = createFakePool([
    [/FROM "leagues"/, () => ({ rows: leagues })],
    [/FROM "nfl_games"/, () => ({ rows: kickoffRows(5) })],
    // Honour the compare-and-swap: the row only moves when the statement
    // names the week and season it currently has.
    [/^UPDATE "leagues" SET "current_week"/, (text, params) => {
      const league = leagues.find((l) => l.id === params[1]);
      const matches = league && league.current_week === params[2] && league.current_season === params[3];
      return { rows: matches ? [{ id: params[1] }] : [] };
    }],
  ]).install(t);

  // Tuesday noon after week 3's Monday-night game.
  const changes = await scheduler.runPickemWeekSync({ now: new Date('2026-09-29T16:00:00Z') });

  assert.deepEqual(changes, [{ leagueId: 1, from: 3, to: 4 }]);
  const updates = calls.filter((c) => /^UPDATE "leagues"/.test(c.text));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [4, 1, 3, 2026]);
  // Idempotent by predicate: the write names the week and season it expects
  // to replace, and only ever touches pick'em-only leagues still in season.
  assert.match(updates[0].text, /"pickem_only" = true/);
  assert.match(updates[0].text, /"season_status" <> 'complete'/);
  assert.match(updates[0].text, /"current_week" = \$3/);
  assert.match(updates[0].text, /"current_season" = \$4/);
  assert.equal(calls.filter((c) => /FROM "nfl_games"/.test(c.text)).length, 1, 'bounds fetched once per season');
});

test('runPickemWeekSync moves a league with no picks out of a finished season once a newer schedule is on file', async (t) => {
  // The Jan-May residue: a league created into the finished 2026 season sits
  // at week 18 with every game locked, so it can never pick, never complete
  // and never roll over. When 2027 loads it must follow the calendar. A
  // league that DID pick in 2026 is left for completion (and stays put).
  const leagues = [
    { id: 1, current_season: 2026, current_week: 18 }, // zero picks: move on
    { id: 2, current_season: 2026, current_week: 18 }, // has picks: not ours to move
  ];
  const { calls } = createFakePool([
    [/FROM "leagues"/, () => ({ rows: leagues })],
    [/SELECT MAX\("season"\)/, () => ({ rows: [{ season: 2027 }] })],
    [/SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, (text, params) => ({
      rows: params[0] === 2026
        ? kickoffRows(18)
        : kickoffRows(18).map((r) => ({ week: r.week, kickoff_at: r.kickoff_at.replace('2026', '2027') })),
    })],
    [/SELECT 1 FROM "pickem_picks"/, (text, params) => ({ rows: params[0] === 2 ? [{ '?column?': 1 }] : [] })],
    [/^UPDATE "leagues" SET "current_season"/, (text, params) => ({ rows: [{ id: params[2] }] })],
    [/^UPDATE "leagues" SET "current_week"/, () => { throw new Error('a plain week write must not happen here'); }],
  ]).install(t);

  const changes = await scheduler.runPickemWeekSync({ now: new Date('2027-06-01T12:00:00Z') });

  assert.deepEqual(changes, [{ leagueId: 1, from: 18, to: 1, fromSeason: 2026, toSeason: 2027 }]);
  const moves = calls.filter((c) => /^UPDATE "leagues" SET "current_season"/.test(c.text));
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].params, [2027, 1, 1, 2026, 18]);
  assert.match(moves[0].text, /"pickem_only" = true/);
  assert.match(moves[0].text, /"season_status" <> 'complete'/);
});

/**
 * A tiny stateful stand-in for the tables season completion touches: the
 * leagues row flips to complete on UPDATE, and the trophies insert honors the
 * (league, season, week, team, type) unique key the way ON CONFLICT DO
 * NOTHING does (no row returned on a repeat).
 */
function pickemSeasonWorld(t, { league, teams, picks, live, games }) {
  const state = {
    league: { ...league },
    result: null,
    trophies: [],
    notifications: [],
    statusUpdates: 0,
  };
  const trophyKeys = new Set();
  let transactionSnapshot = null;
  const snapshotState = () => ({
    league: { ...state.league },
    result: state.result == null ? null : structuredClone(state.result),
    trophies: structuredClone(state.trophies),
    notifications: structuredClone(state.notifications),
    statusUpdates: state.statusUpdates,
    trophyKeys: [...trophyKeys],
  });
  const restoreState = (snapshot) => {
    state.league = snapshot.league;
    state.result = snapshot.result;
    state.trophies.splice(0, state.trophies.length, ...snapshot.trophies);
    state.notifications.splice(0, state.notifications.length, ...snapshot.notifications);
    state.statusUpdates = snapshot.statusUpdates;
    trophyKeys.clear();
    for (const key of snapshot.trophyKeys) trophyKeys.add(key);
  };
  const nflGames = games || [
    { week: 18, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2027-01-10T18:00:00.000Z' },
    { week: 18, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2027-01-10T18:00:00.000Z' },
    { week: 18, nfl_team: 'DAL', opponent: 'WAS', kickoff_at: '2027-01-10T21:25:00.000Z' },
    { week: 18, nfl_team: 'WAS', opponent: 'DAL', kickoff_at: '2027-01-10T21:25:00.000Z' },
  ];
  const handlers = [
    [/^BEGIN$/, () => {
      transactionSnapshot = snapshotState();
      return { rows: [] };
    }, 'client'],
    [/^COMMIT$/, () => {
      transactionSnapshot = null;
      return { rows: [] };
    }, 'client'],
    [/^ROLLBACK$/, () => {
      if (transactionSnapshot) restoreState(transactionSnapshot);
      transactionSnapshot = null;
      return { rows: [] };
    }, 'client'],
    [/FROM "leagues" WHERE "pickem_only" = true AND "season_status" <> 'complete'/, () =>
      ({ rows: state.league.season_status === 'complete' ? [] : [state.league] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [state.league] })],
    [/SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: nflGames.map((g) => ({ week: g.week, kickoff_at: g.kickoff_at })),
    })],
    [/FROM "nfl_games"/, () => ({ rows: nflGames })],
    [/FROM "live_game_states"/, () => ({ rows: live })],
    [/FROM "private"\."game_recaps"/, () => ({ rows: [] })],
    [/SELECT 1 FROM "pickem_picks"/, () => ({ rows: picks.length > 0 ? [{ '?column?': 1 }] : [] })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    // pick'em standings members query (#343: owner_id AS user_id, no users JOIN)
    [/"owner_id" AS "user_id"/, () => ({
      rows: teams.filter((team) => team.owner_id != null).map((team) => ({
        user_id: team.owner_id, team_id: team.id, team_name: team.name,
        avatar_url: null, avatar_static_url: null,
      })),
    })],
    [/FROM "pickem_picks" WHERE "league_id" = \$1 AND "season" = \$2$/, () => ({ rows: picks })],
    [/^UPDATE "leagues" SET "season_status" = 'complete'/, () => {
      state.league = { ...state.league, season_status: 'complete' };
      state.statusUpdates += 1;
      return { rows: [{ id: state.league.id }] };
    }],
    [/^INSERT INTO "pickem_season_results"/, (text, params) => {
      if (state.result) return { rows: [] };
      state.result = {
        league_id: params[0],
        season: params[1],
        outcome: params[2],
        scoring_mode: params[3],
        champions: JSON.parse(params[4]),
        declared_at: '2027-01-11T06:00:00.000Z',
      };
      return { rows: [state.result] };
    }],
    [/^SELECT .* FROM "pickem_season_results"/, () => ({ rows: state.result ? [state.result] : [] })],
    [/INSERT INTO "trophies"/, (text, params) => {
      const key = params.slice(0, 5).join(':');
      if (trophyKeys.has(key)) return { rows: [] };
      trophyKeys.add(key);
      state.trophies.push({
        leagueId: params[0], teamId: params[1], season: params[2], week: params[3],
        type: params[4], label: params[5], data: JSON.parse(params[6]),
      });
      return { rows: [{ id: state.trophies.length }] };
    }],
    [/SELECT DISTINCT "owner_id" FROM "teams"/, () => ({
      rows: teams.filter((team) => team.owner_id != null).map((team) => ({ owner_id: team.owner_id })),
    })],
    [/SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: teams.filter((team) => team.id === params[0]).map((team) => ({ owner_id: team.owner_id })),
    })],
    [/INSERT INTO "notifications"/, (text, params) => {
      state.notifications.push({ userId: params[0], type: params[2], message: params[3] });
      return { rows: [] };
    }],
  ];
  // The fake tags pool reads and transaction-client statements separately so
  // a test can see the transaction boundary, not just the statements.
  state.calls = createFakePool(handlers).install(t).calls;
  // The live handler table, for per-test overrides: unshift, not push —
  // entries are tried in order, so a pushed override loses to the defaults.
  state.handlers = handlers;
  return state;
}

const FINALS = [
  { week: 18, tank01_game_id: 'a', home_team: 'BUF', away_team: 'MIA', game_status: 'final', current_score_home: 24, current_score_away: 17, quarter: null, time_remaining: null },
  { week: 18, tank01_game_id: 'b', home_team: 'DAL', away_team: 'WAS', game_status: 'final', current_score_home: 10, current_score_away: 27, quarter: null, time_remaining: null },
];

test('runPickemSeasonCompletion run twice completes the season and writes the champion trophy once', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [
      { id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' },
      { id: 11, owner_id: 101, username: 'bob', name: 'Bob Squad' },
    ],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });
  const now = new Date('2027-01-11T06:00:00Z');

  const first = await scheduler.runPickemSeasonCompletion({ now });
  const second = await scheduler.runPickemSeasonCompletion({ now });

  assert.equal(first.length, 1);
  assert.equal(first[0].leagueId, 1);
  assert.deepEqual(first[0].champions.map((c) => c.teamId), [10]);
  assert.deepEqual(second, [], 'a completed league is not a candidate again');
  assert.equal(world.statusUpdates, 1);
  assert.equal(world.league.season_status, 'complete');
  assert.deepEqual(world.trophies, [{
    leagueId: 1, teamId: 10, season: 2026, week: 0, type: 'pickem_champion',
    label: "2026 Pick'em Champion", data: { points: 2, correct: 2, mode: 'straight' },
  }]);
  assert.deepEqual(world.result, {
    league_id: 1,
    season: 2026,
    outcome: 'champions',
    scoring_mode: 'straight',
    champions: [{
      teamId: 10,
      teamName: 'Sunday Ballers',
      avatarUrl: null,
      avatarStaticUrl: null,
      points: 2,
      correct: 2,
      mode: 'straight',
    }],
    declared_at: '2027-01-11T06:00:00.000Z',
  });
  const leagueWide = world.notifications.filter((n) => n.type === 'season');
  assert.deepEqual(leagueWide.map((n) => n.userId).sort(), [100, 101]);
  assert.equal(leagueWide[0].message, "The pick'em season is over. Sunday Ballers wins with 2 points.");
  // The trophy owner is told post-commit, best-effort, exactly once.
  assert.deepEqual(
    world.notifications.filter((n) => n.type === 'trophy'),
    [{ userId: 100, type: 'trophy', message: "Trophy earned: 2026 Pick'em Champion" }]
  );

  // Transaction boundary: everything from BEGIN to COMMIT rides the checked-out
  // client, the season slate (whose recap probe swallows a missing-table
  // error, which would poison an open transaction) is read on the pool
  // BEFORE the transaction, and the owner notification comes after it.
  const clientCalls = world.calls.filter((c) => c.via === 'client').map((c) => c.text);
  assert.equal(clientCalls[0], 'BEGIN');
  assert.equal(clientCalls[clientCalls.length - 1], 'COMMIT');
  assert.ok(!clientCalls.some((text) => /game_recaps|FROM "nfl_games"|FROM "live_game_states"/.test(text)));
  assert.ok(clientCalls.some((text) => /^INSERT INTO "pickem_season_results"/.test(text)));
  assert.ok(clientCalls.some((text) => /^UPDATE "leagues" SET "season_status" = 'complete'/.test(text)));
  assert.ok(clientCalls.some((text) => /INSERT INTO "trophies"/.test(text)));
  const trophyNotice = world.calls.find((c) => /INSERT INTO "notifications"/.test(c.text) && c.params[2] === 'trophy');
  assert.equal(trophyNotice.via, 'pool');
  const commitAt = world.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(world.calls.indexOf(trophyNotice) > commitAt, 'owner notification is post-commit');
});

test('co-champions are declared completely and each gets a Co-Champion trophy', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [
      { id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' },
      { id: 11, owner_id: 101, username: 'bob', name: 'Bob Squad' },
      { id: 12, owner_id: 102, username: 'cara', name: 'Cara Crew' },
    ],
    picks: [
      // alice and bob both go 2-0; cara goes 1-1.
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 102, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 102, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });
  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  // Co-champions tie on points and correct picks, so they order by Team name
  // now (#343): 'Bob Squad' (team 11) sorts before 'Sunday Ballers' (team 10),
  // where the old username tiebreak put alice's team 10 first.
  assert.deepEqual(completed[0].champions.map((c) => c.teamId), [11, 10]);
  assert.deepEqual(world.result.champions.map((champion) => champion.teamId), [11, 10]);
  assert.deepEqual(world.trophies, [
    {
      leagueId: 1, teamId: 11, season: 2026, week: 0, type: 'pickem_champion',
      label: "2026 Pick'em Co-Champion", data: { points: 2, correct: 2, mode: 'straight' },
    },
    {
      leagueId: 1, teamId: 10, season: 2026, week: 0, type: 'pickem_champion',
      label: "2026 Pick'em Co-Champion", data: { points: 2, correct: 2, mode: 'straight' },
    },
  ]);
  assert.equal(world.league.season_status, 'complete');
  const leagueWide = world.notifications.filter((n) => n.type === 'season');
  assert.equal(leagueWide[0].message, "The pick'em season is over. Bob Squad and Sunday Ballers share the title with 2 points.");
});

test('a champion missing required historical identity aborts completion', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Broken Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
    ],
    live: FINALS,
  });
  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  assert.deepEqual(completed, []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.result, null);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(world.notifications, []);
  assert.ok(world.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(!world.calls.some((call) => call.text === 'COMMIT'));
});

test('a former picker missing Team identity does not block a current Team champion', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Former Picker Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  assert.deepEqual(completed[0].champions.map((champion) => champion.teamId), [10]);
  assert.equal(world.league.season_status, 'complete');
  assert.deepEqual(world.result.champions.map((champion) => champion.teamId), [10]);
  assert.ok(world.calls.some((call) => call.text === 'COMMIT'));
});

test('a league-wide notification failure rolls back result, status, and trophies together', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Atomic Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
    ],
    live: FINALS,
  });
  world.handlers.unshift([
    /^INSERT INTO "notifications"/,
    () => { throw new Error('notification write failed'); },
    'client',
  ]);

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  assert.deepEqual(completed, []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.result, null);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(world.notifications, []);
  assert.equal(world.statusUpdates, 0);
  assert.ok(world.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(!world.calls.some((call) => call.text === 'COMMIT'));
});

test('completion declares an explicit no-champion result when every manager finishes at zero', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Zero Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null }],
    live: FINALS,
  });

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].champions, []);
  assert.equal(world.league.season_status, 'complete');
  assert.equal(world.result.outcome, 'no_champion');
  assert.deepEqual(world.result.champions, []);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(
    world.notifications.filter((notification) => notification.type === 'season').map((notification) => notification.message),
    ["The pick'em season is over."]
  );
});

test('zombie guard: a league with no picks this season, or created after week 18 kicked off, never completes', async (t) => {
  const noPicks = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Ghost Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [],
    live: FINALS,
  });
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') }), []);
  assert.equal(noPicks.league.season_status, 'regular');
  assert.equal(noPicks.trophies.length, 0);
  assert.ok(noPicks.calls.some((c) => c.text === 'ROLLBACK'), 'the guard is checked under the row lock');

  const lateCreate = pickemSeasonWorld(t, {
    // Created in the dead window between week 18 and the next schedule sync:
    // seeded to the finished season at week 18 with picks somehow present.
    league: { id: 2, name: 'Late Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2027-02-01T00:00:00.000Z' },
    teams: [{ id: 20, owner_id: 200, username: 'zed', name: 'Zed Heads' }],
    picks: [{ user_id: 200, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: FINALS,
  });
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-03-01T06:00:00Z') }), []);
  assert.equal(lateCreate.league.season_status, 'regular');
  assert.ok(!lateCreate.calls.some((c) => c.text === 'BEGIN'), 'skipped without opening a transaction');
});

test('the tick syncs pick\'em-only weeks right before the pick\'em reminders, and completes seasons right after', () => {
  // Same source-order pin as holdout.service.test.js uses for the deadline
  // duties: reminders must read the freshly synced week in the SAME tick.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const body = source.slice(source.indexOf('async function tickUnlocked'));
  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i !== -1, `tickUnlocked does not call ${needle}`);
    return i;
  };
  const weekSync = at('runPickemWeekSync()');
  const reminders = at('sendPickemReminders()');
  const completion = at('runPickemSeasonCompletion()');
  const trades = at('processDueTrades()');
  assert.ok(weekSync < reminders, 'week sync before reminders');
  assert.ok(reminders < completion, 'completion right after reminders');
  assert.ok(completion < trades, 'both pick\'em duties before the fantasy work that follows');
});

test('runPickemSeasonCompletion does not read the season slate before week 18 has kicked off', async (t) => {
  // Every 5 minutes, all season: the cheap week-bounds query decides whether
  // completion is even possible; the three-query season slate is only pulled
  // once week 18's last kickoff has passed.
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 8, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: [],
  });
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2026-10-15T12:00:00Z') }), []);
  assert.equal(world.calls.filter((c) => /SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/.test(c.text)).length, 1);
  assert.equal(world.calls.filter((c) => /fn_normalize_nfl_team|FROM "live_game_states"|game_recaps/.test(c.text)).length, 0);
  assert.equal(world.calls.filter((c) => c.text === 'BEGIN').length, 0);
});

test('a season with no week-18 rows on file is held (and warned about), never completed on week 17', async (t) => {
  // Tank01 drops TBD-time week-18 games until the nflverse re-sync fills
  // them. Completing on week 17 would crown a champion before week 18 is
  // played, so the league waits for the rows; the warning every tick is the
  // operator's cue.
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 17, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: [],
    games: [
      { week: 17, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2027-01-03T18:00:00.000Z' },
      { week: 17, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2027-01-03T18:00:00.000Z' },
    ],
  });
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-03-01T12:00:00Z') }), []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.calls.filter((c) => c.text === 'BEGIN').length, 0);
  assert.equal(world.calls.filter((c) => /fn_normalize_nfl_team|game_recaps/.test(c.text)).length, 0, 'gate closed: no slate read');
  assert.ok(warnings.some((w) => /week 18 has no games on file/.test(w)));
});
