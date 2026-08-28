/**
 * The Draft room's viewer-relative membership, as three states rather than the
 * boolean "is there a socket" the room mounted chat from before (#534).
 *
 * The bug this settles: a `draft:join` refusal still leaves a live socket, so a
 * non-member used to get the League chat log and composer mounted over a feed
 * request the server answers 403, with every send permanently refused. The cure
 * is to distinguish three things the boolean could not:
 *
 *   UNKNOWN     membership is not yet decided - before the first join
 *               acknowledgement lands. Chat mounts nothing and, crucially,
 *               issues no combined-feed request (#534 AC1): a request that will
 *               403 must never leave the client.
 *   MEMBER      a successful join acknowledgement confirmed a Team here. Chat,
 *               its feed, the composer and (for a commissioner) moderation are
 *               available (#534 AC2).
 *   NON_MEMBER  an AUTHORITATIVE non-member result. The chat surface collapses
 *               to a single explicit message with no log, composer or moderation
 *               (#534 AC3).
 *
 * THE AUTHORITY RULE (ADR 0008, and useDraftSocket's join handler): the code is
 * the contract and the message is only copy, so every transition here reads a
 * CODE and never message text. `NOT_A_MEMBER` is the one refusal that is a
 * statement about this viewer's standing, and it is the ONLY thing that moves a
 * viewer to NON_MEMBER. Everything else - `JOIN_FAILED`, an unknown code, an
 * acknowledgement carrying no code at all, a transient feed failure - says the
 * ATTEMPT failed, not that the viewer lost their Team, and so must PRESERVE the
 * last confirmed state (#534 AC5). Treating "any failure" as "not a member" is
 * the natural mistake, and it fails in the direction that looks like caution: a
 * blip would strip a genuine member of chat until they reloaded.
 *
 * Membership is not settled once at join, either. A confirmed member can be
 * removed mid-draft, and they learn it through two OTHER channels the feed hook
 * watches: a `NOT_A_MEMBER` acknowledgement from `chat:send`, and a 403 from the
 * member-only combined-feed read. Both are authoritative and both revoke without
 * waiting for a reload (#534 AC4).
 */

export const MEMBERSHIP_UNKNOWN = 'unknown';
export const MEMBERSHIP_MEMBER = 'member';
export const MEMBERSHIP_NON_MEMBER = 'non_member';

// The one authoritative refusal code (ADR 0008). Matched exactly; a client acts
// only on codes it knows and takes nothing away on any other.
export const NOT_A_MEMBER_CODE = 'NOT_A_MEMBER';

/**
 * The membership state after a `draft:join` acknowledgement, given the state
 * before it. A join runs on the first connect AND on every reconnect, so this
 * is asked repeatedly against a standing state - which is why the preserve
 * branch is load-bearing, not defensive.
 *
 *   - a SUCCESS ack (no `error`) confirms a member.
 *   - a refusal whose `code` is exactly `NOT_A_MEMBER` is authoritative: the
 *     viewer holds no Team here, so they are a non-member.
 *   - any other refusal - `JOIN_FAILED`, an unknown code, a missing code -
 *     preserves the state we already had.
 */
export function membershipAfterJoinAck(current, ack) {
  if (!ack || !ack.error) return MEMBERSHIP_MEMBER;
  if (ack.code === NOT_A_MEMBER_CODE) return MEMBERSHIP_NON_MEMBER;
  return current;
}

/**
 * Whether a `chat:send` acknowledgement is the authoritative non-member signal
 * (#534 AC4). The server re-looks-up the author's Team on every send and refuses
 * a removed manager with `code: 'NOT_A_MEMBER'`; every other refusal
 * (RATE_LIMITED, MESSAGE_TOO_LONG, a GIF rule) is about THIS send, not the
 * viewer's standing, and must not revoke membership. Matched on the code alone.
 */
export function chatSendAckRevokesMembership(ack) {
  return Boolean(ack && ack.code === NOT_A_MEMBER_CODE);
}

/**
 * Whether a combined-feed read error is the authoritative non-member signal
 * (#534 AC4). The member-only feed route checks membership before it reads
 * anything and refuses a non-member with HTTP 403; any other failure (a network
 * drop, a 500, a timeout) is transient and must PRESERVE membership (#534 AC5).
 * Read off the axios error's response status, which is somebody else's numeric
 * contract (ADR 0008 scope) and matched as found.
 */
export function feedErrorRevokesMembership(error) {
  return Number(error && error.response && error.response.status) === 403;
}
