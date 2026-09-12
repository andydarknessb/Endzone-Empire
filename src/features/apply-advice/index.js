/**
 * Public surface of the apply-advice feature (#1238). The Lineup page
 * imports from HERE only.
 *
 * Below-island edges (ADR 0031's 2026-09-11 #1269 amendment: "every
 * below-island edge is named with its reason in the slice's index
 * docblock"), all in `./model/useApplyAdvice.js`:
 *
 *   - `components/Snackbar/SnackbarProvider` (`useSnackbar`) - plumbing (a
 *     snackbar provider), exempt from the second-consumer count, reachable
 *     indefinitely.
 *   - `lib/httpFailure` (`readHttpFailure`) - plumbing (an HTTP failure
 *     reader), exempt from the second-consumer count, reachable
 *     indefinitely.
 *   - `hooks/useResilientLineupMutation` - a helper WITH domain meaning (the
 *     lineup write's optimistic-save/offline-queue/replay contract), reached
 *     here as its SECOND island consumer (`swap-players`' own
 *     `useSwapPlayers.js` is the first) - past the promotion threshold this
 *     amendment sets, and #1272 already tracks promoting it (to an entity or
 *     `shared/lib`, per that ticket's own list) rather than this ticket
 *     doing so out of scope.
 */
export { useApplyAdvice } from './model/useApplyAdvice';
