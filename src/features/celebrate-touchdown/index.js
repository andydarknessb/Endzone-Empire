/**
 * Public surface of the `celebrate-touchdown` feature (ADR 0031, #903): the
 * touchdown cutscene queue, the toasts and the celebration preference that the
 * legacy Matchup Detail page used to keep inline, moved out as one feature.
 * The page composes it from this index only, never from a file inside.
 *
 *   - `useCelebrateTouchdown()` owns the state and returns `handlePlays`,
 *     which the page calls from the entity hook's `onScores` with the event's
 *     plays and the two starter id sets.
 *   - `CelebrateTouchdown` (default) renders the toasts and the current
 *     cutscene from what the hook returns.
 *   - `TecmoCutscene` and `MatchupToasts` are the two pieces themselves, for
 *     a surface that wants only one of them.
 *   - `CelebrationsCaption` (#903 review): the read-only "Celebrations on /
 *     off" line, fed from the hook's `celebrationsEnabled` state; the page
 *     slots it into the retro field's caption row.
 *
 * Import edges, for the boundary audit ADR 0020 names: `shared/ui` (the
 * Tecmo sprite) and `entities/matchup` (`playLabel` and, since #1137, the
 * side attribution `classifyPlays` reads), both through their index, and the
 * sanctioned reaches below the island: `src/api/apiClient` (the preference
 * read) and `src/lib/nflTeamColors` (the sprite kits). `classifyPlays` and
 * `MAX_CUTSCENES` are this feature's own private model
 * (`./model/classifyPlays`), not a below-island reach. It imports no widget,
 * page or other feature.
 */
export { default, default as CelebrateTouchdown } from './ui/CelebrateTouchdown';
export { default as TecmoCutscene } from './ui/TecmoCutscene';
export { default as MatchupToasts, TOAST_MS } from './ui/MatchupToasts';
export { default as CelebrationsCaption } from './ui/CelebrationsCaption';
export { useCelebrateTouchdown } from './model/useCelebrateTouchdown';
