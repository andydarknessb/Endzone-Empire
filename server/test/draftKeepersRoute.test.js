const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, remove } = require('./helpers/fakePool');

/**
 * PUT /api/draft/league/:id/keepers — the commissioner's replace-all keeper
 * save. Covered here for one thing only: the round bound it validates against
 * is the league's DRAFT roster size (starters + bench), not the IR-inclusive
 * roster_limit column (#96). The route is otherwise covered by
 * membership.rowSites.test.js and leagueType.test.js.
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
