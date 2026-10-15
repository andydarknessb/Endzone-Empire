// The reason-to-label map for an Unavailable player (CONTEXT.md, Roster and
// lineup: "on bye", "out", "on IR" for bye | out | ir), shared by every reader
// of `availability.reason` (#1208). LineupScreen, the retro-scoreboard widget
// model and the slot-comparison widget model each carried the identical
// `{ bye: 'on bye', out: 'out', ir: 'on IR' }` object; this is the one copy.

const UNAVAILABLE_LABELS = {
  bye: 'on bye', out: 'out', ir: 'on IR', no_team: 'no team', practice_squad: 'practice squad',
  suspended: 'suspended',
  // ADR 0057: only an Upgrade's overPlayer carries it (a Backup quarterback valued at 0).
  backup: 'backup',
};

/**
 * The CONTEXT.md **Unavailable** label for a reason a player cannot play this
 * week: "on bye", "out", "on IR", "no team", "practice squad", "suspended" for
 * `bye | out | ir | no_team | practice_squad | suspended`. `null` for an unknown
 * or missing reason - never throws.
 *
 * Applies no fallback of its own: a reason-string reader (a projection week, a
 * claim Upgrade) keeps its own. A whole Roster entry reads its label, with the
 * one fallback word, from `entities/roster`'s `unavailableLabel` (#2140).
 *
 * Looks up an OWN property only, so a reason like `'constructor'` or
 * `'toString'` reads as unknown (null) rather than resolving an inherited
 * `Object.prototype` member.
 */
export function reasonLabel(reason) {
  return Object.prototype.hasOwnProperty.call(UNAVAILABLE_LABELS, reason)
    ? UNAVAILABLE_LABELS[reason]
    : null;
}
