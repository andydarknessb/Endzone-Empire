const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  calculateFantasyPoints,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  missingTeamDefenses,
  normalizeTank01Game,
  detectScoringEvents,
  SCORING_RULES,
  generateMatchups,
  scoreMatchups,
  syncSchedule,
} = require('../services/scoring.service');

// The best-ball IR-classification assertion that used to live here moved to
// server/test/countedRoster.service.test.js (#954): the IR drop is now the
// counted-roster module's rule, tested there by direct call with a red-tell
// ('#954 best ball scores the optimal lineup over every non-IR row ...'). The
// settled-matchup emit envelope this test also pinned (status 'final', null
// expected-final and players-remaining) is covered by
// scoresUpdatedExpectedFinal.test.js, so nothing else moved with it.

test('SCORING_RULES is defined', () => {
  assert(SCORING_RULES);
  assert.equal(SCORING_RULES.passing.yards, 0.04);
  assert.equal(SCORING_RULES.passing.touchdowns, 4);
  assert.equal(SCORING_RULES.passing.interceptions, -2);
  assert.equal(SCORING_RULES.rushing.yards, 0.1);
  assert.equal(SCORING_RULES.rushing.touchdowns, 6);
  assert.equal(SCORING_RULES.receiving.reception, 0.5);
  assert.equal(SCORING_RULES.receiving.yards, 0.1);
  // Tiered stats are sorted, non-overlapping tier arrays. FG uses the five
  // NFL.com distance buckets, priced identically to the old three (0-39 = 3).
  assert.deepEqual(SCORING_RULES.kicking.fieldGoal.map((t) => [t.min, t.max, t.points]), [
    [0, 19, 3], [20, 29, 3], [30, 39, 3], [40, 49, 4], [50, null, 5],
  ]);
  assert.equal(SCORING_RULES.teamDefense.pointsAllowed.at(-1).max, null);
  assert.equal(SCORING_RULES.idp.sack, 2);
  // NFL.com-parity leaves: return TD scores like a touchdown by default;
  // yardage rates and kick-miss penalties default to 0 (opt-in).
  assert.equal(SCORING_RULES.misc.returnTDs, 6);
  assert.equal(SCORING_RULES.misc.puntReturnYards, 0);
  assert.equal(SCORING_RULES.misc.kickReturnYards, 0);
  assert.equal(SCORING_RULES.kicking.fieldGoalMissed, 0);
  assert.equal(SCORING_RULES.kicking.extraPointMissed, 0);
});

test('calculateFantasyPoints returns 0 for empty object', () => {
  assert.equal(calculateFantasyPoints({}), 0);
});

test('calculateFantasyPoints returns 0 for null', () => {
  assert.equal(calculateFantasyPoints(null), 0);
});

test('calculateFantasyPoints returns 0 for undefined', () => {
  assert.equal(calculateFantasyPoints(undefined), 0);
});

test('calculateFantasyPoints: QB line {passingYards: 300, passingTDs: 2, interceptions: 1} = 18', () => {
  const stats = { passingYards: 300, passingTDs: 2, interceptions: 1 };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 18);
});

test('calculateFantasyPoints: RB line {rushingYards: 100, rushingTDs: 1, receptions: 4, receivingYards: 25} = 20.5', () => {
  const stats = {
    rushingYards: 100,
    rushingTDs: 1,
    receptions: 4,
    receivingYards: 25,
  };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 20.5);
});

test('calculateFantasyPoints: a return TD scores 6 by default; return yards and kick misses are 0 until configured', () => {
  assert.equal(calculateFantasyPoints({ returnTDs: 1, puntReturnYards: 40, kickReturnYards: 55 }), 6);
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, extraPointMissed: 1 }), 0);
  const missPenaltyRules = JSON.parse(JSON.stringify(SCORING_RULES));
  missPenaltyRules.kicking.fieldGoalMissed = -1;
  missPenaltyRules.misc.puntReturnYards = 0.04; // 1 pt / 25 yds
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, puntReturnYards: 50 }, missPenaltyRules), 0);
});

test('calculateFantasyPoints ignores unknown stat keys', () => {
  const stats = { bogusStat: 999 };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints ignores non-numeric values', () => {
  const stats = { passingYards: 'abc' };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints rounds result to 2 decimals', () => {
  const stats = { passingYards: 333 };
  // 333 * 0.04 = 13.32, should round correctly
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 13.32);
});

