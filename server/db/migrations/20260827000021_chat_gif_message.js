/**
 * A structured GIF message shape for League chat (#446, parent #429).
 *
 * #446 builds a provider-neutral, DISABLED-BY-DEFAULT GIF message so the
 * contract and the experience are testable WITHOUT sending anything to a third
 * party (AC9). This migration is the storage half of that contract.
 *
 * WHY THIS LIVES ON `chat_messages` AND NOT A NEW TABLE OR A NEW FEED KIND.
 * A GIF message IS League chat: a member-authored, Team-identified message that
 * is moderatable (#441), blockable (#440), retention-subject and account-
 * deletion-subject, and that must take a per-league chronological position like
 * any other message (ADR 0012). Storing it as a `chat_messages` row means it
 * inherits ALL of that unchanged: the BEFORE INSERT trigger allocates its
 * `feed_seq` (#434), the AFTER INSERT trigger claims its shared
 * `(league_id, feed_seq)` position in `league_feed_positions` (#471, ADR 0015),
 * `hidden_at` tombstones it (#441), `client_msg_id` dedupes its retries (#440),
 * and the `feed_seq` cursor resumes it on reconnect (#442). It is NOT Draft
 * activity (ADR 0012): Draft activity is server-authored, append-only and never
 * moderatable, and a GIF message is none of those. So no new record kind and no
 * new feed arm are introduced; the combined and chat-only feed reads keep their
 * single `league_chat` kind and simply project the new columns.
 *
 * THE SHAPE. A GIF message carries exactly ONE provider asset, an OPTIONAL
 * caption and a REQUIRED accessible description (AC1):
 *
 *   content_kind    'text' | 'gif'. The discriminator. Added NOT NULL DEFAULT
 *                   'text' so every existing row and every existing text INSERT
 *                   (which names no content_kind) reads back as 'text' with no
 *                   backfill and no change to the text send path. On Postgres 11+
 *                   a constant DEFAULT is a metadata-only fast default: no table
 *                   rewrite, only a brief ACCESS EXCLUSIVE lock to add the
 *                   column (milliseconds while `chat_messages` is small; the same
 *                   lock note the sibling moderation and client_msg_id
 *                   migrations carry).
 *   gif_provider    the opaque provider id a GIF asset belongs to (e.g. a future
 *                   'giphy' / 'tenor', or the test-only fake). It is an
 *                   IDENTIFIER, never a URL: nothing in this feature builds a URL
 *                   from it before external approval (AC9). NULL for a text row.
 *   gif_asset_id    the provider's own id for the asset. Again an identifier, NOT
 *                   a URL and NOT uploaded bytes - see the AC2 note below. NULL
 *                   for a text row.
 *   gif_description the REQUIRED accessible description (alt text). AC3 makes a
 *                   missing description block send, so a stored GIF row always
 *                   carries one. NULL for a text row.
 *
 * The existing `message` column is RELAXED to nullable and does double duty: the
 * body of a text message (as today), or the OPTIONAL caption of a GIF message
 * (which may be absent). This is why the relax is needed: a GIF with no caption
 * has no `message`, and the text send path's own `message.trim()` check keeps a
 * text message from ever being empty, so relaxing the column does not loosen the
 * text rule - that rule lives in the handler, not the column.
 *
 * WHY AC2 (NO ARBITRARY URLs, NO USER UPLOADS) IS STRUCTURAL HERE. There is
 * deliberately NO url column and NO blob/bytea column on this shape. The only
 * way a GIF message can name an asset is (gif_provider, gif_asset_id), so the
 * store itself cannot hold an embedded URL or an uploaded file - the send guard
 * (chat:send) additionally refuses a url-shaped or upload-shaped asset with a
 * SCREAMING_SNAKE code (ADR 0008), but even a guard bug could not persist one,
 * because there is no column for it. This is a DIFFERENT surface from the team
 * avatar upload path (team.router -> avatar.service -> its own Supabase bucket,
 * magic-byte sniff), which legitimately accepts an uploaded animated GIF; that
 * path is untouched by this migration and by the message guard. Same word
 * ("upload"), opposite rules, separate storage.
 *
 * STRUCTURAL TWO-SHAPE INVARIANT. A single CHECK constraint makes the two
 * shapes mutually exclusive and complete, so a malformed row cannot exist even
 * if a future writer forgets the app-level rule (the two-barrier philosophy the
 * feed layer already uses - SQL AND JS):
 *   - a 'text' row has a non-null `message` and all three gif_* columns NULL;
 *   - a 'gif' row has all three of gif_provider / gif_asset_id / gif_description
 *     non-null, and its `message` (the caption) is free to be null or present.
 * Adding the constraint validates existing rows: every existing row is a text
 * message with `message` non-null (it was NOT NULL until this migration) and no
 * gif columns, so all satisfy the 'text' branch and validation cannot fail.
 *
 * DISABLED BY DEFAULT (AC9). This migration only makes the shape STORABLE. No
 * GIF message is ever written until the GIF-message capability is enabled, which
 * is a plain application config that is off by default and carries no provider
 * key and triggers no provider request. In production these columns stay
 * content_kind='text' / gif_* NULL until external approval turns the capability
 * on. Nothing here enables a provider.
 *
 * EXPAND-ONLY, LOCKS BRIEFLY. Four ADD COLUMNs (one with a fast default), one
 * ALTER of `message` to drop NOT NULL, and one ADD CONSTRAINT that validates the
 * (small) table. No backfill, no table rewrite. As with the sibling chat
 * migrations, "safe to apply while chat is live" rests on `chat_messages` being
 * small; the ACCESS EXCLUSIVE locks are milliseconds at its current size. Apply
 * when no draft is live so no manager's chat:send is blocked mid-draft.
 *
 * ROLLBACK is safe while no GIF message exists - which is the disabled-by-default
 * state, and the state CI's migrate/rollback/migrate runs in. Restoring `message`
 * NOT NULL is impossible while a GIF row carries a null caption, so `down` RAISES
 * FIRST with a readable message naming the offending count, BEFORE it drops
 * anything - the house pattern (20260827000001, 20260827000010): the count must
 * be taken while `content_kind` still exists, because after the drop the question
 * "which rows are GIFs" can no longer be asked, and an operator would otherwise
 * watch a raw "column message contains null values" error land after the
 * discriminator and the GIF content were already gone. Only once that check
 * passes (the empty-table CI rollback, and the disabled-by-default state) does
 * `down` drop the constraint and the gif columns and restore `message` NOT NULL.
 * Once GIF messages with null captions exist, recovery is a forward migration,
 * not this down - the same ADR-0012 "rollback while empty" shape the moderation
 * migration documents. This down is NOT append-only-guarded because
 * `chat_messages` is not the append-only Draft-activity store; it carries no
 * authoritative history that a drop would erase.
 *
 * MIGRATIONS ARE A CARVE-OUT (ADR 0012 / ADR 0015): an IC writes this; the
 * maintainer merges, applies and verifies it against knex_migrations. It is
 * never applied from an IC session.
 */

