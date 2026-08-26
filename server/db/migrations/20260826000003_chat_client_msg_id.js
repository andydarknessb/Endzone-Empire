/**
 * Client idempotency keys for League chat sends (#440, flood resistance).
 *
 * A send can reach the server more than once for reasons the sender never
 * chose: a socket ack lost on a flaky link, a reconnect that replays an
 * in-flight send, a double-tapped Send button. Without a key, each arrival is a
 * new row and the feed shows the same message twice. This migration gives the
 * feed a way to collapse those retries into one entry: the CLIENT stamps each
 * composed message with a stable id (a UUID, generated once and reused on every
 * retry of that same message), and the server inserts under a unique index so a
 * second arrival of the same id cannot create a second row.
 *
 * WHY A DATABASE CONSTRAINT RATHER THAN AN IN-MEMORY DEDUP CACHE. The guarantee
 * has to hold across the two ways a retry actually races: two sends of the same
 * id arriving CONCURRENTLY (a double-tap before the first ack), and a retry
 * arriving after a RECONNECT that may land on a different server instance behind
 * the socket.io Redis adapter. A per-process cache answers neither - two
 * instances each see a "first" arrival. A unique index is the one place both
 * races serialise: the second INSERT loses to the first at the database, on
 * every instance, forever, not just within a TTL. This mirrors the feed_seq
 * trigger (#434) and roster_tenures (ADR 0006): a fact every write path must
 * respect belongs at the database boundary, not in caller memory.
 *
 * WHY (user_id, client_msg_id) AND WHY PARTIAL. The key is unique PER AUTHOR: a
 * client generates its own ids, so two managers could in principle mint the same
 * uuid, and scoping the constraint to the author keeps one manager's retry from
 * ever colliding with another's message. The index is PARTIAL
 * (WHERE client_msg_id IS NOT NULL) so that legacy rows and any future writer
 * that does not supply a key are simply not constrained - a null is not a
 * duplicate of another null. The column is nullable for the same reason: this is
 * additive, and a client too old to send a key still sends chat, just without
 * the retry protection.
 *
 * EXPAND-ONLY. Adds a nullable column and one index; no backfill, no rewrite,
 * no lock beyond the brief ADD COLUMN. Safe to apply while chat is live.
 */

const CHAT = 'chat_messages';
const INDEX = 'chat_messages_author_client_msg_id';

exports.up = async function (knex) {
  await knex.schema.alterTable(CHAT, (t) => {
    // 64 is comfortably above a 36-char UUID, leaving room for other
    // client-side key shapes without inviting an unbounded value.
    t.string('client_msg_id', 64);
  });

  // A retry of one author's message collapses onto its first insert; a null key
  // (legacy row, or a client that sends none) is left unconstrained.
  await knex.raw(
    `CREATE UNIQUE INDEX "${INDEX}"
     ON "${CHAT}" ("user_id", "client_msg_id")
     WHERE "client_msg_id" IS NOT NULL`
  );
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "${INDEX}"`);
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('client_msg_id');
  });
};
