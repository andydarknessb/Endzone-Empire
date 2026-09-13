/**
 * Public surface of the add-player feature (#1307). The Decision card
 * imports from HERE only.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment: "Every below-island edge, of
 * either kind, is named with its reason in the slice's index docblock"),
 * all reached by `model/useAddPlayer.js`:
 *   - `api/apiClient`: the app's plain HTTP client, not a domain concept.
 *   - `lib/httpFailure`: the shared refusal-envelope reader (#970's shape
 *     (b), a machine code plus a manager-facing message).
 *   - `components/Snackbar/SnackbarProvider` (`useSnackbar`): the app-wide
 *     toast, the same plumbing `features/drop-player` already reaches for
 *     the identical reason.
 *   - `lib/a11y` (`MIN_TOUCH_TARGET_SX`, `ui/AddPlayerAction.jsx`): the WCAG
 *     touch-target size constant, not a domain concept.
 */
export { useAddPlayer } from './model/useAddPlayer';
export { default as AddPlayerAction } from './ui/AddPlayerAction';
