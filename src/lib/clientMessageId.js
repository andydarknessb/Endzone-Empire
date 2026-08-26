/**
 * A client idempotency key for a chat send (#440). Generated once for one
 * LOGICAL message and reused on every retry of it, so a lost ack, a reconnect
 * replay or a double-tapped Send cannot create a second row: the server dedupes
 * inserts that carry the same key (chat_messages.client_msg_id, unique per
 * author). Mirrors src/lib/pendingLineupMutations.mutationId so both idempotency
 * paths mint keys the same way, with the same non-crypto fallback for
 * environments without crypto.randomUUID.
 */
export function newClientMsgId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default newClientMsgId;
