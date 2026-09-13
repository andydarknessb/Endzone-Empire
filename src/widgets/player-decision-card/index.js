/**
 * Public surface of the player-decision-card widget (#1240, ADR 0037; #1307,
 * ADR 0040 extends it with an availability `context`). The Lineup page,
 * WaiverWire and PlayerManagement import from HERE only.
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
 * (findings r1/r2/r3/r4/r5) and called out separately from the plumbing
 * edges above because it is a widget reading a FEATURE - a real edge worth
 * naming, though NOT a boundary violation (formal review round 3 finding
 * s5, correcting an earlier version of this note that claimed ADR 0020
 * reserves this for a page: it does not - ADR 0020's own sideways rule,
 * "Widgets do not import each other; a value two widgets both need is
 * passed down by the page, not shared sideways", is widget-to-WIDGET only,
 * and says nothing about widget-to-feature either way). Widget-to-feature
 * through the feature's own public index (the one rule ADR 0020 does state)
 * is established practice on this island already:
 * `commissioner-strip/ui/CommissionerStrip.jsx` imports
 * `features/advance-week`, `draft-grades/ui/DraftGrades.jsx` imports
 * `features/toggle-grade-details`, and `join-requests/ui/JoinRequests.jsx`
 * imports `features/decide-join-request` (round 4 finding t2, correcting an
 * earlier version of this list: `draft-order/ui/DraftOrderPanel.jsx`
 * imports `features/autodraft-toggle`'s internal `ui/AutodraftToggle.jsx`
 * path directly - that feature has no `index.js` at all, and ADR 0020
 * itself names `widgets/draft-order` as the slice that "predates the index
 * rule and does not follow it", so it is the ADR's own counter-example, not
 * a fourth instance of the pattern this note cites). This is a fourth
 * instance of that pattern, not an exception to one:
 *   - `src/features/swap-players` (`isEligibleMove`, `model/
 *     slotActions.js` and `ui/PlayerDecisionCard.jsx`): the pure legality
 *     rule `useSwapPlayers`' own `onRowClick`/`isEligibleTarget` enforce.
 *     Round 1 gave this card its own hand-enumerated locked/spent/best-ball
 *     conditions, and by round 2 that copy had already drifted three
 *     refusals behind the row path's own rule. The review's own remedy was
 *     to route through the one rule rather than patch a fourth
 *     enumeration, which is only possible by reading it from where it
 *     lives. `isEligibleMove` is exported as a plain pure function (no
 *     hook, no side effect, no `useSwapPlayers` state), so this widget
 *     reads it without pulling in the hook's own React/state surface.
 */
export { default as PlayerDecisionCard } from './ui/PlayerDecisionCard';
export { default } from './ui/PlayerDecisionCard';
