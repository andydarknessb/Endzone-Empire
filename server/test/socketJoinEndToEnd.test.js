const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { joinAck } = require('../modules/draftSocket');
const {
  leagueWorld,
  LEAGUE_ID,
  OWNER,
  CO_COMMISSIONER,
  MEMBER,
  OUTSIDER,
} = require('./helpers/socketJoinWorld');

/**
 * #231: what `draft:join` and `league:join` ACTUALLY acknowledge, proven
 * through a real socket.io server and a real socket.io-client.
 *
 * Why this suite exists when `draftJoinCommissioner` already covers the ack.
 * That suite calls `viewerContext` and `joinAck` directly, so it pins the
 * shape of the ack and the role rules behind it - but nothing ran the
 * handler BETWEEN them. Triage measured the gap: changing the handler's
 * `ack(joinAck(viewer))` to `ack(joinAck(viewer.viewerTeam))` left both
 * server suites that load `draftSocket` at 20 pass, 0 fail, and the client
 * suites fake the ack payload and cannot see it either. A viewer-passthrough
 * regression in the wiring was invisible everywhere. It is visible here.
 *
 * The two suites are deliberately complementary and must agree: this one
 * asserts the payload the handler emits, `draftJoinCommissioner` asserts the
 * payload `joinAck` builds. `joinAck` stays the single shape for both joins,
 * so the wiring test and the shape test cannot drift.
 *
 * REFUSALS ARE ASSERTED BY THEIR EXACT STRING, never by truthiness. Both
 * handlers catch and ack a generic 'failed to join ...', so a gap in the
 * fixture looks exactly like a refusal to a test that only checks that an
 * error came back. See the header of helpers/socketJoinWorld.js.
 */

const harness = createSocketHarness({ secret: 'socket-join-end-to-end-secret' });

/** The world every test runs against: one co-commissioner, so the owner is
 *  never the only commissioner and an owner-only comparison cannot pass. */
const world = (t) => leagueWorld({ coCommissioners: [CO_COMMISSIONER.userId] }).install(t);

const JOIN_EVENTS = ['draft:join', 'league:join'];

const ADMITTED = [
  { manager: OWNER, role: 'the league owner', isCommissioner: true },
  { manager: CO_COMMISSIONER, role: 'a co-commissioner', isCommissioner: true },
  { manager: MEMBER, role: 'a plain member', isCommissioner: false },
];

// ---------------------------------------------------------------------------
// The four viewers, through both joins.
// ---------------------------------------------------------------------------

for (const event of JOIN_EVENTS) {
  for (const { manager, role, isCommissioner } of ADMITTED) {
    test(`${event} acknowledges ${role} with their own Team and isCommissioner ${isCommissioner}`, async (t) => {
      world(t);
      const client = await harness.connectAs(manager, t);

      const ack = await harness.emit(client, event, { leagueId: LEAGUE_ID });

      assert.deepEqual(ack, {
        ok: true,
        viewerTeamId: manager.teamId,
        isCommissioner,
      });
    });
  }

  test(`${event} refuses a manager who holds no Team, and tells them nothing about the league`, async (t) => {
    const fake = world(t);
    const client = await harness.connectAs(OUTSIDER, t);

    const ack = await harness.emit(client, event, { leagueId: LEAGUE_ID });

    // The EXACT refusal, not merely "an error": 'failed to join ...' is what
    // an unanswered query would produce, and it must not be able to pass here.
    // deepEqual (not a property check) is also what proves no viewerTeamId or
    // isCommissioner leaked to a non-member.
    assert.deepEqual(ack, { error: 'you are not in this league' });
    // Membership IS the Team (ADR 0002), so a non-member is never asked the
    // role question at all.
    assert.equal(fake.matching(/FROM "leagues"/).length, 0, 'no role question for a non-member');
  });
}

// ---------------------------------------------------------------------------
// The handshake, through the real middleware.
// ---------------------------------------------------------------------------

test('the payload on the wire is the one joinAck builds, not merely the same shape', async (t) => {
  // #231 Key interfaces: "the harness asserts the emitted payload equals what
  // joinAck builds, so the shape test and the wiring test agree." Exactly ONE
  // test does it this way. If every case above compared against joinAck(...)
  // they would all be tautologies - the handler calls joinAck too, so both
  // sides would move together and no shape change could ever fail them. The
  // literals above pin the wire; this pins the two to each other.
  world(t);
  const client = await harness.connectAs(MEMBER, t);

  const ack = await harness.emit(client, 'draft:join', { leagueId: LEAGUE_ID });

  assert.deepEqual(ack, joinAck({
    viewerTeam: { id: MEMBER.teamId, name: MEMBER.teamName },
    isCommissioner: false,
  }));
});

test('the handshake also succeeds on the default transports, not just websocket', async (t) => {
  // The suite pins `websocket` for speed and determinism, which would skip
  // the polling handshake entirely. The real browser client opens on polling
  // and upgrades, and the server's CORS resolves to `origin: false`, so this
  // keeps the assumption the rest of the suite is built on under test rather
  // than in a smoke-check someone ran once.
  world(t);
  const client = await harness.connectAs(OWNER, t, { transports: ['polling', 'websocket'] });

  const ack = await harness.emit(client, 'draft:join', { leagueId: LEAGUE_ID });

  assert.deepEqual(ack, { ok: true, viewerTeamId: OWNER.teamId, isCommissioner: true });
});