const CHAT = 'chat_messages';
const SHAPE_CONSTRAINT = 'chat_messages_content_shape';

exports.up = async function (knex) {
  await knex.schema.alterTable(CHAT, (t) => {
    // The discriminator. Fast default on PG 11+, so no rewrite; every existing
    // row and every text INSERT that names no kind reads back 'text'.
    t.string('content_kind', 16).notNullable().defaultTo('text');
    // A GIF asset is (provider, assetId), both identifiers, never a URL and
    // never bytes (AC2/AC9). NULL on a text row.
    t.string('gif_provider', 64);
    t.string('gif_asset_id', 255);
    // The REQUIRED accessible description (AC3). 500 matches the message bound.
    t.string('gif_description', 500);
    // `message` becomes the optional caption for a GIF row, so it must allow
    // null; the text send path still rejects an empty text message itself.
    t.string('message', 500).nullable().alter();
  });

  // The two-shape structural invariant (see the header). One row is either a
  // well-formed text message or a well-formed gif message, never a mix and never
  // a gif missing its required parts.
  await knex.raw(
    `ALTER TABLE "${CHAT}" ADD CONSTRAINT "${SHAPE_CONSTRAINT}" CHECK (
       (
         "content_kind" = 'text'
         AND "message" IS NOT NULL
         AND "gif_provider" IS NULL
         AND "gif_asset_id" IS NULL
         AND "gif_description" IS NULL
       ) OR (
         "content_kind" = 'gif'
         AND "gif_provider" IS NOT NULL
         AND "gif_asset_id" IS NOT NULL
         AND "gif_description" IS NOT NULL
       )
     )`
  );
};

exports.down = async function (knex) {
  // RAISE FIRST, before dropping anything (20260827000001, 20260827000010).
  // Restoring message NOT NULL below is impossible while any GIF row has a null
  // caption; count them WHILE content_kind still exists (after the drop the
  // question cannot be asked) and refuse readably, so the operator sees a clear
  // "changed nothing" refusal naming the count rather than a raw Postgres
  // "column message contains null values" after the discriminator and the GIF
  // content are already gone.
  const blocking = await knex.raw(
    `SELECT count(*)::int AS n
       FROM "${CHAT}"
      WHERE "content_kind" = 'gif' AND "message" IS NULL`
  );
  const count = blocking.rows[0].n;
  if (count > 0) {
    throw new Error(
      `Refusing to roll back 20260827000021: ${count} GIF message(s) have a null caption, so `
      + 'restoring chat_messages.message NOT NULL would fail. Recovery from this point is a '
      + 'forward migration, not this down.'
    );
  }

  await knex.raw(`ALTER TABLE "${CHAT}" DROP CONSTRAINT IF EXISTS "${SHAPE_CONSTRAINT}"`);
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('gif_description');
    t.dropColumn('gif_asset_id');
    t.dropColumn('gif_provider');
    t.dropColumn('content_kind');
  });
  // Restore the original NOT NULL. The guard above proved no GIF row would
  // violate it (the disabled-by-default state and CI's empty-table rollback).
  await knex.schema.alterTable(CHAT, (t) => {
    t.string('message', 500).notNullable().alter();
  });
};
