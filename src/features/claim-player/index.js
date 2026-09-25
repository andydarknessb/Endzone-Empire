/**
 * Public surface of the claim-player feature (#1307). The Decision card
 * imports from HERE only.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment: "Every below-island edge, of
 * either kind, is named with its reason in the slice's index docblock"),
 * all reached by `model/useClaimPlayer.js`:
 *   - `api/apiClient`: the app's plain HTTP client, not a domain concept.
 *   - `lib/httpFailure`: the shared refusal-envelope reader (#970's shape
 *     (b), a machine code plus a manager-facing message).
 *   - `components/Snackbar/SnackbarProvider` (`useSnackbar`): the app-wide
 *     toast, the same plumbing `add-player` and `drop-player` reach for the
 *     identical reason.
 *
 * `ui/ClaimPlayerAction.jsx` also reads `MIN_TOUCH_TARGET_SX` from
 * `shared/lib` - ordinary island layering since #1272 promoted it out of
 * `lib/a11y`, not a below-island edge.
 */
export { useClaimPlayer } from './model/useClaimPlayer';
export { default as ClaimPlayerAction } from './ui/ClaimPlayerAction';
export { default as ClaimSheet } from './ui/ClaimSheet';
