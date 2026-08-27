/**
 * Draft activity: the append-only, server-authored half of the combined feed
 * (#435, ADR 0012).
 *
 * ADR 0012 keeps League chat and Draft activity as SEPARATE record types that
 * are PRESENTED as one chronologically ordered feed over a single per-league
 * sequence. leagueFeed.js is the chat half (a read over chat_messages); this
 * module is the Draft-activity half. A Draft event (for #435, each committed
 * Pick) is written to `draft_activity` from the SAME transaction that commits
 * the state change, and SNAPSHOTS the facts it must preserve - Team, player,
 * position, NFL team, round, overall Pick number - so a later Pick correction
 * or reset (a mutation of draft_picks) can never silently rewrite what the feed
 * recorded happened. It is authored by the server, never by a manager, so it
 * carries Team identity and no account identifier (CONTEXT.md: Draft activity).
 *
 * WHY THE ROW NAMES NO feed_seq. The per-league position is allocated by a
 * BEFORE INSERT trigger on `draft_activity` (the migration), drawing from the
 * same `league_feed_sequences` counter chat uses. The boundary is the database,
 * not any one caller (#434's reasoning, ADR 0006's roster_tenures precedent):
 * appendPickActivity inserts the snapshot columns and the trigger fills the
 * sequence, so the authoritative position rides straight back on RETURNING and
 * one ordered read can interleave a Pick with the chat around it.
 */
const { TEAM_IDENTITY_FIELDS } = require('./teamIdentity');

/**
 * The feed-entry `type` that marks a Draft-activity entry, distinct from
 * leagueFeed's LEAGUE_CHAT. It is what lets one ordered read tell a Pick from
 * a message without inventing a fake chat author for a Draft event (ADR 0012).
 */
const DRAFT_ACTIVITY = 'draft_activity';

/**
 * The Draft-activity `kind`s. #435 records committed Picks (PICK); #437 adds the
 * rest of the authoritative lifecycle - Draft start, pause, resume, reset and
 * completion - as further kinds against the SAME per-league sequence, each
 * written from the same transaction that changes the shared Draft state.
 *
 * A lifecycle kind is NOT a Pick: it snapshots only the acting Team's identity
 * and the instant, never a player / round / Pick number, so the feed cannot
 * fabricate Pick facts an event never had (#437 AC5). Correction is deliberately
 * NOT here - it is a separate ticket, and #437's completion contract carries no
 * post-completion correction affordance.
 */
const PICK = 'pick';
const DRAFT_START = 'draft_start';
const PAUSE = 'pause';
const RESUME = 'resume';
const RESET = 'reset';
const COMPLETE = 'complete';

/**
 * The non-Pick lifecycle kinds appendLifecycleActivity accepts. PICK is
 * excluded on purpose: a Pick carries snapshot facts and goes through
 * appendPickActivity, so routing one here (which writes no Pick columns) would
 * silently drop them.
 */
const LIFECYCLE_KINDS = Object.freeze([DRAFT_START, PAUSE, RESUME, RESET, COMPLETE]);

/**
 * Shape one normalized `draft_activity` row as a typed feed entry. The row is
 * expected to carry the Team identity under the frozen TEAM_IDENTITY_FIELDS
 * keys (both the append path below and the combined read alias it that way) and
 * its `feed_seq`.
 *
 * `feed_seq` is a bigint, which pg returns as a string; `seq` is coerced to a
 * JSON number so the client can hand it straight back as `?before=<seq>`, the
 * same contract as a chat entry (leagueFeed.feedEntryOf).
 */
function activityEntryOf(row) {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  const base = {
    type: DRAFT_ACTIVITY,
    kind: row.kind,
    id: row.id,
    seq: Number(row.feed_seq),
    // Read Team identity back under the SAME frozen keys it is written as, so
    // the entry cannot drift from the wire contract (teamIdentity.js rule 1). A
    // missing value reads as null so the keys are always present - a lifecycle
    // event with no acting Team (a scheduler start, a completion transition)
    // reads back null here rather than an omitted field.
    [idField]: row[idField] ?? null,
    [nameField]: row[nameField] ?? null,
    created_at: row.created_at,
  };
  // A lifecycle event (#437) is not a Pick: it has no player, round, Pick number
  // or autopick fact, so it carries ONLY the base shape. Adding null Pick fields
  // here would fabricate a Pick shape for an event that never was one (#437 AC5)
  // and read as a broken Pick on the client.
  if (row.kind !== PICK) return base;
  return {
    ...base,
    // The snapshot the Pick entry must show without leaving the feed (#435 AC2).
    player: {
      id: row.player_id ?? null,
      name: row.player_name ?? null,
      position: row.player_position ?? null,
      nflTeam: row.player_nfl_team ?? null,
    },
    round: row.round,
    pickNumber: row.pick_number,
    isAutopick: row.is_autopick,
  };
}

