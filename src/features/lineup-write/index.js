/**
 * Public surface of the lineup-write feature (spec #2042): the one Lineup write
 * (`useLineupWrite`'s `submit(moves)`) and the two move-plan builders on it,
 * swap-players (#1237) and apply-advice (#1238). The Lineup page imports from
 * HERE only.
 *
 * `isEligibleMove` (#1240) is the boolean face of `entities/roster`'s
 * `moveLegality`, the one client legality rule `onRowClick`/`isEligibleTarget`
 * enforce, exported so the player-decision-card widget asks the same question
 * about a move before offering it, rather than keeping its own copy.
 *
 * Below-island edges (ADR 0031's 2026-09-11 #1269 amendment: "every
 * below-island edge is named with its reason in the slice's index docblock"):
 *
 *   - `components/Snackbar/SnackbarProvider` (`useSnackbar`) - plumbing (a
 *     snackbar provider), exempt from the second-consumer count, reachable
 *     indefinitely. Read by `useLineupWrite.js` and `useSwapPlayers.js`.
 *   - `lib/httpFailure` (`readHttpFailure`) - plumbing (an HTTP failure
 *     reader), exempt from the second-consumer count, reachable
 *     indefinitely. Read by `useLineupWrite.js`.
 *   - `hooks/useResilientLineupMutation` - a helper WITH domain meaning (the
 *     lineup write's optimistic-save/offline-queue/replay contract). Its one
 *     island consumer is now `useLineupWrite.js` (the two hooks that each
 *     subscribed to it merged into this slice); whether it is plumbing or
 *     domain-meaning is Cory's call (#1272), not this ticket's.
 *
 * Island edge: `useLineupWrite.js` imports `clearWeekMatchupsCache` from
 * `entities/matchup` (ADR 0031: a feature reads entities through their index),
 * so a save that lands refreshes the Expected final the Matchups cache carries.
 */
export { useLineupWrite } from './model/useLineupWrite';
export { useSwapPlayers, isEligibleMove } from './model/useSwapPlayers';
export { useApplyAdvice } from './model/useApplyAdvice';
export { describeOutcome } from './model/describeOutcome';
export { default as QuickPickMenu } from './ui/QuickPickMenu';
