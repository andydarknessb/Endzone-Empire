const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { createSocketHarness } = require('./helpers/socketHarness');
const { TEAM_IDENTITY_FIELDS } = require('../services/teamIdentity');
const {
  presencePayload,
  chatMessagePayload,
  joinAck,
  getDraftState,
} = require('../modules/draftSocket');
const lineupService = require('../services/lineup.service');

/**
 * The absence tripwire for the Draft-room and chat Socket.IO contraction
 * (#381, #115 child E). This is the socket sibling of
 * `leagueSharedPayloadShape.test.js` (#341, the REST half), built in the same
 * pattern and for the same reason, one channel over.
 *
 * CONTEXT.md's Team identity rule is that a surface shared with other managers
 * names a participant by Team (`teamId` / `teamName`) and never by their
 * account (`userId`, `username`, the raw `user_id` column, `owner_id`,
 * `owner`). The Draft room's four broadcasts and its join acknowledgement got
 * Team identity BESIDE those account fields in the EXPAND step (#112); the
 * account fields are removed from the socket payloads by:
 *
 *   #344 (child C) — the Draft / chat Socket.IO payloads pinned here.
 *
 * Before this file no test in `server/test` pinned the exact key set of any
 * socket payload (`teamIdentityContracts.test.js` asserts individual fields on
 * them, never the whole shape), so a removal could land with nothing proving
 * the field was gone and nothing catching it come back — the ordering
 * constraint #334 was split around.
 *
 * THE PAIR CHOREOGRAPHY (identical to the REST module's, read its header for
 * the full argument). Each payload that still carries an account field has a
 * PAIR of guards, and the pair is the mechanism:
 *
 *   1. A `todo` guard that asserts the key set the payload will carry AFTER
 *      #344. It fails today (the account field is still there), so it is
 *      marked `todo` naming #344: `node --test` runs it, prints the red diff,
 *      and still exits 0. #344 turns it into a live guard by deleting the
 *      `todo` marker.
 *
 *   2. A NORMAL (non-todo) guard that asserts the account field is STILL
 *      PRESENT today. This is the loud half. A `todo` guard alone can go inert
 *      silently: a failing todo and a passing todo both roll into "todo N,
 *      exit 0", so if #344 removed the field and FORGOT its marker, CI would
 *      stay green. The present-today guard closes that: the moment #344 removes
 *      the field this guard goes RED (a real failure, not a todo), which drags
 *      the author into THIS file to flip the paired todo.
 *
 * `joinAck` is already Team-only, so it ships as a SINGLE live guard (no todo,
 * no present-today pair): it pins that win against the sibling removal.
 *
 * THE BROADCAST-vs-ACK CHANNEL RULE (the teamIdentity module docstring). A
 * broadcast reaches the whole league room, so `viewerTeamId` and
 * `isCommissioner` — facts about ONE viewer — cannot ride on `draft:presence`,
 * `chat:message`, `draft:picked` or `draft:state`. They ride only on the
 * per-viewer `joinAck`. So every broadcast here is guarded to FORBID both, and
 * the ack is guarded to REQUIRE both.
 *
 * TWO CAVEATS this file narrows itself on:
 *
 *   - getDraftState returns its `teams` rows VERBATIM from the SELECT (no
 *     serializer allowlist narrows them), so an exact-key-set guard driven by a
 *     fixture can only ever describe the fixture. Its present-today guard is
 *     therefore pinned to the SQL TEXT (that the projection still selects
 *     `owner_id` and `AS "owner"`), not only to the fixture row — so #344
 *     narrowing the SELECT turns the loud guard red for real. When #344 narrows
 *     it, update the fixture row here to mirror the narrowed SELECT so the
 *     flipped todo describes the true shape. (chat REST history is the same
 *     verbatim case in the REST module.)
 *
 *   - `draft:picked` has NO builder: it is assembled inline at two emit sites
 *     with DIFFERENT `by` shapes — the pick handler's `by: { userId, username }`
 *     (pinned here, captured off the real room emitter through the socket
 *     harness) and autopick.service's `by: { userId, username, auto }` (not
 *     captured here; #344 must remove account identity from BOTH). The pinned
 *     shape assumes #344 DROPS `by` (the picker is already named at the root by
 *     Team via `teamId` / `teamName`, so `by` is redundant account identity).
 *     If #344 instead keeps a Team-only `by`, add `by` back to
 *     PICKED_ROOT_CLEAN and pin `picked.by` to TEAM_IDENTITY_FIELDS. Extracting
 *     a `draft:picked` builder is #344's call, not this ticket's.
 */

