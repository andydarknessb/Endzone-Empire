const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, isPlatformAdmin } = require('../modules/auth');
const { isLeagueCommissioner, commissionerPredicate } = require('../services/leagueRole.service');
const { getIo } = require('../modules/io');
const { deliverFeedEntry } = require('../modules/draftSocket');
const { feedEntryOf } = require('../services/leagueFeed');
const {
  teamIdentityColumns,
  teamIdentityJoin,
  teamIdentityOf,
  lookupTeam,
} = require('../services/teamIdentity');

const router = express.Router();
router.use(requireAuth);

// A moderation reason - whether it accompanies a report or a hide - is required
// and bounded identically, so the two routes share one rule rather than each
// spelling the bound. The client mirrors these by value (ChatConversation's
// HIDE_REASON_MIN/MAX), the way the feed page size is mirrored across the seam.
const REASON_MIN = 10;
const REASON_MAX = 500;
function reasonError(reason) {
  return reason.length < REASON_MIN || reason.length > REASON_MAX
    ? `reason must be between ${REASON_MIN} and ${REASON_MAX} characters`
    : null;
}

// Allowed as-is (#378 ruling): this is the caller's OWN block list, keyed on
// the same user id the block/unblock writes below take. It is viewer-own
// chrome, not a manager-shared surface, so it is not a Team identity leak.
// The column list stays explicit anyway so the contract stays deliberate.
router.get('/blocks', async (req, res) => {
  const result = await pool.query(
    `SELECT "users"."id", "users"."username", "user_blocks"."created_at"
     FROM "user_blocks"
     JOIN "users" ON "users"."id" = "user_blocks"."blocked_id"
     WHERE "user_blocks"."blocker_id" = $1 ORDER BY "users"."username"`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.post('/blocks', async (req, res) => {
  const blockedId = Number(req.body?.userId);
  if (!Number.isInteger(blockedId) || blockedId === req.user.id) {
    return res.status(400).json({ error: 'a different userId is required' });
  }
  const sharedLeague = await pool.query(
    `SELECT 1
     FROM "teams" mine
     JOIN "teams" theirs ON theirs."league_id" = mine."league_id"
     WHERE mine."owner_id" = $1 AND theirs."owner_id" = $2 LIMIT 1`,
    [req.user.id, blockedId]
  );
  if (!sharedLeague.rows[0]) return res.status(404).json({ error: 'user not found' });
  await pool.query(
    `INSERT INTO "user_blocks" ("blocker_id", "blocked_id")
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, blockedId]
  );
  return res.status(201).json({ ok: true });
});

router.delete('/blocks/:userId', async (req, res) => {
  const blockedId = Number(req.params.userId);
  if (!Number.isInteger(blockedId)) return res.status(400).json({ error: 'userId is required' });
  await pool.query(
    `DELETE FROM "user_blocks" WHERE "blocker_id" = $1 AND "blocked_id" = $2`,
    [req.user.id, blockedId]
  );
  return res.json({ ok: true });
});

router.post('/reports', async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const messageId = req.body?.messageId == null ? null : Number(req.body.messageId);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(leagueId) || (messageId != null && !Number.isInteger(messageId))) {
    return res.status(400).json({ error: 'valid leagueId and messageId are required' });
  }
  const reasonProblem = reasonError(reason);
  if (reasonProblem) return res.status(400).json({ error: reasonProblem });
  const allowed = await pool.query(
    `SELECT 1 FROM "teams"
     WHERE "league_id" = $1 AND "owner_id" = $2
       AND ($3::int IS NULL OR EXISTS (
         SELECT 1 FROM "chat_messages"
         WHERE "id" = $3 AND "league_id" = $1
       ))`,
    [leagueId, req.user.id, messageId]
  );
  if (!allowed.rows[0]) return res.status(403).json({ error: 'report target is unavailable' });
  const result = await pool.query(
    `INSERT INTO "content_reports" ("reporter_id", "league_id", "message_id", "reason")
     VALUES ($1, $2, $3, $4) RETURNING "id", "status", "created_at"`,
    [req.user.id, leagueId, messageId, reason]
  );
  return res.status(201).json(result.rows[0]);
});

router.get('/reports/:leagueId', async (req, res) => {
  const leagueId = Number(req.params.leagueId);
  const isCommissioner = await isLeagueCommissioner(pool, leagueId, req.user.id);
  if (!isCommissioner && !isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'moderator access required' });
  }
  // #378: no reporter/resolver identity in the served payload, for
  // commissioners and platform admins alike (the ruling draws no
  // distinction). The column list is explicit both in the query (so a
  // future `content_reports` column can't reach the wire unnamed) and again
  // here in JS (so a handler edit that reintroduces a spread is caught even
  // if the SQL projection stays correct).
  const result = await pool.query(
    `SELECT "id", "league_id", "message_id", "reason", "status", "resolved_at", "created_at", "updated_at"
     FROM "content_reports"
     WHERE "league_id" = $1
     ORDER BY "created_at" DESC`,
    [leagueId]
  );
  return res.json(result.rows.map((row) => ({
    id: row.id,
    league_id: row.league_id,
    message_id: row.message_id,
    reason: row.reason,
    status: row.status,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })));
});

router.put('/reports/:id', async (req, res) => {
  const reportId = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!Number.isInteger(reportId) || !['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'valid report id and status are required' });
  }
  const result = await pool.query(
    `UPDATE "content_reports" SET
       "status" = $1, "resolved_by" = $2, "resolved_at" = now(), "updated_at" = now()
     WHERE "id" = $3 AND (
       EXISTS (
         SELECT 1 FROM "leagues"
         WHERE "leagues"."id" = "content_reports"."league_id"
           AND ${commissionerPredicate(2)}
       )
       OR $4::boolean = true
     )
     RETURNING "id", "status", "resolved_at"`,
    [status, req.user.id, reportId, isPlatformAdmin(req.user.id)]
  );
  if (!result.rows[0]) return res.status(403).json({ error: 'moderator access required' });
  return res.json(result.rows[0]);
});

// POST /api/safety/hide - a commissioner or co-commissioner (or platform admin)
// hides one abusive League-chat message league-wide, after supplying a reason
// (#441, AC2). Hiding is a reversible FLAG, not a delete: the original content
// stays on the row for the authorized-reviewer history (AC4) and leaves with
// the row on retention/account deletion (ADR 0012, no retained copy). The
// action is scoped to `chat_messages` by id, so Draft activity - a separate,
// append-only record type - is structurally unreachable and can never be
// hidden, edited or deleted through moderation (AC6; the feed layer names the
// same rule as MODERATABLE_FEED_TYPES).
router.post('/hide', async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const messageId = Number(req.body?.messageId);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(leagueId) || !Number.isInteger(messageId)) {
    return res.status(400).json({ error: 'valid leagueId and messageId are required' });
  }
  // A hide MUST carry a reason (AC2), bounded like a report reason.
  const reasonProblem = reasonError(reason);
  if (reasonProblem) return res.status(400).json({ error: reasonProblem });
  const isCommissioner = await isLeagueCommissioner(pool, leagueId, req.user.id);
  if (!isCommissioner && !isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'moderator access required' });
  }
  // Hide only a not-yet-hidden message that belongs to this league. The first
  // hide wins and its actor/reason/instant are never overwritten by a second.
  // A messageId that is not a chat_messages row (a Draft-activity id, say)
  // matches nothing, so moderation cannot reach Draft activity (AC6).
  const hidden = await pool.query(
    `UPDATE "chat_messages"
        SET "hidden_at" = now(), "hidden_by" = $1, "hidden_reason" = $2
      WHERE "id" = $3 AND "league_id" = $4 AND "hidden_at" IS NULL
      RETURNING "id", "feed_seq", "created_at", "user_id", "hidden_at"`,
    [req.user.id, reason, messageId, leagueId]
  );
  if (hidden.rows.length === 0) {
    // Either no such message in this league, or it was already hidden. Tell the
    // two apart; a league commissioner may see that a message of theirs exists.
    const existing = await pool.query(
      `SELECT "hidden_at" FROM "chat_messages" WHERE "id" = $1 AND "league_id" = $2`,
      [messageId, leagueId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'message not found in this league' });
    }
    return res.status(200).json({ ok: true, alreadyHidden: true });
  }
  const row = hidden.rows[0];
  // Broadcast the neutral tombstone to the room so every connected member swaps
  // the content live (AC7, multi-client). Reusing deliverFeedEntry inherits the
  // per-viewer block filtering (#440): a viewer who blocked the author never saw
  // the message and never sees its tombstone. Presenter viewers are not in the
  // league room and their board carries no chat, so this never reaches them
  // (AC5). A broadcast is best-effort chrome; a missing io must not fail the
  // hide, which is already durably recorded above.
  const io = getIo();
  if (io) {
    try {
      const authorTeam = await lookupTeam(pool, { leagueId, userId: row.user_id });
      const entry = {
        ...feedEntryOf({
          id: row.id,
          feed_seq: row.feed_seq,
          message: null,
          created_at: row.created_at,
          hidden_at: row.hidden_at,
          ...teamIdentityOf(authorTeam),
        }),
        leagueId,
      };
      await deliverFeedEntry(io, pool, {
        leagueId,
        event: 'chat:hidden',
        entry,
        authorUserId: row.user_id,
      });
    } catch (error) {
      console.error('hide broadcast failed (message is hidden regardless)', error);
    }
  }
  return res.status(200).json({ ok: true });
});

// GET /api/safety/moderations/:leagueId - the moderation history for authorized
// reviewers (#441, AC4): every hidden message with its ORIGINAL content, the
// reason and the instant it was hidden. Commissioner/co-commissioner or platform
// admin only, the same gate as the report list.
//
// ACTOR EXPOSURE IS PENDING A MAINTAINER RULING (#441 / #378 boundary). AC4
// asks the history to preserve the "actor"; #378 ruled the moderator's identity
// (the "resolver") is stripped from the adjacent content_reports surface. So the
// actor is STORED on the row (chat_messages.hidden_by) - AC4's "preserves" is
// about the record - but is NOT served here while the exposure is Cory's to
// decide. This projection is the single wire-shaping point, explicit in both SQL
// and JS the way #378's handler is, so a spread cannot reintroduce a field: to
// EXPOSE the actor once ruled, add the moderator Team identity to the SELECT
// (teamIdentityColumns('moderator','moderator') over a LEFT JOIN on hidden_by)
// and to the serializer, and flip the absence assertion in the route test. A
// NULL hidden_by then reads as a former manager (deleted account), rendered by
// teamNameLabel, never as "the system".
router.get('/moderations/:leagueId', async (req, res) => {
  const leagueId = Number(req.params.leagueId);
  if (!Number.isInteger(leagueId)) {
    return res.status(400).json({ error: 'valid leagueId is required' });
  }
  const isCommissioner = await isLeagueCommissioner(pool, leagueId, req.user.id);
  if (!isCommissioner && !isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'moderator access required' });
  }
  // The hidden message's ORIGINAL author is Team identity (already league-visible
  // in chat), joined LEFT so a departed author still reads back (null identity)
  // rather than dropping the record out of the history.
  const result = await pool.query(
    `SELECT "cm"."id",
            "cm"."content_kind" AS "contentKind",
            "cm"."message" AS "originalMessage",
            "cm"."gif_provider" AS "originalGifProvider",
            "cm"."gif_asset_id" AS "originalGifAssetId",
            "cm"."gif_description" AS "originalGifDescription",
            "cm"."hidden_reason" AS "reason",
            "cm"."hidden_at" AS "hiddenAt",
            "cm"."created_at" AS "createdAt",
            ${teamIdentityColumns('author', 'author')}
       FROM "chat_messages" AS "cm"
       ${teamIdentityJoin('"cm"."league_id"', '"cm"."user_id"', 'author')}
      WHERE "cm"."league_id" = $1 AND "cm"."hidden_at" IS NOT NULL
      ORDER BY "cm"."hidden_at" DESC`,
    [leagueId]
  );
  // Explicit projection (the #378 pattern): named fields only, so no raw column
  // - author user_id, hidden_by - can reach the wire through a spread. The actor
  // is deliberately absent (see the note above).
  //
  // #446: a hidden GIF message must not blind the audit. For a GIF, the caption
  // (originalMessage) is optional and often null, so the asset id and the
  // description - what was actually removed - are projected too, added
  // DELIBERATELY to this allowlist (never via a spread). The member feed still
  // tombstones all three (leagueFeed.feedEntryOf); this reviewer-only history is
  // the single place the original GIF content survives, so a commissioner's hide
  // stays reviewable for the content type least reconstructable from memory. A
  // text row carries null in all three gif fields and reads exactly as before.
  return res.json(result.rows.map((row) => ({
    id: row.id,
    contentKind: row.contentKind,
    originalMessage: row.originalMessage,
    originalGifProvider: row.originalGifProvider ?? null,
    originalGifAssetId: row.originalGifAssetId ?? null,
    originalGifDescription: row.originalGifDescription ?? null,
    reason: row.reason,
    hiddenAt: row.hiddenAt,
    createdAt: row.createdAt,
    authorTeamId: row.authorTeamId ?? null,
    authorTeamName: row.authorTeamName ?? null,
  })));
});

module.exports = router;
