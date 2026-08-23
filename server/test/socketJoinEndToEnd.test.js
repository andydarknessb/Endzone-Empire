const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { createFakePool, select } = require('./helpers/fakePool');
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
 * The two suites are complementary: this one asserts the payload the handler
 * emits, `draftJoinCommissioner` asserts the payload `joinAck` builds. Be
 * precise about which half of that is enforced, because the halves are not
 * alike:
 *
 * - ENFORCED. One test below compares an emitted ack against `joinAck(...)`
 *   directly, so the handler's wire payload and `joinAck`'s output cannot
 *   drift apart without a failure. Only one test does it; the rest pin
 *   literals, or they would all be tautologies.
 * - NOT ENFORCED, and do not read this header as promising otherwise. This
 *   file's `leagueWorld` (helpers/socketJoinWorld.js) and
 *   `draftJoinCommissioner.test.js`'s own `leagueWorld` duplicate the same
 *   manager ids, the same Team names and the same `{ coCommissioners }`
 *   signature by hand. NOTHING keeps them in step. Change one and the other
 *   goes on passing against different facts, and the disagreement surfaces
 *   as two suites that each look right alone. That matters more than an
 *   ordinary duplicate: `draftJoinCommissioner` staying green under the
 *   mutation is the CONTROL that makes this suite's red meaningful, and a
 *   control is only worth something while it is describing the same world.
 *   Folding them together was left out of #231 deliberately, as an edit to a
 *   suite outside its scope. Filed as #260.
 *
 * That distinction is the point of writing it down. A reader who knows the
 * gap can check it; a reader who trusts a guarantee that does not exist
 * stops looking.
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
    // The CODE is what the client discriminates on (#230), never the text:
    // this is the one refusal that clears the viewer's Team identity and
    // commissioner flag, and it has to be told apart from the other two
    // without matching a message string. Still deepEqual on the WHOLE
    // object - loosening it to a property check to accommodate the new
    // field would reopen the masking trap the exactness exists to close.
    assert.deepEqual(ack, { error: 'you are not in this league', code: 'not_a_member' });
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

// Both joins, not just the draft one: #230 puts a code on all three refusal
// paths of BOTH handlers, and this is the only path where nothing is read
// before the answer, so nothing else would notice league:join losing its.
for (const [label, leagueId] of [
  ['a string', String(LEAGUE_ID)],
  ['a fractional number', 1.5],
  ['missing', undefined],
]) {
  for (const event of JOIN_EVENTS) {
    test(`${event} with a leagueId that is ${label} is refused as invalid`, async (t) => {
      const fake = world(t);
      const client = await harness.connectAs(OWNER, t);

      const ack = await harness.emit(client, event, { leagueId });

      assert.deepEqual(ack, { error: 'leagueId (integer) required', code: 'invalid_request' });
      assert.equal(fake.calls.length, 0, 'an invalid leagueId never reaches the database');
    });
  }
}

// ---------------------------------------------------------------------------
// The third refusal: the attempt threw (#230).
// ---------------------------------------------------------------------------

for (const [event, message] of [
  ['draft:join', 'failed to join draft room'],
  ['league:join', 'failed to join league room'],
]) {
  test(`${event} answers join_failed when the attempt throws, not a membership answer`, async (t) => {
    // This is the generic failure the header warns a fixture GAP produces,
    // and it is under test here rather than in the way: the throw is
    // deliberate, and the ack is still asserted whole. What the code buys is
    // that a client can now tell this apart from the refusal above WITHOUT
    // reading either message - and it must, because a client that read a
    // database blip as "you are not a member" would clear a manager's Team
    // identity and commissioner controls off the screen on every reconnect
    // attempt. Triage rejected that flicker; the code is what prevents it.
    const thrown = new Error('the database went away mid-join');
    createFakePool([
      [select('teams'), () => { throw thrown; }],
    ]).install(t);
    // The handler logs the throw on purpose. Silenced so a deliberate fault
    // does not read as a broken run, and asserted below so silencing it does
    // not also hide a handler that stopped reporting.
    const logged = t.mock.method(console, 'error', () => {});
    const client = await harness.connectAs(OWNER, t);

    const ack = await harness.emit(client, event, { leagueId: LEAGUE_ID });

    assert.deepEqual(ack, { error: message, code: 'join_failed' });
    assert.deepEqual(logged.mock.calls[0].arguments, [`${event} failed`, thrown]);
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