const [TEAM_ID, TEAM_NAME] = TEAM_IDENTITY_FIELDS; // 'teamId', 'teamName'

const LEAGUE_ID = 1;
const VIEWER = { userId: 42, username: 'u42', teamId: 11, teamName: 'Gridiron Ghosts' };
const OTHER = { userId: 43, username: 'u43', teamId: 12, teamName: 'Sunday Scaries' };

/** The two per-viewer facts that may ride on the ack and never on a broadcast. */
const VIEWER_RELATIVE = ['viewerTeamId', 'isCommissioner'];

/** The exact-key-set assertion (#344's post-removal contract for the object). */
const assertExactKeys = (obj, cleanKeys) =>
  assert.deepEqual(Object.keys(obj).sort(), [...cleanKeys].sort());

/** The present-today assertion: the account field(s) #344 removes are here NOW. */
function assertStillPresent(obj, fields) {
  for (const field of fields) {
    assert.equal(field in obj, true, `${field} is still on the wire today; #344 removing it must turn this guard red`);
  }
}

/** A key that must never ride on this broadcast (today or after #344). */
function assertForbidden(obj, fields) {
  for (const field of fields) {
    assert.equal(field in obj, false, `${field} must not ride on this broadcast`);
  }
}

// ============================================================ draft:presence
// presencePayload(user, team) -> { userId, username, teamId, teamName, joined }

const presence = () => presencePayload(
  { id: VIEWER.userId, username: VIEWER.username },
  { id: VIEWER.teamId, name: VIEWER.teamName }
);
const PRESENCE_CLEAN = [TEAM_ID, TEAM_NAME, 'joined'];
const PRESENCE_ACCOUNT = ['userId', 'username'];

test('draft:presence STILL carries userId / username today, and never a viewer-relative field', () => {
  assertStillPresent(presence(), PRESENCE_ACCOUNT);
  assertForbidden(presence(), VIEWER_RELATIVE);
});

test('draft:presence is the joining manager\'s Team and nothing about their account', { todo: '#344 removes draft:presence userId / username' }, () => {
  assertExactKeys(presence(), PRESENCE_CLEAN);
});

// =============================================================== chat:message
// chatMessagePayload(...) ->
//   { id, leagueId, userId, username, teamId, teamName, message, created_at }

const chat = () => chatMessagePayload({
  id: 5,
  leagueId: LEAGUE_ID,
  user: { id: OTHER.userId, username: OTHER.username },
  team: { id: OTHER.teamId, name: OTHER.teamName },
  message: 'good luck everyone',
  createdAt: '2026-09-01T00:00:00.000Z',
});
const CHAT_CLEAN = ['created_at', 'id', 'leagueId', 'message', TEAM_ID, TEAM_NAME];
const CHAT_ACCOUNT = ['userId', 'username'];
// `user_id` is the raw chat_messages column; it is mapped to `userId` today and
// must never leak onto the broadcast in either spelling.
const CHAT_FORBIDDEN_ALWAYS = ['user_id', ...VIEWER_RELATIVE];

test('chat:message STILL carries userId / username today, and never user_id or a viewer-relative field', () => {
  assertStillPresent(chat(), CHAT_ACCOUNT);
  assertForbidden(chat(), CHAT_FORBIDDEN_ALWAYS);
});

test('chat:message is the message attributed by Team, not by the author account', { todo: '#344 removes chat:message userId / username' }, () => {
  assertExactKeys(chat(), CHAT_CLEAN);
});

// =============================================================== draft:picked
// The pick handler emits `{ ...outcome, by: { userId, username } }` inline. It
// has no builder, so the shape is captured off the REAL room emitter: connect,
// join the league room, make a pick, and read what the room received.

