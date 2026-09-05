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
 *
 * Import edges, for the boundary audit ADR 0020 names: `shared/ui` (the
 * Tecmo sprite) through its index, and the sanctioned reaches below the
 * island: `src/api/apiClient` (the preference read), `src/lib/scoringEvents`
 * (the play classifier and label) and `src/lib/nflTeamColors` (the sprite
 * kits). It imports no widget, page or other feature.
 */
export { default, default as CelebrateTouchdown } from './ui/CelebrateTouchdown';
export { default as TecmoCutscene } from './ui/TecmoCutscene';
export { default as MatchupToasts, TOAST_MS } from './ui/MatchupToasts';
export { useCelebrateTouchdown } from './model/useCelebrateTouchdown';
