const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

/**
 * PUT /api/league/:id trade deadline is tri-state (#65): a week sets it,
 * null clears it, an absent key leaves it alone. The write used to be a
 * COALESCE, which cannot tell null from absent, so the commissioner's
 * "clear the deadline" save was a silent no-op that still reported success.
 * Same harness as the settings-freeze route test.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-trade-deadline-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const COMMISSIONER = 7;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commissioner' })}`;

// The bug's scenario: a fantasy league whose draft is over and whose season is
// under way, the commissioner editing Playoffs & Schedule. The trade deadline
// is an administrative setting (never draft-frozen), so the save is allowed.
const statusRow = () => ({
  draft_status: 'complete', draft_type: 'snake', min_teams: 2, max_teams: 10, draft_date: null,
  roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
  keepers_enabled: false, keeper_count: 0, pickem_only: false, season_status: 'regular', team_count: 3,
});

/** Mock the pool: the status read answers with the in-season fantasy row, the UPDATE succeeds. */
function mockPool(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (text.includes('SELECT "draft_status"')) return { rows: [statusRow()] };
    if (text.startsWith('UPDATE "leagues"')) {
      return { rows: [{ id: 1, owner_id: COMMISSIONER, name: 'Ballers', pickem_only: false }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  return calls;
}

// Bind positions in the settings UPDATE (1-based, as in the SQL): $9 is the
// trade-deadline value (its position is unchanged), $37 is the "was it sent"
// flag appended at the end for this feature; #116 later appended
// draftTimezoneProvided/draftTimezone as $38/$39, so the total below has
// grown past PROVIDED_PARAM without moving anything this file pins. The
// others below are pre-existing positions the position-stability test pins.
const VALUE_PARAM = 9;
const LEAGUE_ID_PARAM = 17;
const USER_ID_PARAM = 18;
const DRAFT_DATE_PROVIDED_PARAM = 22;
const ORDER_OVERRIDES_PROVIDED_PARAM = 31;
const KEEPER_LOCK_PROVIDED_PARAM = 35;
const PROVIDED_PARAM = 37;

const updateOf = (calls) => {
  const update = calls.find((c) => c.text.startsWith('UPDATE "leagues"'));
  assert.ok(update, 'the UPDATE ran');
  assert.match(update.text, /"trade_deadline_week" = CASE WHEN \$37::boolean THEN \$9::integer ELSE "trade_deadline_week" END/);
  return update;
};

test('tradeDeadlineWeek: null clears the deadline (provided flag true, value null)', async (t) => {
  const calls = mockPool(t);
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ tradeDeadlineWeek: null });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = updateOf(calls);
  assert.equal(update.params[PROVIDED_PARAM - 1], true);
  assert.equal(update.params[VALUE_PARAM - 1], null);
});

test('tradeDeadlineWeek: 11 sets the deadline (provided flag true, value 11)', async (t) => {
  const calls = mockPool(t);
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ tradeDeadlineWeek: 11 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = updateOf(calls);
  assert.equal(update.params[PROVIDED_PARAM - 1], true);
  assert.equal(update.params[VALUE_PARAM - 1], 11);
});

test('an update without tradeDeadlineWeek leaves the deadline alone (provided flag false)', async (t) => {
  const calls = mockPool(t);
  // Another administrative setting, so the same UPDATE runs with the key absent.
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ tradeReviewHours: 24 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = updateOf(calls);
  assert.equal(update.params[PROVIDED_PARAM - 1], false);
  assert.equal(update.params[VALUE_PARAM - 1], null);
});

// #274: this test already carries the right assertion (no UPDATE "leagues"),
// and it is worth recording that the refusal is ALSO structurally out of reach
// of the write: parseSettingsPatch rejects at league.router.js:390, before
// updateLeagueSettings is called at all, so no client is checked out and no
// statement is dispatched. The existing assertion is belt and braces rather
// than the only thing standing between the caller and a write.
test('an out-of-range week is refused by the existing validator and never reaches the UPDATE', async (t) => {
  const calls = mockPool(t);
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ tradeDeadlineWeek: 0 });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /tradeDeadlineWeek must be an integer between 1 and 18 \(or null\)/);
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test('the flag was appended at the end, so every pre-existing bind position still carries its own value', async (t) => {
  const calls = mockPool(t);
  await request(app).put('/api/league/1').set('Authorization', authed()).send({ tradeDeadlineWeek: 3 });
  const update = updateOf(calls);
  // 39, not PROVIDED_PARAM (37): #116 appended two more params (draftTimezone
  // provided flag + value) after this feature's own $37.
  assert.equal(update.params.length, 39);
  // Values that would shift if the new parameter had been inserted anywhere
  // but the end: the league id and commissioner id the WHERE binds, and the
  // three other tri-state "provided" flags, all false for this body.
  assert.equal(update.params[VALUE_PARAM - 1], 3);
  assert.equal(update.params[LEAGUE_ID_PARAM - 1], 1);
  assert.equal(update.params[USER_ID_PARAM - 1], COMMISSIONER);
  assert.equal(update.params[DRAFT_DATE_PROVIDED_PARAM - 1], false);
  assert.equal(update.params[ORDER_OVERRIDES_PROVIDED_PARAM - 1], false);
  assert.equal(update.params[KEEPER_LOCK_PROVIDED_PARAM - 1], false);
  // The auction-conversion guard another route test pins by position.
  assert.match(update.text, /WHEN \$27::text = 'auction' THEN NULL/);
});
