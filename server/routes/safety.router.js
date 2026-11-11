const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, isPlatformAdmin } = require('../modules/auth');
const { isLeagueCommissioner } = require('../services/leagueRole.service');
const { getIo } = require('../modules/io');
const { deliverFeedEntry } = require('../modules/draftSocket');
const { feedEntryOf } = require('../services/leagueFeed');
const { teamIdentityOf, lookupTeam } = require('../services/teamIdentity');

const router = express.Router();
router.use(requireAuth);

// A hide's reason is required and bounded. The client mirrors these by value
// (ChatConversation's HIDE_REASON_MIN/MAX), the way the feed page size is mirrored
// across the seam.
const REASON_MIN = 10;
const REASON_MAX = 500;
function reasonError(reason) {
  return reason.length < REASON_MIN || reason.length > REASON_MAX
    ? `reason must be between ${REASON_MIN} and ${REASON_MAX} characters`
    : null;
}

// POST /api/safety/hide - a commissioner or co-commissioner (or platform admin)
// hides one abusive League-chat message league-wide, after supplying a reason
// (#441, AC2). Hiding is a reversible FLAG, not a delete: the original content
// stays on the row and leaves with it on retention/account deletion (ADR 0012, no
// retained copy). No route serves that content or the actor since the moderation
// history was retired (#2754); the columns remain. The
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
  // the content live (AC7, multi-client). Presenter viewers are not in the
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
      await deliverFeedEntry(io, { leagueId, event: 'chat:hidden', entry });
    } catch (error) {
      console.error('hide broadcast failed (message is hidden regardless)', error);
    }
  }
  return res.status(200).json({ ok: true });
});

module.exports = router;
