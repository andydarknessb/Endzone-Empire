/**
 * Public surface of the player-decision-card widget (#1240, ADR 0037). The
 * Lineup page imports from HERE only.
 *
 * Below-island edges (ADR 0031's 2026-09-05 amendment, restated by the
 * 2026-09-11 amendment #1269: "every below-island edge, of either kind, is
 * named with its reason in the slice's index docblock") - formal review
 * finding f2:
 *   - `src/lib/a11y` (`MIN_TOUCH_TARGET_SX`, `ui/PlayerDecisionCard.jsx`): a
 *     WCAG touch-target size constant, not a domain concept - the same
 *     plumbing edge `widgets/lineup-ledger` already names for the same
 *     reason.
 *   - `src/lib/nflTeamColors` (`NFL_TEAM_COLORS`, `FALLBACK_KIT`,
 *     `ui/PlayerDecisionCard.jsx`): the static NFL team colour lookup, the
 *     same external-data allowlist entry the color-literals guard names -
 *     `widgets/lineup-ledger`'s own header avatar reaches the same module
 *     for the same reason.
 */
export { default as PlayerDecisionCard } from './ui/PlayerDecisionCard';
export { default } from './ui/PlayerDecisionCard';