/**
 * Append a committed Pick to the Draft-activity feed, INSIDE the caller's
 * transaction `client`, and return the typed feed entry for the live broadcast.
 *
 * Called from draft.service.draftPlayer between the `draft_picks` INSERT and
 * the COMMIT, so the activity and the Pick are one atomic act (#435 AC1): a
 * rolled-back Pick leaves no orphan activity, and a committed Pick always has
 * its entry. The row names no `feed_seq`; the trigger allocates it and it comes
 * back on RETURNING.
 *
 * `auto` is the one fact only the authoritative write knows - whether the clock
 * expired and the server made the Pick - so the entry can label an autopick
 * only when that is actually true (#435 AC3), never inferred later.
 */
async function appendPickActivity(client, { leagueId, team, player, round, pickNumber, auto = false }) {
  const result = await client.query(
    `INSERT INTO "draft_activity"
       ("league_id", "kind", "team_id", "team_name",
        "player_id", "player_name", "player_position", "player_nfl_team",
        "round", "pick_number", "is_autopick")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING "id", "feed_seq", "created_at"`,
    [
      leagueId,
      PICK,
      team.id,
      team.name,
      player.id,
      player.name,
      player.position,
      player.nfl_team,
      round,
      pickNumber,
      auto,
    ]
  );
  const inserted = result.rows[0];
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  return activityEntryOf({
    kind: PICK,
    id: inserted.id,
    feed_seq: inserted.feed_seq,
    created_at: inserted.created_at,
    [idField]: team.id,
    [nameField]: team.name,
    player_id: player.id,
    player_name: player.name,
    player_position: player.position,
    player_nfl_team: player.nfl_team,
    round,
    pick_number: pickNumber,
    is_autopick: auto,
  });
}

/**
 * Append a Draft LIFECYCLE event (Draft start, pause, resume, reset or
 * completion) to the Draft-activity feed, INSIDE the caller's transaction
 * `client`, and return the typed feed entry for the live broadcast (#437).
 *
 * Called from the same transaction that changes the shared Draft state - the
 * league UPDATE in startDraft, the pause/resume UPDATE, the reset transaction,
 * the completion side of draftPlayer - so the activity and the state change are
 * one atomic act (#437 AC1-AC4): a rolled-back transition leaves no orphan
 * activity, and a committed one always has its entry. The row names no
 * `feed_seq`; the trigger allocates it from the shared per-league sequence and
 * it rides back on RETURNING, exactly as a Pick does.
 *
 * `team` is the acting Team's identity, or null when there is no manager behind
 * the event - a scheduler auto-start (userId null), or a completion transition
 * that no one "did". A null actor is recorded as null, never fabricated (#437
 * AC5): the row's team_id / team_name are nullable for exactly these kinds.
 *
 * It writes NO Pick columns (player, round, Pick number, autopick): a lifecycle
 * event has none, and the migration relaxes those columns to NULL for non-Pick
 * kinds while a CHECK still holds them NOT NULL for a Pick. `kind` is validated
 * against LIFECYCLE_KINDS so a Pick can never slip through this path and lose
 * its snapshot facts.
 */
async function appendLifecycleActivity(client, { leagueId, kind, team = null }) {
  if (!LIFECYCLE_KINDS.includes(kind)) {
    throw new Error(
      `appendLifecycleActivity: "${kind}" is not a lifecycle kind (${LIFECYCLE_KINDS.join(', ')}); ` +
        'a Pick goes through appendPickActivity so its snapshot facts are not dropped'
    );
  }
  const result = await client.query(
    `INSERT INTO "draft_activity"
       ("league_id", "kind", "team_id", "team_name")
     VALUES ($1, $2, $3, $4)
     RETURNING "id", "feed_seq", "created_at"`,
    [leagueId, kind, team ? team.id : null, team ? team.name : null]
  );
  const inserted = result.rows[0];
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  return activityEntryOf({
    kind,
    id: inserted.id,
    feed_seq: inserted.feed_seq,
    created_at: inserted.created_at,
    [idField]: team ? team.id : null,
    [nameField]: team ? team.name : null,
  });
}

module.exports = {
  DRAFT_ACTIVITY,
  PICK,
  DRAFT_START,
  PAUSE,
  RESUME,
  RESET,
  COMPLETE,
  LIFECYCLE_KINDS,
  activityEntryOf,
  appendPickActivity,
  appendLifecycleActivity,
};
