const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { createSocketHarness } = require('./helpers/socketHarness');
const { getIo, setIo } = require('../modules/io');
const { TEAM_IDENTITY_FIELDS } = require('../services/teamIdentity');
const {
  presencePayload,
  chatMessagePayload,
  joinAck,
  getDraftState,
} = require('../modules/draftSocket');
const draftService = require('../services/draft.service');
const { autoPick } = require('../services/autopick.service');
const { installAutopickPool, AUTOPICK_TEAM } = require('./helpers/autopickFixtures');
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
 *   #344 (child C) — the Draft / chat Socket.IO payloads pinned here. DONE:
 *                    every guard below is a LIVE assertion of the post-removal
 *                    shape.
 *
 * How this file came to be live: #381 shipped each socket guard as a PAIR — a
 * `todo` guard asserting the post-#344 key set (red, exit 0) and a NORMAL guard
 * asserting the account field was STILL PRESENT (so a removal that forgot to
 * flip the todo would go loudly red instead of silently inert, the way a bare
 * `todo` can). #344 removed each field, deleted its present-today guard, and
 * turned its `todo` guard into the live exact-key-set assertion you see below.
 * `joinAck` was already Team-only, so it shipped as a single live guard with no
 * pair. The pairs are spent; what remains is the standing contract.
 *
 * THE BROADCAST-vs-ACK CHANNEL RULE (the teamIdentity module docstring). A
 * broadcast reaches the whole league room, so `viewerTeamId` and
 * `isCommissioner` — facts about ONE viewer — cannot ride on `draft:presence`,
 * `chat:message`, `draft:picked` or `draft:state`. They ride only on the
 * per-viewer `joinAck`. So every broadcast here is guarded to FORBID both, and
 * the ack is guarded to REQUIRE both.
 *
 * TWO THINGS this file narrows itself on:
 *
 *   - getDraftState returns its `teams` rows VERBATIM from the SELECT (no
 *     serializer allowlist narrows them), so an exact-key-set guard driven by a
 *     fixture can only ever describe the fixture. The account fields left the
 *     PROJECTION, so the live guard here also asserts the SQL TEXT no longer
 *     selects `owner_id` or `AS "owner"` (and no longer joins `users`), which
 *     is what actually keeps the removal in place; the fixture row mirrors the
 *     narrowed SELECT so the exact-key guard describes the true shape. (chat
 *     REST history is the same verbatim case in the REST module.)
 *
 *   - `draft:picked` has NO builder: it is assembled inline at TWO emit sites,
 *     and BOTH are pinned here so a re-added account id at either site goes red:
 *       * the pick handler (captured off the real room emitter through the
 *         socket harness); and
 *       * autopick.service (captured off a fake `io` singleton, since autopick
 *         emits through getIo()).
 *     #344 DROPPED the old `by` account object at both (the picker is already
 *     named at the root by Team via `teamId` / `teamName`, so `by` was
 *     redundant account identity) and, in its place, put a single non-identity
 *     field the room still needs — `auto`, whether the pick was an autopick —
 *     at the root of both. So both share PICKED_ROOT_CLEAN, which carries
 *     `auto` (false at the pick handler, true at autopick) and no `by`. A
 *     builder was considered and rejected: the only cheap way to share it from
 *     autopick is a lazy require of this heavy module inside the emit path,
 *     which the autopick latency budget (draftAutopickClock.integration) does
 *     not allow. This shared key set is what keeps the two sites in lockstep.
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

/** A key that must never appear on this payload. */
function assertForbidden(obj, fields) {
  for (const field of fields) {
    assert.equal(field in obj, false, `${field} must not appear on this payload`);
  }
}

// ============================================================ draft:presence
// presencePayload(user, team) -> { teamId, teamName, joined }
// (the `user` argument is no longer read; the signature is kept, see the module)

const presence = () => presencePayload(
  { id: VIEWER.userId, username: VIEWER.username },
  { id: VIEWER.teamId, name: VIEWER.teamName }
);
const PRESENCE_CLEAN = [TEAM_ID, TEAM_NAME, 'joined'];

test('draft:presence never carries a viewer-relative field', () => {
  assertForbidden(presence(), VIEWER_RELATIVE);
});

test('draft:presence is the joining manager\'s Team and nothing about their account', () => {
  assertExactKeys(presence(), PRESENCE_CLEAN);
});

// =============================================================== chat:message
// chatMessagePayload(...) ->
//   { id, leagueId, teamId, teamName, message, created_at }

const chat = () => chatMessagePayload({
  id: 5,
  leagueId: LEAGUE_ID,
  user: { id: OTHER.userId, username: OTHER.username },
  team: { id: OTHER.teamId, name: OTHER.teamName },
  message: 'good luck everyone',
  createdAt: '2026-09-01T00:00:00.000Z',
});
const CHAT_CLEAN = ['created_at', 'id', 'leagueId', 'message', TEAM_ID, TEAM_NAME];
// `user_id` is the raw chat_messages column; it must never leak onto the
// broadcast in either the raw or the `userId` spelling.
const CHAT_FORBIDDEN_ALWAYS = ['user_id', 'userId', 'username', ...VIEWER_RELATIVE];

test('chat:message never carries user_id or a viewer-relative field', () => {
  assertForbidden(chat(), CHAT_FORBIDDEN_ALWAYS);
});

