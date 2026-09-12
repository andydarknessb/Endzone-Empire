/**
 * Public surface of the swap-players feature (#1237). The Lineup page
 * imports from HERE only.
 *
 * `isEligibleMove` (#1240, formal review round 2) is the pure legality rule
 * `onRowClick`/`isEligibleTarget` enforce, exported standalone so the
 * player-decision-card widget can ask the same question about a move
 * before offering it, rather than keeping its own copy of the rule.
 */
export { useSwapPlayers, isEligibleMove } from './model/useSwapPlayers';
export { default as QuickPickMenu } from './ui/QuickPickMenu';
