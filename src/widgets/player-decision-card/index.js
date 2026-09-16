/**
 * Public surface of the player-decision-card widget (#1240, ADR 0037; #1307,
 * ADR 0040 extends it with an availability `context`; #1311 adds
 * `contextFromCard`; #1313 adds the `draft` context, not an Availability
 * state). The Lineup page, WaiverWire, PlayerManagement, TradeCenter,
 * TransactionLog, MatchupPage and now the Draft room (DraftBoard.jsx, in
 * place of its own `DraftQuickView`) import from HERE only.
 *
 * `ui/PlayerDecisionCard.jsx` reads `MIN_TOUCH_TARGET_SX` and
 * `NFL_TEAM_COLORS`/`FALLBACK_KIT` from `shared/lib` - ordinary island
 * layering since #1272 promoted both past the below-island threshold this
 * docblock used to name them under (ADR 0031's 2026-09-11 amendment #1269,
 * formal review finding f2, citation corrected at r7): the same two edges
 * `widgets/lineup-ledger` used to name for the same reason.
 *
 * ONE EDGE of a different kind, added in the formal review's round 2
 * (findings r1/r2/r3/r4/r5): it is a widget reading a FEATURE - a real edge
 * worth naming, though NOT a boundary violation (formal review round 3 finding
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
 *
 * A fifth instance, added with #1312 (ADR 0040 follow-up, grill ruling Q6):
 *   - `src/features/watch-player` (`WatchPlayerAction`, `ui/
 *     PlayerDecisionCard.jsx`): the Watch/Watching toggle, shown across
 *     every Availability context (never `draft`) - the same widget-reads-a-
 *     feature-through-its-own-public-index shape `add-player`/`claim-player`
 *     already establish two paragraphs up. The Draft room's own `draft`
 *     context never renders this button (DraftBoard.jsx always passes
 *     `context="draft"`), but the import stays static like its two
 *     neighbours: ADR 0014's Consequences require an endpoint entering the
 *     Draft room's closure to land with a harness entry or a declared
 *     exemption in the same PR (`tests/e2e/fixtures/draftRouteTable.js`),
 *     the same treatment `add-player`/`claim-player` already get there -
 *     never a mechanism, like a dynamic `import()`, that hides the edge from
 *     that guard instead of declaring it (formal review finding f1).
 */
export { default as PlayerDecisionCard } from './ui/PlayerDecisionCard';
export { default } from './ui/PlayerDecisionCard';

// #1512: the six pure context builders (`model/decisionContext.js`, beside
// `model/slotActions.js`) - the ONLY way a caller should build the `context`
// object below; the widget's public surface, same as the component itself.
export { myTeam, freeAgent, waivers, rostered, draft, fromCard } from './model/decisionContext';
