/**
 * Public surface of the watch-player feature (#1312, ADR 0040 follow-up,
 * grill ruling Q6). The Decision card imports from HERE only; PlayerRow (via
 * PlayerManagement, the page building the action - the same "page builds the
 * action, widget renders it" shape `action`/`PlayerRow` already use) uses
 * only `useWatchPlayer` and builds its own compact row control from it, the
 * same way PlayerManagement builds `add-player`/`claim-player`'s row-level
 * one-tap actions today.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment: "Every below-island edge, of
 * either kind, is named with its reason in the slice's index docblock"),
 * all reached by `model/useWatchPlayer.js`:
 *   - `api/apiClient`: the app's plain HTTP client, not a domain concept.
 *   - `lib/httpFailure`: the shared refusal-envelope reader (#970's shape
 *     (b), a machine code plus a manager-facing message).
 *   - `components/Snackbar/SnackbarProvider` (`useSnackbar`): the app-wide
 *     toast, the same plumbing `add-player`/`claim-player` already reach for
 *     the identical reason.
 *   - `lib/a11y` (`MIN_TOUCH_TARGET_SX`, `ui/WatchPlayerAction.jsx`): the
 *     WCAG touch-target size constant, not a domain concept.
 */
export { useWatchPlayer } from './model/useWatchPlayer';
export { default as WatchPlayerAction } from './ui/WatchPlayerAction';