const harness = createSocketHarness({ secret: 'socket-payload-shape-secret' });

// A league mid-draft with the viewer's Team on the clock (current_pick 0,
// 0-based; the viewer holds draft_position 1). Enough of the row for
// draftPlayer to run one pick to completion without finishing the draft.
const PICKED_LEAGUE = {
  id: LEAGUE_ID,
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pickem_only: false,
  roster_limit: 3,
  ir_slots: 1,
  draft_rounds: 2,
  position_caps: {},
  current_pick: 0,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  waiver_period_hours: 24,
};

// One fake answers BOTH the league:join membership reads (viewerContext) and
// the whole draftPlayer transaction. The two collide under the shape matchers,
// so the narrow reads go FIRST (the fakePool header's "overrides before
// defaults"): lookupTeam's `SELECT "id", "name" FROM "teams"` ahead of
// draftPlayer's wider teams read, and isLeagueCommissioner's `SELECT 1 FROM
// "leagues"` ahead of draftPlayer's `SELECT * FROM "leagues"`.
function pickWorld(t) {
  const fake = createFakePool([
    [/^SELECT "id", "name" FROM "teams"/, (text, [leagueId, userId]) => ({
      rows: leagueId === LEAGUE_ID && userId === VIEWER.userId
        ? [{ id: VIEWER.teamId, name: VIEWER.teamName }]
        : [],
    })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [] })],
    [select('leagues'), () => ({ rows: [{ ...PICKED_LEAGUE }] })],
    [select('teams'), () => ({ rows: [
      { id: VIEWER.teamId, name: VIEWER.teamName, owner_id: VIEWER.userId, draft_position: 1, autodraft: false, locked: false },
      { id: OTHER.teamId, name: OTHER.teamName, owner_id: OTHER.userId, draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  return fake;
}

// Drive a real pick and return the `draft:picked` object the room received.
async function capturePicked(t) {
  const fake = pickWorld(t);
  const client = await harness.connectAs(VIEWER, t);
  // league:join puts this socket in `league:${id}`, so the room broadcast
  // reaches it (the handler uses `io.to(room)`, which includes the sender).
  const ack = await harness.emit(client, 'league:join', { leagueId: LEAGUE_ID });
  assert.deepEqual(ack, { ok: true, viewerTeamId: VIEWER.teamId, isCommissioner: false }, JSON.stringify(ack));
  const sawPicked = harness.nextEvent(client, 'draft:picked');
  await harness.emit(client, 'draft:pick', { leagueId: LEAGUE_ID, playerId: 500 });
  const picked = await sawPicked;
  fake.assertClean();
  return picked;
}

// draftPlayer's outcome is `{ leagueId, teamId, teamName, player, pickNumber,
// nextTeamId, draftComplete, pickDeadlineAt }`; the handler adds `by`.
const PICKED_ROOT_CLEAN = [
  'draftComplete', 'leagueId', 'nextTeamId', 'pickDeadlineAt', 'pickNumber', 'player', TEAM_ID, TEAM_NAME,
];

test('draft:picked STILL carries a by:{userId,username} account object today, and no viewer-relative field', async (t) => {
  const picked = await capturePicked(t);
  assert.equal('by' in picked, true, 'draft:picked still carries a by object today');
  assertStillPresent(picked.by, ['userId', 'username']);
  assert.equal(picked.by.userId, VIEWER.userId);
  assert.equal(picked.by.username, VIEWER.username);
  assertForbidden(picked, VIEWER_RELATIVE);
});

test('draft:picked names the picker by Team at the root, with no by account object', { todo: '#344 removes draft:picked by:{userId,username} (the picker is already named at the root by Team via teamId/teamName). If #344 keeps a Team-only by instead, add by to PICKED_ROOT_CLEAN and pin picked.by to TEAM_IDENTITY_FIELDS.' }, async (t) => {
  assertExactKeys(await capturePicked(t), PICKED_ROOT_CLEAN);
});

// ================================================================ draft:state
// getDraftState(leagueId) -> { league, teams, picks, onTheClock }. Ten emit
// sites (socket join, six draft.router lifecycle routes, autopick, draftStart)
// all broadcast this one builder, so pinning it pins them all.

const DRAFT_STATE_LEAGUE = {
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  draft_status: 'active',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  current_pick: 0,
  invite_code: 'invite',
};

// A `teams` row exactly as getDraftState's SELECT projects it today: the team's
// own draft columns, Team identity, and the two account fields #344 removes.
// The row passes through getDraftState verbatim, so it must MIRROR the SELECT
// for the exact-key-set guard to describe the real shape (see header caveat).
const draftStateTeamRow = ({ userId, teamId, teamName }, draftPosition) => ({
  id: teamId,
  name: teamName,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  owner_id: userId, // #344 removes (from the SELECT)
  teamId,
  teamName,
  owner: `u${userId}`, // #344 removes (from the SELECT)
});

function draftStateFake(t) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...DRAFT_STATE_LEAGUE }] })],
    [/FROM "teams" JOIN "users"/, () => ({
      rows: [draftStateTeamRow(VIEWER, 1), draftStateTeamRow(OTHER, 2)],
    })],
    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: [] })],
  ]).install(t);
}