test('a connection with no token is refused by the socket middleware', async (t) => {
  world(t);

  const outcome = await harness.connectExpectingRefusal({}, t);

  assert.equal(outcome, 'unauthorized');
});

test('a connection with a token this server did not sign is refused', async (t) => {
  world(t);

  // Signed with the right algorithm and a plausible payload, wrong secret.
  const foreign = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    + '.eyJzdWIiOjcsInVzZXJuYW1lIjoiY29tbWlzaCIsImV4cCI6NDA3MDkwODgwMH0'
    + '.this-signature-was-not-made-with-our-secret';

  const outcome = await harness.connectExpectingRefusal({ auth: { token: foreign } }, t);

  assert.equal(outcome, 'unauthorized');
});

// ---------------------------------------------------------------------------
// Validation, before anything touches the database.
// ---------------------------------------------------------------------------

for (const [label, leagueId] of [
  ['a string', String(LEAGUE_ID)],
  ['a fractional number', 1.5],
  ['missing', undefined],
]) {
  test(`draft:join with a leagueId that is ${label} is refused as invalid`, async (t) => {
    const fake = world(t);
    const client = await harness.connectAs(OWNER, t);

    const ack = await harness.emit(client, 'draft:join', { leagueId });

    assert.deepEqual(ack, { error: 'leagueId (integer) required' });
    assert.equal(fake.calls.length, 0, 'an invalid leagueId never reaches the database');
  });
}

// ---------------------------------------------------------------------------
// Evidence about the QUESTION, not just the answer, and about ordering.
// ---------------------------------------------------------------------------

test('the commissioner question a real draft:join asks is the co-commissioner-aware one', async (t) => {
  // The answers above come from a JS Set that never runs the SQL, so a call
  // site that asked the wrong question and got a coincidentally right answer
  // would still pass them. The statement itself is read back here.
  const fake = world(t);
  const client = await harness.connectAs(CO_COMMISSIONER, t);

  await harness.emit(client, 'draft:join', { leagueId: LEAGUE_ID });

  const [asked] = fake.matching(/^SELECT 1 FROM "leagues"/);
  assert.ok(asked, 'the join asks the league a commissioner question');
  assert.match(asked.text, /"league_commissioners"/);
  assert.deepEqual(asked.params, [LEAGUE_ID, CO_COMMISSIONER.userId]);
});

test('draft:join answers the ack before it sends the first draft:state', async (t) => {
  // The handler acks first on purpose: a client must know which Team is its
  // own, and whether it may act as commissioner, BEFORE it has any state to
  // apply either answer to (draftSocket.js, above the ack). Ordering between
  // an ack and an event is exactly what a direct call to joinAck cannot show.
  world(t);
  const client = await harness.connectAs(OWNER, t);

  // Both arrivals are recorded SYNCHRONOUSLY, at the moment the client
  // dispatches them. Recording the ack after `await` instead would resume on
  // a microtask, by which point a `draft:state` delivered in the same batch
  // has already run its listener, and a correct server would look wrong.
  const arrivals = [];
  let deliverState;
  const sawState = new Promise((resolve) => { deliverState = resolve; });
  client.once('draft:state', (state) => {
    arrivals.push('draft:state');
    deliverState(state);
  });
  const ack = await harness.emit(client, 'draft:join', { leagueId: LEAGUE_ID }, {
    onAck: () => arrivals.push('ack'),
  });
  const state = await sawState;

  assert.deepEqual(arrivals, ['ack', 'draft:state']);
  assert.equal(ack.viewerTeamId, OWNER.teamId);
  // The snapshot really was built (the three getDraftState reads were
  // answered), so the ordering above is not an artefact of a failed state read.
  assert.equal(state.league.id, LEAGUE_ID);
  assert.equal(state.teams.length, 3);
  assert.equal(state.onTheClock, null);
});

test('the draft:state snapshot never carries the league invite code', async (t) => {
  // getDraftState deletes it before broadcasting. This snapshot goes to the
  // whole room, so a regression here hands every member the join code.
  world(t);
  const client = await harness.connectAs(MEMBER, t);

  const sawState = harness.nextEvent(client, 'draft:state');
  await harness.emit(client, 'draft:join', { leagueId: LEAGUE_ID });
  const state = await sawState;

  assert.equal(state.league.invite_code, undefined);
});

test('league:join reads the viewer but never the draft snapshot', async (t) => {
  // The chat panel joins this way. It is the cheaper of the two joins by
  // design, and the ack is its only route to knowing which Team is its own.
  const fake = world(t);
  const client = await harness.connectAs(MEMBER, t);

  await harness.emit(client, 'league:join', { leagueId: LEAGUE_ID });

  assert.equal(fake.matching(/FROM "draft_picks"/).length, 0);
  assert.equal(fake.matching(/^SELECT \* FROM "leagues"/).length, 0);
});
