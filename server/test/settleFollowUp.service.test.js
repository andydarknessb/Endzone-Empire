const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const montecarlo = require('../services/montecarlo.service');
const recap = require('../services/recap.service');
const trophies = require('../services/trophy.service');
const digest = require('../services/digest.service');
const { settleFollowUp } = require('../services/settleFollowUp.service');

const ARGS = { leagueId: 7, season: 2026, week: 5 };

// Every step is stubbed at its module object and appends its name to one
// shared log, so the log IS the order the follow-up ran in.
function stubAll(t, { failing } = {}) {
  const order = [];
  const step = (label, mod, fn) =>
    t.mock.method(mod, fn, async (arg) => {
      order.push({ label, arg });
      if (failing === label) throw new Error(`${label} boom`);
      return {};
    });
  step('odds', montecarlo, 'computeLeagueOdds');
  step('generateWeeklyRecap', recap, 'generateWeeklyRecap');
  step('computeAndStoreWeeklyRecap', recap, 'computeAndStoreWeeklyRecap');
  step('awardWeeklyTrophies', trophies, 'awardWeeklyTrophies');
  step('reconcileWeeklyHighScoreTrophy', trophies, 'reconcileWeeklyHighScoreTrophy');
  step('sendWeeklyRecapDigest', digest, 'sendWeeklyRecapDigest');
  return order;
}

test('advance: odds, then the announced recap, then every trophy, then the digest', async (t) => {
  const order = stubAll(t);
  await settleFollowUp({ ...ARGS, mode: 'advance' });
  assert.deepEqual(
    order.map((o) => o.label),
    ['odds', 'generateWeeklyRecap', 'awardWeeklyTrophies', 'sendWeeklyRecapDigest']
  );
  assert.deepEqual(order[0].arg, { leagueId: 7 });
  for (const call of order.slice(1)) assert.deepEqual(call.arg, ARGS);
});

test('correction: odds, then the silent recap, then the weekly high score reconcile, no digest', async (t) => {
  const order = stubAll(t);
  await settleFollowUp({ ...ARGS, mode: 'correction' });
  assert.deepEqual(
    order.map((o) => o.label),
    ['odds', 'computeAndStoreWeeklyRecap', 'reconcileWeeklyHighScoreTrophy']
  );
  assert.deepEqual(order[1].arg, ARGS);
  assert.deepEqual(order[2].arg, ARGS);
});

for (const [mode, labels] of [
  ['advance', ['odds', 'generateWeeklyRecap', 'awardWeeklyTrophies', 'sendWeeklyRecapDigest']],
  ['correction', ['odds', 'computeAndStoreWeeklyRecap', 'reconcileWeeklyHighScoreTrophy']],
]) {
  for (const failing of labels) {
    test(`${mode}: ${failing} throwing is logged and the next step still runs`, async (t) => {
      const order = stubAll(t, { failing });
      const logs = [];
      t.mock.method(console, 'error', (...args) => { logs.push(args); });
      await settleFollowUp({ ...ARGS, mode });
      assert.deepEqual(order.map((o) => o.label), labels, 'every step still ran');
      assert.equal(logs.length, 1, 'the failure is logged once');
      assert.match(util.format(...logs[0]), /settle follow-up (w+): .* failed for league 7 week 5: .*boom/);
    });
  }
}

test('an unknown mode is refused before any step runs', async (t) => {
  const order = stubAll(t);
  await assert.rejects(settleFollowUp({ ...ARGS, mode: 'sideways' }), /mode/);
  assert.equal(order.length, 0);
});