test('calculateFantasyPoints: mixed valid and invalid values', () => {
  const stats = { passingYards: 100, passingTDs: 'invalid', rushingYards: 50 };
  // 100 * 0.04 + 50 * 0.1 = 4 + 5 = 9
  assert.equal(calculateFantasyPoints(stats), 9);
});

// --- Tank01 response handling ------------------------------------------------

test('tank01Body unwraps the { statusCode, body } envelope', () => {
  assert.deepEqual(tank01Body({ statusCode: 200, body: [1, 2] }), [1, 2]);
});

test('tank01Body passes through raw payloads and null', () => {
  assert.deepEqual(tank01Body([{ a: 1 }]), [{ a: 1 }]);
  assert.equal(tank01Body(null), null);
});

test('normalizeTank01Stats maps a full box-score entry', () => {
  const entry = {
    playerID: '3915511',
    Passing: { passYds: '312', passTD: '2', int: '1' },
    Rushing: { carries: '4', rushYds: '22', rushTD: '1' },
    Receiving: { targets: '1', receptions: '1', recYds: '8', recTD: '0' },
    Kicking: { fgMade: '2', fgAttempts: '3', xpMade: '3', xpAttempts: '3' },
    Defense: { fumblesLost: '1' },
    Punting: { puntReturns: '2', puntReturnYds: '18', puntReturnTD: '0' },
  };
  assert.deepEqual(normalizeTank01Stats(entry), {
    passingYards: 312,
    passingTDs: 2,
    interceptions: 1,
    rushingYards: 22,
    rushingTDs: 1,
    receivingYards: 8,
    receivingTDs: 0,
    receptions: 1,
    fumbles: 1,
    fieldGoal: 2,
    fieldGoalMissed: 1, // 3 attempts - 2 made
    extraPoint: 3,
    extraPointMissed: 0,
    returnTDs: 0,
    puntReturns: 2,
    puntReturnYards: 18,
  });
});

test('normalizeTank01Stats: missing categories mean zeros; top-level fumblesLost accepted', () => {
  const result = normalizeTank01Stats({ fumblesLost: '2' });
  assert.equal(result.fumbles, 2);
  assert.equal(result.passingYards, 0);
  assert.equal(result.receptions, 0);
  assert.equal(result.returnTDs, 0);
  assert.deepEqual(normalizeTank01Stats(null).passingYards, 0);
});

test('normalizeTank01Stats strips comma separators', () => {
  const result = normalizeTank01Stats({ Passing: { passYds: '1,250' } });
  assert.equal(result.passingYards, 1250);
});

test('normalizeTank01Stats maps a punt-return touchdown', () => {
  const result = normalizeTank01Stats({ Punting: { puntReturns: '1', puntReturnYds: '82', puntReturnTD: '1' } });
  assert.equal(result.returnTDs, 1);
  assert.equal(result.puntReturns, 1);
  assert.equal(result.puntReturnYards, 82);
});

// --- Individual defender (IDP) handling ---------------------------------------

test('normalizeTank01IdpStats maps a defender\'s Defense category to IDP scoring keys', () => {
  const result = normalizeTank01IdpStats({
    Defense: {
      totalTackles: '5', soloTackles: '3', sacks: '1', defensiveInterceptions: '0',
      forcedFumbles: '1', fumblesRecovered: '0', passDeflections: '2', qbHits: '1',
      tfl: '1', defTD: '0',
    },
  });
  assert.deepEqual(result, {
    soloTackle: 3,
    assistedTackle: 2, // totalTackles - soloTackles
    idpSack: 1,
    idpInterception: 0,
    forcedFumble: 1,
    idpFumbleRecovery: 0,
    passDeflection: 2,
    qbHit: 1,
    tacklesForLoss: 1,
    idpDefensiveTD: 0,
    twoPointReturn: 0,
  });
});

test('normalizeTank01IdpStats: defTD is credited as fumble-return TD only after removing interceptionTDs', () => {
  const result = normalizeTank01IdpStats({ Defense: { defTD: '2', interceptionTDs: '1' } });
  assert.equal(result.idpDefensiveTD, 1);
});

