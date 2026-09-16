const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const { generateMatchups, scoreMatchups } = require('../services/matchupScoring.service');

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
