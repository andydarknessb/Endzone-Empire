const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, remove, update } = require('./helpers/fakePool');

/**
 * POST /api/draft/league/:id/reset — issue #192.
 *
 * The reset wipes a league's draft and, with it, the current season's
 * lineup_entries rows. After #189 froze materialization on final weeks,
 * a deleted lineup_entries row behind a final matchup can never be
 * refilled: the matchup keeps its score, but nothing explains it. The
 * ruling is refuse, not repair (triage on #192): reset must 409 whenever
 * any matchup for the league's current season is already final, and must
 * NOT narrow the delete to spare only the non-final weeks. That
 * alternative was explicitly ruled out, because a reset over settled
 * weeks is a request to invalidate results that already counted.
 *
 * Reachability (corrected at triage): reset requires draft_status =
 * 'active'. Nothing moves a draft from complete back to pending within a
 * season, so the only way a league reaches this state is one that
 * generated a schedule and advanced weeks while its draft was still
 * pending or active, then started or continued the draft and reset it.
 * The fixtures below build exactly that: draft_status active alongside a
 * matchups row for the league's current season (#194 tracks closing that
 * reachability gap; it is not this ticket).
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-reset-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 9;
const LEAGUE_ID = 5;
const SEASON = 2026;
const PRIOR_SEASON = 2025;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const LEAGUE_LOOKUP = /^SELECT "id", "current_season" FROM "leagues" WHERE "id" = \$1 AND .* AND "draft_status" = 'active' FOR UPDATE$/;

const doReset = () => request(app)
  .post(`/api/draft/league/${LEAGUE_ID}/reset`)
  .set('Authorization', authed());

// `finalSeasons` maps a season number to whether a final matchup exists for
// it, so the matchups handler answers from the season the reset actually
// asked about rather than a fixed canned response.
function resetPool(finalSeasons = {}) {
  return createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [LEAGUE_LOOKUP, () => ({ rows: [{ id: LEAGUE_ID, current_season: SEASON }] })],
    [select('matchups'), (text, params) => ({ rows: finalSeasons[params[1]] ? [{ exists: 1 }] : [] })],
    [remove('team_players'), () => ({ rows: [], rowCount: 0 })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 4 })],
    [remove('draft_picks'), () => ({ rows: [], rowCount: 0 })],
    [update('teams'), () => ({ rows: [], rowCount: 2 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('POST reset: a final matchup in the current season refuses with 409 and issues no DELETE', async (t) => {
  const fake = resetPool({ [SEASON]: true }).install(t);

  const res = await doReset();

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(
    res.body.error,
    'the draft cannot be reset because weeks of this season are already settled'
  );
  assert.ok(
    !fake.calls.some((c) => /^DELETE/.test(c.text)),
    `no delete was issued, saw: ${fake.calls.map((c) => c.text).join(' | ')}`
  );
  assert.ok(
    !fake.calls.some((c) => /^UPDATE/.test(c.text)),
    'no update was issued either'
  );
  fake.assertClean();
});

test('POST reset: no final matchups this season lets the reset proceed and clears the season lineup rows', async (t) => {
  const fake = resetPool({}).install(t);

  const res = await doReset();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.reset, true);
  const lineupDelete = fake.calls.find((c) => /^DELETE FROM "lineup_entries"/.test(c.text));
  assert.ok(lineupDelete, 'lineup_entries were deleted');
  assert.deepEqual(lineupDelete.params, [LEAGUE_ID, SEASON]);
  fake.assertClean();
});

test('POST reset: a final matchup only in a prior season does not block the reset (season-scoped, not league-scoped)', async (t) => {
  const fake = resetPool({ [PRIOR_SEASON]: true }).install(t);

  const res = await doReset();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.reset, true);
  const matchupsCall = fake.calls.find((c) => /FROM "matchups"/.test(c.text));
  assert.ok(matchupsCall, 'the reset checked matchups for a final week');
  assert.match(
    matchupsCall.text,
    /"season" = \$2/,
    'the check is scoped by season, not the league alone'
  );
  assert.deepEqual(
    matchupsCall.params,
    [LEAGUE_ID, SEASON],
    "checked this league's current season (2026), not the 2025 season the final matchup sits in"
  );
  fake.assertClean();
});
