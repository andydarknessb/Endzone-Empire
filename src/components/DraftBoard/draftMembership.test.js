import {
  MEMBERSHIP_UNKNOWN,
  MEMBERSHIP_MEMBER,
  MEMBERSHIP_NON_MEMBER,
  membershipAfterJoinAck,
  chatSendAckRevokesMembership,
  feedErrorRevokesMembership,
} from './draftMembership';

// The three states are distinct values, so a mount condition can tell "not yet
// known" from "known non-member" - the whole reason #534 is not a boolean.
test('the three membership states are distinct', () => {
  const states = new Set([MEMBERSHIP_UNKNOWN, MEMBERSHIP_MEMBER, MEMBERSHIP_NON_MEMBER]);
  expect(states.size).toBe(3);
});

describe('membershipAfterJoinAck', () => {
  test('a successful ack confirms a member, from any prior state', () => {
    expect(membershipAfterJoinAck(MEMBERSHIP_UNKNOWN, { ok: true, viewerTeamId: 1 })).toBe(MEMBERSHIP_MEMBER);
    // A member removed and then re-added mid-session is confirmed again.
    expect(membershipAfterJoinAck(MEMBERSHIP_NON_MEMBER, { ok: true, viewerTeamId: 1 })).toBe(MEMBERSHIP_MEMBER);
  });

  test('a NOT_A_MEMBER refusal is authoritative and moves to non-member', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_UNKNOWN, { error: 'you are not in this league', code: 'NOT_A_MEMBER' })
    ).toBe(MEMBERSHIP_NON_MEMBER);
    // The removed-mid-draft case: a confirmed member finds out on the re-join.
    expect(
      membershipAfterJoinAck(MEMBERSHIP_MEMBER, { error: 'you are not in this league', code: 'NOT_A_MEMBER' })
    ).toBe(MEMBERSHIP_NON_MEMBER);
  });

  test('a JOIN_FAILED refusal preserves the last confirmed state', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_MEMBER, { error: 'failed to join draft room', code: 'JOIN_FAILED' })
    ).toBe(MEMBERSHIP_MEMBER);
  });

  test('an unknown code preserves the last confirmed state', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_MEMBER, { error: 'closed for maintenance', code: 'ROOM_CLOSED' })
    ).toBe(MEMBERSHIP_MEMBER);
  });

  test('a refusal with no code preserves the last confirmed state (older server)', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_MEMBER, { error: 'you are not in this league' })
    ).toBe(MEMBERSHIP_MEMBER);
  });

  test('the pre-#265 lowercase not_a_member is an unrecognised code and preserves state', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_MEMBER, { error: 'you are not in this league', code: 'not_a_member' })
    ).toBe(MEMBERSHIP_MEMBER);
  });

  test('a preserved failure from UNKNOWN stays UNKNOWN, never a silent member', () => {
    expect(
      membershipAfterJoinAck(MEMBERSHIP_UNKNOWN, { error: 'failed to join draft room', code: 'JOIN_FAILED' })
    ).toBe(MEMBERSHIP_UNKNOWN);
  });

  test('a wholly absent acknowledgement decides nothing and preserves state', () => {
    // Not a positive confirmation: an ambiguous no-payload ack must not confirm a
    // member, or the feed request AC1 forbids would leave the client. From
    // UNKNOWN it stays UNKNOWN (mount nothing); from MEMBER it stays MEMBER.
    expect(membershipAfterJoinAck(MEMBERSHIP_UNKNOWN, undefined)).toBe(MEMBERSHIP_UNKNOWN);
    expect(membershipAfterJoinAck(MEMBERSHIP_MEMBER, null)).toBe(MEMBERSHIP_MEMBER);
  });
});

describe('chatSendAckRevokesMembership', () => {
  test('only a NOT_A_MEMBER code revokes', () => {
    expect(chatSendAckRevokesMembership({ error: 'you are not in this league', code: 'NOT_A_MEMBER' })).toBe(true);
  });

  test.each([
    ['a rate-limit refusal', { error: 'slow down', code: 'RATE_LIMITED' }],
    ['a too-long refusal', { error: 'too long', code: 'MESSAGE_TOO_LONG' }],
    ['a bare refusal with no code', { error: 'failed to send message' }],
    ['the lowercase pre-#265 spelling', { error: 'nope', code: 'not_a_member' }],
    ['a success ack', { ok: true }],
    ['an absent ack', undefined],
  ])('does not revoke on %s', (_label, ack) => {
    expect(chatSendAckRevokesMembership(ack)).toBe(false);
  });
});

describe('feedErrorRevokesMembership', () => {
  test('a 403 from the member-only feed revokes', () => {
    expect(feedErrorRevokesMembership({ response: { status: 403 } })).toBe(true);
  });

  test.each([
    ['a 500', { response: { status: 500 } }],
    ['a 404', { response: { status: 404 } }],
    ['a network error with no response', { message: 'Network Error' }],
    ['a bare error', new Error('boom')],
    ['undefined', undefined],
  ])('does not revoke on %s (transient, preserve membership)', (_label, error) => {
    expect(feedErrorRevokesMembership(error)).toBe(false);
  });
});