test('normalizeTank01IdpStats: missing/empty Defense category is all-zero', () => {
  assert.deepEqual(normalizeTank01IdpStats({}), {
    soloTackle: 0, assistedTackle: 0, idpSack: 0, idpInterception: 0, forcedFumble: 0,
    idpFumbleRecovery: 0, passDeflection: 0, qbHit: 0, tacklesForLoss: 0, idpDefensiveTD: 0,
    twoPointReturn: 0,
  });
  assert.equal(normalizeTank01IdpStats(null).soloTackle, 0);
});

// --- Play-by-play bonus-stat extraction (FG distance / TD length) ------------

test('extractPlayByPlayBonusStats collects a made FG\'s distance for the kicker', () => {
  const plays = [
    { playerStats: { '123': { Kicking: { fgMade: '1', fgAttempts: '1', fgYds: '41' } } } },
    { playerStats: { '123': { Kicking: { fgAttempts: '1', fgYds: '37' } } } }, // missed — no fgMade
  ];
  const result = extractPlayByPlayBonusStats(plays);
  assert.deepEqual(result.get('123').fieldGoalDistances, [41]);
});

test('extractPlayByPlayBonusStats collects passing/rushing/receiving TD lengths from the same-play yardage', () => {
  const plays = [
    { playerStats: { p1: { Passing: { passTD: '1', passYds: '5' } }, p2: { Receiving: { recTD: '1', recYds: '5' } } } },
    { playerStats: { p3: { Rushing: { rushTD: '1', rushYds: '45' } } } },
    { playerStats: { p3: { Rushing: { rushYds: '3' } } } }, // non-TD run — ignored
  ];
  const result = extractPlayByPlayBonusStats(plays);
  assert.deepEqual(result.get('p1').passingTDLengths, [5]);
  assert.deepEqual(result.get('p2').receivingTDLengths, [5]);
  assert.deepEqual(result.get('p3').rushingTDLengths, [45]);
});

test('extractPlayByPlayBonusStats tolerates a missing/empty play list', () => {
  assert.equal(extractPlayByPlayBonusStats(null).size, 0);
  assert.equal(extractPlayByPlayBonusStats([]).size, 0);
  assert.equal(extractPlayByPlayBonusStats([{ play: 'no playerStats here' }]).size, 0);
});

// --- Team-DEF backfill (missingTeamDefenses) ----------------------------------

test('missingTeamDefenses returns all 32 teams when none exist yet', () => {
  const missing = missingTeamDefenses([]);
  assert.equal(missing.length, 32);
  assert(missing.includes('Arizona Cardinals'));
  assert(missing.includes('San Francisco 49ers'));
});

test('missingTeamDefenses excludes teams already present, matched by abbreviation regardless of stored format', () => {
  const missing = missingTeamDefenses(['San Francisco 49ers', 'DAL']);
  assert.equal(missing.length, 30);
  assert(!missing.includes('San Francisco 49ers'));
  assert(!missing.includes('Dallas Cowboys'));
});

test('missingTeamDefenses ignores unresolvable/empty nfl_team values and null/undefined input', () => {
  assert.equal(missingTeamDefenses([null, '', 'Not A Real Team']).length, 32);
  assert.equal(missingTeamDefenses(undefined).length, 32);
});

// --- Team-defense (DST) aggregate handling ------------------------------------

test('normalizeTank01DstStats maps the box score DST side to scoring-rule stat names', () => {
  const result = normalizeTank01DstStats({
    teamAbv: 'BAL', sacks: '3', defensiveInterceptions: '1', fumblesRecovered: '1', defTD: '0',
    safeties: '0', ptsAllowed: '20', ydsAllowed: '340',
  });
  assert.deepEqual(result, {
    sack: 3, interceptionReturn: 1, fumbleRecovery: 1, defensiveTD: 0,
    safety: 0, blockedKick: 0, pointsAllowed: 20, yardsAllowed: 340,
  });
});

test('normalizeTank01DstStats treats a missing side as all-zero', () => {
  assert.deepEqual(normalizeTank01DstStats(null), {
    sack: 0, interceptionReturn: 0, fumbleRecovery: 0, defensiveTD: 0,
    safety: 0, blockedKick: 0, pointsAllowed: 0, yardsAllowed: 0,
  });
});