const STATE_ROOT_CLEAN = ['league', 'onTheClock', 'picks', 'teams'];
const STATE_TEAM_CLEAN = [
  'autodraft', 'draft_position', 'draft_ready', 'id', 'name', TEAM_ID, TEAM_NAME,
];
const STATE_TEAM_ACCOUNT = ['owner_id', 'owner'];

// GREEN root pin: the snapshot root carries no account field and no
// viewer-relative field, and stays that shape across #344.
test('draft:state root is league/teams/picks/onTheClock, and never a viewer-relative field', async (t) => {
  draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  assertExactKeys(state, STATE_ROOT_CLEAN);
  assertForbidden(state, VIEWER_RELATIVE);
});

test('draft:state teams[] entry STILL carries owner_id / owner today (in the row and the SELECT)', async (t) => {
  const fake = draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  for (const team of state.teams) assertStillPresent(team, STATE_TEAM_ACCOUNT);
  // Pinned to the SELECT, not only the fixture: the rows pass through verbatim,
  // so this is what actually turns red when #344 narrows the projection.
  const [teamsQuery] = fake.matching(/FROM "teams" JOIN "users"/);
  assert.match(teamsQuery.text, /"teams"\."owner_id"/, 'the SELECT still projects owner_id');
  assert.match(teamsQuery.text, /AS "owner"/, 'the SELECT still projects the owner username');
});

test('draft:state teams[] entry carries no viewer-relative field', async (t) => {
  draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  for (const team of state.teams) assertForbidden(team, VIEWER_RELATIVE);
});

test('draft:state teams[] entry is Team identity and draft attributes, not the manager account', { todo: '#344 removes draft:state teams[].owner_id / owner from the getDraftState SELECT; update draftStateTeamRow here to mirror the narrowed SELECT when it does' }, async (t) => {
  draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  for (const team of state.teams) assertExactKeys(team, STATE_TEAM_CLEAN);
});

// ====================================================== league:join / draft:join ack
// joinAck({ viewerTeam, isCommissioner }) -> { ok, viewerTeamId, isCommissioner }.
// Already Team-only: one live guard, no pair. Both joins answer this one shape.

const ACK_CLEAN = ['isCommissioner', 'ok', 'viewerTeamId'];

test('the league:join / draft:join ack is Team identity plus the two viewer-relative facts, and no account (already contracted)', () => {
  const ack = joinAck({ viewerTeam: { id: VIEWER.teamId, name: VIEWER.teamName }, isCommissioner: true });
  assertExactKeys(ack, ACK_CLEAN);
  // The mirror of the broadcast rule: viewerTeamId and isCommissioner are
  // REQUIRED here, because the ack is the one per-viewer channel they may ride.
  for (const field of VIEWER_RELATIVE) {
    assert.equal(field in ack, true, `${field} is required on the per-viewer ack`);
  }
  assertForbidden(ack, ['userId', 'username', 'user_id', 'owner_id', 'owner']);
});
