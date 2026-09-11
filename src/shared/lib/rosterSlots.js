// The roster-slots parse shared by every island reader of `league.roster_slots`
// (#1165, ADR 0031's second-island-consumer clause): the quick-actions widget
// model, the my-team-summary widget model and the Matchup page model each
// parsed this jsonb column on their own, two of them with the identical
// parse-and-tolerate body.

/**
 * `league.roster_slots` as an array, tolerating the shapes the column can
 * actually arrive in: jsonb normally arrives already parsed (an array), but a
 * string is tolerated defensively. Every other input - null, undefined, a
 * malformed string, a JSON string that parses to something other than an
 * array, a plain object, a number - reads as absent and returns `[]`. Never
 * throws.
 *
 * Applies no fallback of its own: an absent config is `[]` here, and each
 * caller keeps whatever fallback it already has (quick-actions reads `[]` as
 * "nothing to compare a fill against"; my-team-summary substitutes
 * `DEFAULT_ROSTER_SLOTS` so its footer denominator is never zero). Folding
 * either fallback into this helper would make it wrong for the other caller.
 */
export function parseRosterSlots(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
