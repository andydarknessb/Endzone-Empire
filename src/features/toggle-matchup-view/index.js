/**
 * Public surface of the `toggle-matchup-view` feature (ADR 0031, #903): the
 * Standard / Scoreboard toggle on the Matchup page and the hook that remembers
 * the choice per viewer. The page composes both from this index only, never
 * from a file inside.
 *
 *   - `ToggleMatchupView` (default): the segmented control (forwards a ref
 *     to the group element).
 *   - `useMatchupView(userId)`: `[view, setView]`, the view remembered in
 *     localStorage under ONE stable key per viewer: the signed-in user's id,
 *     else the per-browser `anon` key, never the Team id (#903 review), so
 *     two signed-in managers on one browser never share it and the key never
 *     flips after first paint.
 *   - `matchupViewStorageKey(userId)`: that key, so a page test can seed or
 *     read the same entry the hook does; `viewerKeyFor(userId)` its viewer
 *     half and `ANON_VIEWER` the fallback.
 *
 * Import edges: `shared/ui` through its index and nothing else.
 */
export { default, default as ToggleMatchupView } from './ui/ToggleMatchupView';
export {
  useMatchupView,
  matchupViewStorageKey,
  viewerKeyFor,
  ANON_VIEWER,
  VIEW_STANDARD,
  VIEW_SCOREBOARD,
  VIEWS,
} from './model/useMatchupView';
