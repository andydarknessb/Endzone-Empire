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
 *     `useSwapPlayers.js` is the first), so the promotion threshold fires on
 *     THIS PR. #1272 as cut lists this module as staying below the island
 *     (it had one consumer when #1269 measured it) and excludes it; a scope
 *     correction is raised on #1272 (comment of 2026-09-12T01:11Z), and
 *     whether this hook is plumbing or domain-meaning is Cory's call, not
 *     this ticket's.
 */
export { useApplyAdvice } from './model/useApplyAdvice';