test('normalizeTank01DstStats attributes a blocked kick to the OPPONENT\'s teamStats line', () => {
  // The blocked side's own kick got blocked (their teamStats), so the block
  // credit belongs to the other side's defense — this call is for that side.
  const result = normalizeTank01DstStats(
    { sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0', defTD: '0' },
    { blockedFG: '1', blockedXP: '0', blockedPunt: '1' }
  );
  assert.equal(result.blockedKick, 2);
});

test('normalizeTeamAbbr passes through an already-abbreviated nfl_team', () => {
  assert.equal(normalizeTeamAbbr('BAL'), 'BAL');
  assert.equal(normalizeTeamAbbr('SF'), 'SF');
});

test('normalizeTeamAbbr resolves a full team name to its Tank01 abbreviation', () => {
  assert.equal(normalizeTeamAbbr('San Francisco 49ers'), 'SF');
  assert.equal(normalizeTeamAbbr('Dallas Cowboys'), 'DAL');
});

test('normalizeTeamAbbr returns null for unknown/empty input', () => {
  assert.equal(normalizeTeamAbbr(''), null);
  assert.equal(normalizeTeamAbbr(null), null);
  assert.equal(normalizeTeamAbbr('Not A Real Team'), null);
});

// --- Scoring-event detection (touchdowns and non-TD "moment" plays) ----------

test('detectScoringEvents fires a touchdown-caliber event for a new passing TD', () => {
  const events = detectScoringEvents({ passingTDs: 1 }, { passingTDs: 2 });
  assert.deepEqual(events, [{ type: 'passing', statKey: 'passingTDs', tdDelta: 1, isTouchdown: true }]);
});

test('detectScoringEvents fires a non-touchdown event for a new sack/field goal/fumble recovery', () => {
  const events = detectScoringEvents(
    { sack: 0, fieldGoal: 0, fumbleRecovery: 0 },
    { sack: 1, fieldGoal: 1, fumbleRecovery: 1 }
  );
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['fieldGoal', 'fumble', 'sack']);
  assert(events.every((e) => e.isTouchdown === false));
});

test('detectScoringEvents produces nothing for yardage-only changes or unchanged stats', () => {
  assert.deepEqual(detectScoringEvents({ passingYards: 100 }, { passingYards: 300 }), []);
  assert.deepEqual(detectScoringEvents({ sack: 2 }, { sack: 2 }), []);
});

test('normalizeTank01Game builds kickoff from epoch and requires both teams', () => {
  const game = normalizeTank01Game({
    gameID: '20250907_BUF@NYJ',
    away: 'BUF',
    home: 'NYJ',
    gameTime_epoch: '1757266200.0',
  });
  assert.equal(game.home, 'NYJ');
  assert.equal(game.away, 'BUF');
  assert.equal(game.kickoffAt.getTime(), 1757266200000);
  assert.equal(normalizeTank01Game({ home: 'NYJ', gameTime_epoch: '1' }), null);
  assert.equal(normalizeTank01Game({ home: 'NYJ', away: 'BUF' }), null);
  assert.equal(normalizeTank01Game(null), null);
});

// #1203: syncSchedule (Sync run module, ADR 0036, job 'schedule') fetches all
// 18 weeks before writing anything, then upserts the single unit in one
// transaction under NFL_GAMES_BULK_WRITE_LOCK (23005) - the same lock
// syncScheduleFromNflverse takes, so a Tank01 run and an nflverse run started
// together serialize instead of interleaving their upserts.

test('syncSchedule fetches all 18 weeks before writing, then upserts both team perspectives in one transaction under NFL_GAMES_BULK_WRITE_LOCK', async (t) => {
  const apiCalls = [];
  const api = async (path, opts) => {
    assert.equal(path, '/getNFLGamesForWeek');
    apiCalls.push(opts.params.week);
    return {
      data: {
        body: [{ home: 'NYJ', away: 'BUF', gameTime_epoch: String(1700000000 + opts.params.week) }],
      },
    };
  };
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, api });

  assert.deepEqual(apiCalls, Array.from({ length: 18 }, (_, i) => i + 1), 'exactly one call per regular-season week');
  const writes = fake.matching(insert('nfl_games'));
  assert.equal(writes.length, 36, 'one game per week, two rows per game (home + away perspective)');
  assert.deepEqual(result, { season: 2026, gamesUpserted: 36, failedWeeks: [] });

  // Red-tell: remove the lock and this ordering assertion (or the pg
  // serialization test) goes red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const firstWriteIdx = fake.calls.findIndex((c) => /^INSERT INTO "nfl_games"/.test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(lockIdx >= 0, 'the advisory lock is acquired');
  assert.equal(fake.calls[lockIdx].via, 'client', 'the lock sits inside the transaction client');
  assert.deepEqual(fake.calls[lockIdx].params, [23005], 'the lock id is 23005 (nfl-games-bulk-write)');
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.ok(lockIdx < firstWriteIdx, 'the lock is taken before the first upsert');
  assert.ok(commitIdx > firstWriteIdx, 'every write commits in the same transaction');
  fake.assertClean();
});

