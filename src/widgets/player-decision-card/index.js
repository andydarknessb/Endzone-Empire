/**
 * Public surface of the player-decision-card widget (#1240, ADR 0037). The
 * Lineup page imports from HERE only.
 *
 * Below-island edges (ADR 0031's 2026-09-11 amendment #1269: "every
 * below-island edge, of either kind, is named with its reason in the
 * slice's index docblock") - formal review finding f2, citation corrected
 * at r7 (the amendment is dated 2026-09-11, not 2026-09-05 - that is ADR
 * 0031's own acceptance date, and the 2026-09-05 amendment belongs to ADR
 * 0029, not this one):
 *   - `src/lib/a11y` (`MIN_TOUCH_TARGET_SX`, `ui/PlayerDecisionCard.jsx`): a
 *     WCAG touch-target size constant, not a domain concept - the same
 *     plumbing edge `widgets/lineup-ledger` already names for the same
 *     reason.
 *   - `src/lib/nflTeamColors` (`NFL_TEAM_COLORS`, `FALLBACK_KIT`,
 *     `ui/PlayerDecisionCard.jsx`): the static NFL team colour lookup, the
 *     same external-data allowlist entry the color-literals guard names -
 *     `widgets/lineup-ledger`'s own header avatar reaches the same module
 *     for the same reason.
 *
 * ONE MORE EDGE, of a different kind, added in the formal review's round 2
 * (findings r1/r2/r3/r4/r5) and called out separately because it is not a
 * plumbing exception under the amendment above - it is a widget reading a
 * FEATURE, which ADR 0020 otherwise reserves for a page to compose:
 *   - `src/features/swap-players` (`isEligibleMove`, `model/
 *     slotActions.js` and `ui/PlayerDecisionCard.jsx`): the pure legality
 *     rule `useSwapPlayers`' own `onRowClick`/`isEligibleTarget` enforce.
 *     Round 1 gave this card its own hand-enumerated locked/spent/best-ball
 *     conditions, and by round 2 that copy had already drifted three
 *     refusals behind the row path's own rule. The review's own remedy was
 *     to route through the one rule rather than patch a fourth
 *     enumeration, which is only possible by reading it from where it
 *     lives. `isEligibleMove` is exported as a plain pure function (no
 *     hook, no side effect, no `useSwapPlayers` state) precisely so a
 *     widget can read it without pulling in the hook's own React/state
 *     surface - but the edge is still real, and if that boundary should
 *     hold harder than this, the fix is moving `isEligibleMove` to
 *     `entities/roster` or `shared/lib` (either is fed by the same
 *     roster/eligibility facts already there) rather than importing a
 *     feature, not reverting to a second, drifting copy of the rule.
 */
export { default as PlayerDecisionCard } from './ui/PlayerDecisionCard';
export { default } from './ui/PlayerDecisionCard';
