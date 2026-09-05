/**
 * Public surface of the `toggle-matchup-view` feature (ADR 0031, #903): the
 * Standard / Scoreboard toggle on the Matchup page and the hook that remembers
 * the choice per viewer. The page composes both from this index only, never
 * from a file inside.
 *
 *   - `ToggleMatchupView` (default): the segmented control.
 *   - `useMatchupView(viewerKey)`: `[view, setView]`, the view remembered in
 *     localStorage under a key that carries the viewer, so two managers on
 *     one browser never share it.
 *   - `matchupViewStorageKey(viewerKey)`: that key, so a page test can seed
 *     or read the same entry the hook does.
 *
 * Import edges: `shared/ui` through its index and nothing else.
 */
export { default, default as ToggleMatchupView } from './ui/ToggleMatchupView';
export {
  useMatchupView,
  matchupViewStorageKey,
  VIEW_STANDARD,
  VIEW_SCOREBOARD,
  VIEWS,
} from './model/useMatchupView';
