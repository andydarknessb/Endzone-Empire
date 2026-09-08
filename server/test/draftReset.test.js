const { test } = require('node:test');
const assert = require('node:assert/strict');
// The reset route refreshes the board and appends the reset entry through the
// one Draft room adapter (#745), which throws with no transport; register a
// recording broadcast per test.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, remove, update } = require('./helpers/fakePool');

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
const ACTOR_TEAM = { id: 30, name: 'Commish FC' };

function resetPool(finalSeasons = {}, wipeTeamIds = [30, 31]) {
  return createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [LEAGUE_LOOKUP, () => ({ rows: [{ id: LEAGUE_ID, current_season: SEASON }] })],
    [select('matchups'), (text, params) => ({ rows: finalSeasons[params[1]] ? [{ exists: 1 }] : [] })],
    // The teams whose rosters the wipe reaches, and the #965 write gate's own
    // League and Team reads, League then Team. The gate is asked once per team
    // rather than once per player, because a release's gate inputs are the
    // League and the Team and nothing on that side accumulates. Its own
    // explicit column lists mean it needs its own handlers: the select('teams')
    // shape matcher below is blind to a select list and would answer the gate's
    // Team read with the acting commissioner's Team row.
    [/^SELECT "id" FROM "teams" WHERE "league_id" = \$1 ORDER BY "id"/, () => ({
      rows: wipeTeamIds.map((id) => ({ id })),
    })],
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      // Frozen and locked on purpose: this route bypasses both, and a fixture
      // that left them clear could not tell a bypass from a lucky pass.
      rows: [{ id: LEAGUE_ID, transactions_locked: true }],
    })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/, (text, params) => ({
      rows: [{ id: params[0], locked: true }],
    })],
    [remove('team_players'), () => ({ rows: [], rowCount: 0 })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 4 })],
    [remove('draft_picks'), () => ({ rows: [], rowCount: 0 })],
    [update('teams'), () => ({ rows: [], rowCount: 2 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    // lookupTeam (the acting commissioner's Team) and the reset lifecycle append
    // (#437). The append is append-only: the reset DELETEs picks/rosters, never
    // draft_activity, so earlier Pick and lifecycle entries survive it.
    [select('teams'), () => ({ rows: [ACTOR_TEAM] })],
    [insert('draft_activity'), () => ({ rows: [{ id: 8, feed_seq: '40', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
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
  // #274: counts rather than booleans. The coverage is the same verb-level
  // sweep, but the failure now reads "3 !== 0" instead of "false !== true",
  // which says how far past the guard the reset actually got.
  assert.equal(
    fake.matching(/^DELETE/).length,
    0,
    `no delete was issued, saw: ${fake.calls.map((c) => c.text).join(' | ')}`
  );
  assert.equal(fake.matching(/^UPDATE/).length, 0, 'no update was issued either');
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

test('POST reset: appends a reset lifecycle activity with the commissioner Team, and deletes no draft_activity (#437 AC3)', async (t) => {
  const fake = resetPool({}).install(t);

  const res = await doReset();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1, 'exactly one reset activity appended');
  assert.deepEqual(appended[0].params, [LEAGUE_ID, 'reset', ACTOR_TEAM.id, ACTOR_TEAM.name]);
  // Append-only: the reset wipes picks and rosters but never the activity feed,
  // so earlier Pick and lifecycle entries are not erased (#437 AC3).
  assert.equal(fake.matching(/^DELETE FROM "draft_activity"/).length, 0, 'reset must not delete Draft activity');
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

// --- the reset's roster wipe runs through the write gate (#965) --------------

test('POST reset: the gate is asked once per team, before the wipe, and a frozen league does not stop it', async (t) => {
  // The ruling (#965): a commissioner freeze does not govern a draft-phase
  // roster write. This route already refuses unless the draft is ACTIVE, and a
  // reset must reach a locked team's roster too, so FREEZE and TEAM_LOCK are
  // both bypassed. resetPool seeds the league FROZEN and every team LOCKED, so
  // this succeeding is the proof the bypass set is what carries it - a fixture
  // with both clear could not tell a bypass from a lucky pass.
  const fake = resetPool({}, [30, 31, 32]).install(t);

  const res = await doReset();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const gateLeagueReads = fake.calls.filter((c) => /^SELECT "id", "transactions_locked".*FOR UPDATE/.test(c.text));
  const gateTeamReads = fake.calls.filter((c) => /^SELECT "id", "locked" FROM "teams".*FOR UPDATE/.test(c.text));
  assert.equal(gateLeagueReads.length, 3, 'one gate call per team in the league');
  assert.deepEqual(gateTeamReads.map((c) => c.params[0]), [30, 31, 32], 'each team answered for itself');

  // Before the write it guards, not after. A gate that ran below the DELETE
  // would be a report, not a gate.
  const lastGateAt = fake.calls.map((c) => c.text).lastIndexOf(gateTeamReads[2].text);
  const wipeAt = fake.calls.findIndex((c) => /^DELETE FROM "team_players"/.test(c.text));
  assert.ok(wipeAt >= 0, 'the wipe ran');
  assert.ok(lastGateAt < wipeAt, 'every gate call precedes the wipe');
  fake.assertClean();
});

test('POST reset: a refused reset never reaches the gate, because it never reaches a write', async (t) => {
  // The settled-week refusal comes first (#192): nothing is gated because
  // nothing is written.
  const fake = resetPool({ [SEASON]: true }).install(t);

  const res = await doReset();
  assert.equal(res.status, 409);
  assert.equal(
    fake.calls.filter((c) => /^SELECT "id", "transactions_locked".*FOR UPDATE/.test(c.text)).length,
    0,
    'the gate is not consulted for a write that never happens'
  );
  fake.assertClean();
});