test('chat:message is the message attributed by Team, not by the author account', () => {
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
// nextTeamId, draftComplete, pickDeadlineAt }`. #344 dropped the account `by`
// object (the picker is already named at the root by Team) and, in its place,
// added a single non-identity fact the room still needs: `auto`, whether the
// pick was made by autodraft. Both emit sites carry it (false at the pick
// handler, true at autopick), so both share this key set.
const PICKED_ROOT_CLEAN = [
  'auto', 'draftComplete', 'leagueId', 'nextTeamId', 'pickDeadlineAt', 'pickNumber', 'player', TEAM_ID, TEAM_NAME,
];

test('draft:picked names the picker by Team at the root, with no by account object and no viewer-relative field', async (t) => {
  const picked = await capturePicked(t);
  assert.equal('by' in picked, false, 'the account by object is gone from the broadcast');
  assertExactKeys(picked, PICKED_ROOT_CLEAN);
  assert.equal(picked.auto, false, 'a manual pick is not an autopick');
});

// The SECOND draft:picked emit site (autopick.service.js), pinned so #344
// cannot strip `by` from the pick handler, flip that todo green, and leave
// autopick still broadcasting `by.userId` to the whole room. autopick emits
// through the getIo() singleton and reaches draftPlayer by namespace, so both
// are captured with a fake io and a mocked draftPlayer (its outcome shape is
// the pick handler's, already pinned above; here it is the same 8-key outcome).
async function captureAutopickPicked(t) {
  installAutopickPool(t, {
    candidates: [{ id: 500, name: 'Pick Me', adp: '1.0', queue_rank: null, last_season_points: null }],
  });
  t.mock.method(draftService, 'draftPlayer', async () => ({
    leagueId: LEAGUE_ID,
    teamId: AUTOPICK_TEAM.id,
    teamName: 'The Autodrafters',
    player: { id: 500, name: 'Pick Me', position: 'RB' },
    pickNumber: 1,
    nextTeamId: null,
    draftComplete: false,
    pickDeadlineAt: null,
  }));
  const emitted = [];
  const priorIo = getIo();
  setIo({ to: () => ({ emit: (event, payload) => emitted.push({ event, payload }) }) });
  t.after(() => setIo(priorIo));
  await autoPick({ leagueId: LEAGUE_ID });
  const picked = emitted.find((e) => e.event === 'draft:picked');
  assert.ok(picked, 'autoPick emitted a draft:picked');
  return picked.payload;
}

test('draft:picked (autopick emit site) names the picker by Team at the root, with no by account object, and marks the pick auto', async (t) => {
  const picked = await captureAutopickPicked(t);
  // The old leak here was by.userId = onTheClock.owner_id, a real account id
  // broadcast to the room; the whole `by` object is gone (#344). This second
  // emit site stays in lockstep with the pick handler, sharing PICKED_ROOT_CLEAN.
  assert.equal('by' in picked, false, 'the account by object is gone from the autopick broadcast too');
  assertExactKeys(picked, PICKED_ROOT_CLEAN);
  assert.equal(picked.auto, true, 'an autopick is marked auto');
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

// A `teams` row exactly as getDraftState's SELECT projects it now that #344
// has narrowed it: the team's own draft columns and Team identity, and no
// account fields. The row passes through getDraftState verbatim, so it MIRRORS
// the narrowed SELECT for the exact-key-set guard to describe the real shape
// (see header caveat).
const draftStateTeamRow = ({ teamId, teamName }, draftPosition) => ({
  id: teamId,
  name: teamName,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  teamId,
  teamName,
});

function draftStateFake(t) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...DRAFT_STATE_LEAGUE }] })],
    [/FROM "teams"\s+WHERE/, () => ({
      rows: [draftStateTeamRow(VIEWER, 1), draftStateTeamRow(OTHER, 2)],
    })],
    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: [] })],
  ]).install(t);
}

const STATE_ROOT_CLEAN = ['league', 'onTheClock', 'picks', 'teams'];
const STATE_TEAM_CLEAN = [
  'autodraft', 'draft_position', 'draft_ready', 'id', 'name', TEAM_ID, TEAM_NAME,
];

// GREEN root pin: the snapshot root carries no account field and no
// viewer-relative field.
test('draft:state root is league/teams/picks/onTheClock, and never a viewer-relative field', async (t) => {
  draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  assertExactKeys(state, STATE_ROOT_CLEAN);
  assertForbidden(state, VIEWER_RELATIVE);
});

test('draft:state teams[] entry no longer projects owner_id / owner from the SELECT', async (t) => {
  const fake = draftStateFake(t);
  await getDraftState(LEAGUE_ID);
  // Pinned to the SELECT, not only the fixture: the rows pass through verbatim,
  // so the projection is what #344 narrowed and what must stay narrowed.
  const [teamsQuery] = fake.matching(/FROM "teams"\s+WHERE/);
  assert.doesNotMatch(teamsQuery.text, /"teams"\."owner_id"/, 'the SELECT no longer projects owner_id');
  assert.doesNotMatch(teamsQuery.text, /AS "owner"/, 'the SELECT no longer projects the owner username');
  assert.doesNotMatch(teamsQuery.text, /JOIN "users"/, 'the users join that fed owner is gone');
});

test('draft:state teams[] entry carries no viewer-relative field', async (t) => {
  draftStateFake(t);
  const state = await getDraftState(LEAGUE_ID);
  for (const team of state.teams) assertForbidden(team, VIEWER_RELATIVE);
});

test('draft:state teams[] entry is Team identity and draft attributes, not the manager account', async (t) => {
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
