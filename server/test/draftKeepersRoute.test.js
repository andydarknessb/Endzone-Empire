const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, remove } = require('./helpers/fakePool');

/**
 * PUT /api/draft/league/:id/keepers — the commissioner's replace-all keeper
 * save. Two things are covered here. First (#96): the round bound it validates
 * against is the league's DRAFT roster size (starters + bench), not the
 * IR-inclusive roster_limit column. Second (#1062): this handler is the child's
 * representative site for the #1053/#1055 withTransaction pair, proving its
 * transaction closes through the wrapper (ADR 0033). The route is otherwise
 * covered by membership.rowSites.test.js and leagueType.test.js.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-keepers-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 7;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

// roster_limit 20 with 1 IR slot => 19 drafted rounds.
const league = (over = {}) => ({
  draft_status: 'pending',
  roster_limit: 20,
  ir_slots: 1,
  keeper_count: 2,
  keeper_lock_at: null,
  draft_date: null,
  is_commissioner: true,
  ...over,
});

function keeperPool(over) {
  return createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // Raw regex: the commissioner predicate subquery puts a FROM ahead of the
    // statement's own FROM "leagues", which the select() shape matcher cannot cross.
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league(over)] })],
    [select('teams'), () => ({ rows: [{ id: 11 }, { id: 12 }] })],
    [select('team_players'), () => ({ rows: [] })],
    [remove('keepers'), () => ({ rows: [], rowCount: 0 })],
    [insert('keepers'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

const save = (round) => request(app)
  .put('/api/draft/league/3/keepers')
  .set('Authorization', authed())
  .send({ keepers: [{ teamId: 11, playerId: 100, round }] });

test('PUT keepers: a round past the draft roster size is refused, naming that bound', async (t) => {
  const fake = keeperPool().install(t);

  const res = await save(20);

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /between 1 and 19/);
  assert.match(res.body.error, /draft roster size/);
  // #274. Saving keepers is a replace-all: the handler DELETEs the league's
  // whole slate before it re-INSERTs. The INSERT count alone left the
  // destructive half unobserved, and the destructive half is the damaging
  // one. Move the validation guard down by a single statement, below the
  // DELETE, and the slate is wiped, the ROLLBACK hides it, and the response
  // is a byte-identical 400. Both counts, so a moved guard cannot pass.
  assert.equal(fake.matching(remove('keepers')).length, 0, 'the keeper slate was not deleted');
  assert.equal(fake.matching(insert('keepers')).length, 0, 'no keeper was written');
  fake.assertClean();
});

test('PUT keepers: the last drafted round is accepted', async (t) => {
  const fake = keeperPool().install(t);

  const res = await save(19);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.keepers, 1);
  fake.assertClean();
});

test('PUT keepers: a zero-IR league still keeps through its whole roster limit', async (t) => {
  const fake = keeperPool({ ir_slots: 0 }).install(t);

  const res = await save(20);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  fake.assertClean();
});

// #1062 Ruling 5: this handler is the child's representative site for the
// #1053/#1055 pair. It proves the PUT keepers transaction now closes through
// withTransaction (ADR 0033) rather than the old bare
// `client.query('ROLLBACK').catch(() => {})` + bare `client.release()`. Both
// cases drive an error out of the INSERT (a 23503, the fault the handler's
// outer catch maps); they differ only in whether the ROLLBACK itself rejects.
function keeperPoolInsertFails(rollbackThrows) {
  const handlers = [
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league()] })],
    [select('teams'), () => ({ rows: [{ id: 11 }, { id: 12 }] })],
    [select('team_players'), () => ({ rows: [] })],
    [remove('keepers'), () => ({ rows: [], rowCount: 0 })],
    [insert('keepers'), () => {
      const err = new Error('insert or update on table "keepers" violates foreign key constraint');
      err.code = '23503';
      throw err;
    }],
  ];
  if (rollbackThrows) {
    handlers.push([/^ROLLBACK$/, () => { throw new Error('rollback boom'); }, 'client']);
  }
  return createFakePool(handlers);
}

test('PUT keepers: a rejecting ROLLBACK destroys the connection and the ORIGINAL error still maps', async (t) => {
  const fake = keeperPoolInsertFails(true).install(t);

  const res = await save(19);

  // The 23503 mapping moved into the outer catch (Ruling 3): the response is the
  // INSERT's original 23503 code mapping, NOT the 500 the rollback failure would
  // produce if it had surfaced. That proves withTransaction rethrew the ORIGINAL
  // error, not `rollback boom`.
  //
  // Ruling 5 also asks this case to assert the original error carries the
  // attached `rollbackError`. That is unobservable at this layer: the handler's
  // catch turns the thrown error into an HTTP response and never exposes the
  // error object, so the attachment cannot be inspected through supertest. The
  // wrapper's own test (withTransaction.test.js) asserts `err.rollbackError` on
  // the rethrown error directly; here we assert the two route-observable
  // consequences of that same path - the original error's mapping survives, and
  // the connection was destroyed (releaseArgs below) - which together prove the
  // site routes through the wrapper.
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /unknown team or player/);
  // Red-tell (AC2): a rejecting ROLLBACK leaves the transaction open on the
  // socket, so withTransaction destroys the connection - releases WITH an Error
  // - and pg-pool drops it. Restoring a bare `client.release()` at this site
  // returns the open-transaction client to the pool and reddens assertClean.
  fake.assertClean();
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
});

test('PUT keepers: control - an ordinary INSERT error keeps its healthy connection', async (t) => {
  const fake = keeperPoolInsertFails(false).install(t);

  const res = await save(19);

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /unknown team or player/);
  // Red-tell (AC2): the ROLLBACK succeeds, so the connection returns to the pool
  // bare. Making withTransaction's release unconditional (release WITH an Error
  // on every close) reddens this control.
  assert.equal(fake.releaseArgs()[0], undefined, 'a clean ROLLBACK returns the connection to the pool bare');
  fake.assertClean();
});