test('syncSchedule tolerates a throwing week and a non-array week: still calls every week and carries both in failedWeeks', async (t) => {
  const apiCalls = [];
  const api = async (path, opts) => {
    const { week } = opts.params;
    apiCalls.push(week);
    if (week === 3) throw new Error('tank01 quota exceeded');
    if (week === 7) return { data: { body: { not: 'an array' } } };
    return { data: { body: [{ home: 'NYJ', away: 'BUF', gameTime_epoch: '1700000000' }] } };
  };
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, api });

  assert.equal(apiCalls.length, 18, 'every week is still called - Tank01 quota is metered per call regardless of earlier failures');
  assert.deepEqual(result.failedWeeks.map((f) => f.week), [3, 7]);
  assert.equal(result.failedWeeks[0].message, 'tank01 quota exceeded');
  assert.match(result.failedWeeks[1].message, /unexpected getNFLGamesForWeek response shape/);
  assert.equal(result.gamesUpserted, 32, '16 successful weeks x 2 rows; the other weeks wrote nothing');
  fake.assertClean();
});

test('syncSchedule: when every week fails to fetch, the run is fetch_failed and nothing is written', async (t) => {
  const api = async () => { throw new Error('tank01 down'); };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(syncSchedule({ season: 2026, api }), /every week failed to fetch/);

  assert.equal(fake.calls.some((c) => c.text === 'BEGIN'), false, 'fetch failed before any unit reached the transaction');
  const runInsert = fake.matching(insert('data_sync_runs'))[0];
  assert.ok(runInsert, 'the failed run is still recorded');
  const detail = JSON.parse(runInsert.params[3]);
  assert.equal(detail.reason, 'fetch_failed');
});

// #1055: generateMatchups and scoreMatchups each own a pool.connect()
// transaction whose catch used to run a bare `await client.query('ROLLBACK')`
// and whose finally released the client bare. A ROLLBACK that itself rejects
// then (a) replaced the original error on the way out and (b) returned a client
// with an open transaction to the pool, stranding any lock behind the pooler
// (#839). These mirror #1048/#1053's runInjurySync tests: per site, the
// rejecting-ROLLBACK case and the clean-ROLLBACK control. Each site's first
// statement after BEGIN is a SELECT on "leagues", so a throwing select('leagues')
// handler reaches the transaction catch at both.

test('generateMatchups: a rejecting ROLLBACK destroys the connection and keeps the original error', async (t) => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const fake = createFakePool([
    [select('leagues'), () => { throw new Error('boom'); }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback boom'); }, 'client'],
  ]).install(t);

  // Red-tell C (criterion 4): reverting the catch to the bare
  // `await client.query('ROLLBACK'); throw error;` lets the rollback rejection
  // ('rollback boom') replace the original, reddening the err.message check.
  await assert.rejects(
    generateMatchups({ leagueId: 1, season: 2025, week: 1 }),
    (err) => {
      assert.equal(err.message, 'boom', 'the original error surfaces, not the rollback failure');
      assert.equal(err.rollbackError.message, 'rollback boom', 'the rollback failure is attached to the original error');
      return true;
    }
  );

  // A rejecting ROLLBACK leaves the transaction open on the socket, so the
  // finally releases the client WITH an Error: pg-pool destroys the connection
  // and Postgres frees the session's locks on disconnect. assertClean reports
  // clean because the client was destroyed, not because the transaction closed.
  // Red-tell A (criterion 2): reverting the finally to a bare client.release()
  // returns the open-transaction client to the pool and reddens assertClean on
  // 'transaction left open'.
  fake.assertClean();
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
  assert.equal(errorLog.mock.callCount(), 1, 'the rollback failure is logged once');
});

