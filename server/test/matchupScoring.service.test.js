const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const { installRecordingBroadcast } = require('./helpers/recordingBroadcast');
const expectedFinalService = require('../services/expectedFinal.service');
const { generateMatchups, scoreMatchups } = require('../services/matchupScoring.service');
const { roundRobinPairings } = require('../services/season.service');

// The following moved from scoring.service.test.js (#1506, spec #1492): all
// exercise matchupScoring.service.js's generateMatchups/scoreMatchups
// transaction rollback wiring.

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

// #2414: the button fills a week with the season's own rotation, so the teams
// come back in the regular-season builder's order (draft_position NULLS LAST,
// id) and the pairs are roundRobinPairings of that order. The fake honors the
// ORDER BY in the SQL it is given, so reverting to ORDER BY "id" turns this red.
test('generateMatchups: pairs equal roundRobinPairings of the draft-ordered teams, bye included (#2414)', async (t) => {
  const teams = [
    { id: 1, draft_position: 4 },
    { id: 2, draft_position: 2 },
    { id: 3, draft_position: 5 },
    { id: 4, draft_position: 1 },
    { id: 5, draft_position: 3 },
  ];
  const byDraft = (a, b) => a.draft_position - b.draft_position || a.id - b.id;
  const byId = (a, b) => a.id - b.id;
  const inserted = [];
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [OPEN_LEAGUE] }), 'client'],
    [select('matchups'), () => ({ rows: [] }), 'client'],
    [select('teams'), (text) => ({
      rows: [...teams].sort(/ORDER BY "draft_position" NULLS LAST, "id"$/.test(text) ? byDraft : byId).map((r) => ({ id: r.id })),
    }), 'client'],
    [/^INSERT INTO "matchups"/, (text, params) => { inserted.push({ home: params[3], away: params[4] }); return { rows: [] }; }, 'client'],
  ]).install(t);

  const result = await generateMatchups({ leagueId: 1, season: 2025, week: 3 });

  const draftOrder = [...teams].sort(byDraft).map((r) => r.id);
  const expected = roundRobinPairings(draftOrder, 3);
  assert.deepEqual(result, { created: expected.length });
  assert.deepEqual(inserted, expected);
  const paired = new Set(inserted.flatMap((p) => [p.home, p.away]));
  assert.equal(paired.size, 4, 'exactly one team is on a bye');
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

// #2274: a commissioner's score override (matchups.score_overridden) survives
// every re-score. The row is skipped, not recomputed, but its stored scores
// still ride the returned `scored` so the emit and advance-week stay whole.
test('scoreMatchups: an overridden matchup is not re-scored, a normal one in the same week is (#2274)', async (t) => {
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => new Map());
  installRecordingBroadcast(t);
  const base = { league_id: 1, season: 2026, week: 8, final: true };
  const matchups = [
    { ...base, id: 70, home_team_id: 10, away_team_id: 20, home_score: '101.50', away_score: '99.00', score_overridden: true },
    { ...base, id: 71, home_team_id: 30, away_team_id: 40, home_score: '5.00', away_score: '6.00', score_overridden: false },
  ];
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 1, scoring_preset: 'half_ppr', best_ball: false, roster_positions: null }] })],
    [select('matchups'), () => ({ rows: matchups.map((m) => ({ ...m })) })],
    // Every team computes to 0 this pass: no starter rows with stats.
    [/FROM "lineup_entries"/, () => ({ rows: [] })],
    [/FROM "roster_tenures"/, () => ({ rows: [] })],
    [update('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const { scored } = await scoreMatchups({ leagueId: 1, season: 2026, week: 8 });

  const writes = fake.matching(update('matchups'));
  assert.equal(writes.length, 1, 'only the non-overridden matchup is rewritten');
  assert.equal(writes[0].params[2], 71);
  const kept = scored.find((s) => s.matchupId === 70);
  assert.equal(kept.homeScore, 101.5, 'the stored override is reported, as a number');
  assert.equal(kept.awayScore, 99);
  assert.equal(kept.homeTeamId, 10);
  assert.equal(scored.find((s) => s.matchupId === 71).homeScore, 0, 'the normal matchup was re-scored');
  fake.assertClean();
});

// #2388: a standard league's live starters are read without the current-roster
// join, so a starter dropped after his kickoff (his row spared by #627) keeps
// scoring mid-week exactly as settle will count him. Best ball keeps the join.
// The fake answers the join as the table would: an off-roster row comes back
// only from a statement that no longer joins team_players.
// `notHeld` is the tenure read's answer (#2391): the ids settle's filter excludes.
async function liveScoreWithDroppedStarter(t, bestBall, notHeld = []) {
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => new Map());
  installRecordingBroadcast(t);
  const matchup = { id: 80, league_id: 1, season: 2026, week: 8, final: false, home_team_id: 10, away_team_id: 20, home_score: '0', away_score: '0', score_overridden: false };
  const dropped = { player_id: 7, slot: 'QB', position: 'QB', nfl_team: 'KC', stats: { passingYards: 250 }, on_roster: false };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 1, scoring_preset: 'half_ppr', best_ball: bestBall, roster_positions: null }] })],
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [select('matchups'), () => ({ rows: [{ ...matchup }] })],
    [/FROM "team_players" JOIN "players"/, () => ({ rows: [] })], // materializeLineup: empty roster, nothing to seed
    [/FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'KC', kickoff_at: '2026-10-25T17:00:00.000Z' }] })],
    [/FROM unnest/, () => ({ rows: notHeld.map((player_id) => ({ player_id })) })],
    [/FROM "lineup_entries"/, (text, params) => ({
      rows: params[0] === 10 && !/JOIN "team_players"/.test(text) ? [dropped] : [],
    })],
    [update('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  const { scored } = await scoreMatchups({ leagueId: 1, season: 2026, week: 8 });
  fake.assertClean();
  return scored[0].homeScore;
}

test('scoreMatchups: a live standard week still scores a starter dropped after kickoff (#2388)', async (t) => {
  assert.equal(await liveScoreWithDroppedStarter(t, false), 10);
});

test('scoreMatchups: a live best-ball week still joins the current roster and drops him (#2388)', async (t) => {
  assert.equal(await liveScoreWithDroppedStarter(t, true), 0);
});

// #2391: the off-roster starter goes through settle's filter, so live never counts a row settle takes off.
test('scoreMatchups: a live standard week leaves out an off-roster starter settle would exclude (#2391)', async (t) => {
  assert.equal(await liveScoreWithDroppedStarter(t, false, [7]), 0);
});
