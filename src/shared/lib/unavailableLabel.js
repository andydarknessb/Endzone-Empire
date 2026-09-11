// The reason-to-label map for an Unavailable player (CONTEXT.md, Roster and
// lineup: "on bye", "out", "on IR" for bye | out | ir), shared by every reader
// of `availability.reason` (#1208). LineupScreen, the retro-scoreboard widget
// model and the slot-comparison widget model each carried the identical
// `{ bye: 'on bye', out: 'out', ir: 'on IR' }` object; this is the one copy.

const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };

/**
 * The CONTEXT.md **Unavailable** label for a reason a player cannot play this
 * week: "on bye", "out", "on IR" for `bye | out | ir`. `null` for an unknown
 * or missing reason - never throws.
 *
 * Applies no fallback of its own: each caller keeps whatever fallback it
 * already has for a reason this map does not know (LineupScreen's start/sit
 * panel reads "unavailable"; the retro-scoreboard and slot-comparison widget
 * models read "out"). Folding one of those fallbacks in here would make this
 * helper wrong for the other callers, the same reasoning `parseRosterSlots`
 * documents for its own callers.
 *
 * Looks up an OWN property only, so a reason like `'constructor'` or
 * `'toString'` reads as unknown (null) rather than resolving an inherited
 * `Object.prototype` member.
 */
export function unavailableLabel(reason) {
  return Object.prototype.hasOwnProperty.call(UNAVAILABLE_LABELS, reason)
    ? UNAVAILABLE_LABELS[reason]
    : null;
}
