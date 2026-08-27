const { test } = require('node:test');
const assert = require('node:assert/strict');
const { viewerContext, joinAck } = require('../modules/draftSocket');
const {
  leagueWorld,
  LEAGUE_ID,
  OWNER,
  CO_COMMISSIONER,
  MEMBER,
} = require('./helpers/socketJoinWorld');

/**
 * #178: the Draft room's commissioner controls are gated on a per-viewer
 * flag the SERVER computes, and the join acknowledgement is where it travels.
 *
 * Two rules are under test, and they are the two ways this can go wrong:
 *
 * 1. A commissioner is the owner OR a `league_commissioners` row
 *    (leagueRole.service's header, CONTEXT.md's co-commissioner entry). A
 *    co-commissioner must answer true, so the room can never fall back to
 *    the owner-only comparison it used to make on the client.
 * 2. An ordinary manager must answer false. The flag decides what a viewer
 *    is offered, so being generous with it is the worse failure of the two.
 *
 * `draft:state` cannot carry this: it is broadcast to the whole league room
 * and no viewer-relative field on it can be true for every recipient (#112,
 * parent #108). The ack is answered to one socket, which is why it already
 * carries `viewerTeamId` and why it carries this beside it.
 */

/**
 * The league world (owner/co-commissioner/member ids, Team names, and the
 * `{ coCommissioners }` builder) is `helpers/socketJoinWorld.js`'s, not a
 * copy: that file is also what `socketJoinEndToEnd.test.js`'s real-socket
 * harness builds its world from, and the two suites being unable to drift
 * apart is what makes the harness's mutation evidence mean anything (#260).
 *
 * Be clear about what the shared world proves and what it does not. The
 * handler does NOT execute the commissioner predicate: it ignores the SQL
 * text and answers from a JS Set, so it plays the rows Postgres WOULD return
 * for that query without ever running it. That is the right fixture for the
 * three role tests below, but it means none of them can catch a call site
 * that asked the wrong question and got a coincidentally right answer.
 *
 * What closes that gap is `fake.calls`, which records every statement: the
 * fourth test below reads the SQL back and asserts the question was asked of
 * `league_commissioners`. Evidence about the ANSWER comes from here; evidence
 * about the QUESTION comes from there.
 */
const contextFor = (fake, userId) => viewerContext(fake, { leagueId: LEAGUE_ID, userId });

test('the join ack tells the league owner they are a commissioner', async () => {
  const fake = leagueWorld();

  const viewer = await contextFor(fake, OWNER.userId);

  assert.deepEqual(joinAck(viewer), {
    ok: true,
    viewerTeamId: OWNER.teamId,
    isCommissioner: true,
    gifMessagesEnabled: false,
  });
});

test('the join ack tells a co-commissioner they are a commissioner', async () => {
  const fake = leagueWorld({ coCommissioners: [CO_COMMISSIONER.userId] });

  const viewer = await contextFor(fake, CO_COMMISSIONER.userId);

  assert.deepEqual(joinAck(viewer), {
    ok: true,
    viewerTeamId: CO_COMMISSIONER.teamId,
    isCommissioner: true,
    gifMessagesEnabled: false,
  });
});

test('the join ack tells an ordinary manager they are not a commissioner', async () => {
  const fake = leagueWorld({ coCommissioners: [CO_COMMISSIONER.userId] });

  const viewer = await contextFor(fake, MEMBER.userId);

  assert.deepEqual(joinAck(viewer), {
    ok: true,
    viewerTeamId: MEMBER.teamId,
    isCommissioner: false,
    gifMessagesEnabled: false,
  });
});

test('the commissioner question is asked of league_commissioners, not of owner_id alone', async () => {
  // The defect this ticket closes was an owner-only comparison wearing a
  // commissioner's name. An implementation that reverted to one would still
  // pass the three role tests above IF its fixture happened to make the
  // owner the only commissioner, so the shape of the question is asserted
  // here rather than left to the answers.
  const fake = leagueWorld({ coCommissioners: [CO_COMMISSIONER.userId] });

  await contextFor(fake, CO_COMMISSIONER.userId);

  const [asked] = fake.matching(/FROM "leagues"/);
  assert.ok(asked, 'the viewer context asks the league a commissioner question');
  assert.match(asked.text, /"league_commissioners"/);
  assert.deepEqual(asked.params, [LEAGUE_ID, CO_COMMISSIONER.userId]);
});

test('a manager who holds no Team in the league gets no viewer context at all', async () => {
  // Membership IS the Team (ADR 0002), so the same read answers "may they
  // join" and "which Team are they". A non-member never reaches an ack.
  const fake = leagueWorld();

  assert.equal(await contextFor(fake, 404), null);
  assert.equal(fake.matching(/FROM "leagues"/).length, 0, 'no role question for a non-member');
});

