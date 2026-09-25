/**
 * Public surface of the manage-claim feature (#1616): Edit and Cancel (with
 * Undo) on a pending waiver claim.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), all reached by
 * `model/useManageClaim.js`: `api/apiClient` (the plain HTTP client),
 * `lib/httpFailure` (the shared refusal-envelope reader) and
 * `components/Snackbar/SnackbarProvider` (the app-wide toast that carries
 * Undo), the same three edges `claim-player` names.
 */
export { useManageClaim } from './model/useManageClaim';