test('generateMatchups: an ordinary error keeps its healthy connection', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => { throw new Error('boom'); }, 'client'],
  ]).install(t);

  await assert.rejects(
    generateMatchups({ leagueId: 1, season: 2025, week: 1 }),
    (err) => {
      assert.equal(err.message, 'boom');
      assert.equal(err.rollbackError, undefined, 'a clean ROLLBACK attaches no rollbackError');
      return true;
    }
  );

  // Ruling 1 control / Red-tell B (criterion 3): the ROLLBACK succeeds (the fake
  // auto-answers it), so the connection is healthy and returned to the pool with
  // no argument. Changing the finally to release(new Error(...)) unconditionally
  // reddens this releaseArgs()[0] check.
  assert.equal(fake.releaseArgs()[0], undefined, 'an ordinary error keeps its healthy connection');
  fake.assertClean();
});

// #1060 Ruling 3: generateMatchups' two early-out paths used to run a bare
// `await client.query('ROLLBACK'); return ...`. Inside withTransaction they are
// plain returns, so the (read-only) transaction COMMITs - harmless, and it
// releases the same locks a ROLLBACK would - and the connection returns to the
// pool bare. A season-ops-available league row lets both reach the early-out.
const OPEN_LEAGUE = { pickem_only: false, draft_status: 'complete', season_status: 'in_season' };

test('generateMatchups: an existing week returns a COMMITted read-only transaction, released bare (#1060 Ruling 3)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [OPEN_LEAGUE] }), 'client'],
    [select('matchups'), () => ({ rows: [{ exists: 1 }] }), 'client'],
  ]).install(t);

  const result = await generateMatchups({ leagueId: 1, season: 2025, week: 1 });
  assert.deepEqual(result, { created: 0, reason: 'matchups already exist for this week' });
  // Red-tell: restoring the bare `await client.query('ROLLBACK'); return ...`
  // reddens the COMMIT assert and the ROLLBACK-count assert below.
  assert.ok(fake.calls.some((c) => c.text === 'COMMIT'), 'the early-out COMMITs the read-only transaction');
  assert.equal(fake.calls.filter((c) => c.text === 'ROLLBACK').length, 0, 'the early-out never ROLLBACKs');
  assert.equal(fake.releaseArgs()[0], undefined, 'the connection returns to the pool bare');
  fake.assertClean();
});

test('generateMatchups: fewer than two teams returns a COMMITted read-only transaction, released bare (#1060 Ruling 3)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [OPEN_LEAGUE] }), 'client'],
    [select('matchups'), () => ({ rows: [] }), 'client'],
    [select('teams'), () => ({ rows: [{ id: 1 }] }), 'client'],
  ]).install(t);

  const result = await generateMatchups({ leagueId: 1, season: 2025, week: 1 });
  assert.deepEqual(result, { created: 0, reason: 'need at least 2 teams' });
  assert.ok(fake.calls.some((c) => c.text === 'COMMIT'), 'the early-out COMMITs the read-only transaction');
  assert.equal(fake.calls.filter((c) => c.text === 'ROLLBACK').length, 0, 'the early-out never ROLLBACKs');
  assert.equal(fake.releaseArgs()[0], undefined, 'the connection returns to the pool bare');
  fake.assertClean();
});

test('scoreMatchups: a rejecting ROLLBACK destroys the connection and keeps the original error', async (t) => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const fake = createFakePool([
    [select('leagues'), () => { throw new Error('boom'); }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback boom'); }, 'client'],
  ]).install(t);

  await assert.rejects(
    scoreMatchups({ leagueId: 1, season: 2025, week: 1 }),
    (err) => {
      assert.equal(err.message, 'boom', 'the original error surfaces, not the rollback failure');
      assert.equal(err.rollbackError.message, 'rollback boom', 'the rollback failure is attached to the original error');
      return true;
    }
  );

  fake.assertClean();
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
  assert.equal(errorLog.mock.callCount(), 1, 'the rollback failure is logged once');
});

test('scoreMatchups: an ordinary error keeps its healthy connection', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => { throw new Error('boom'); }, 'client'],
  ]).install(t);

  await assert.rejects(
    scoreMatchups({ leagueId: 1, season: 2025, week: 1 }),
    (err) => {
      assert.equal(err.message, 'boom');
      assert.equal(err.rollbackError, undefined, 'a clean ROLLBACK attaches no rollbackError');
      return true;
    }
  );

  assert.equal(fake.releaseArgs()[0], undefined, 'an ordinary error keeps its healthy connection');
  fake.assertClean();
});
