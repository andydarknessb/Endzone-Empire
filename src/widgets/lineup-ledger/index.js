/**
 * Public surface of the lineup-ledger widget (ADR 0020, #1237). The Lineup
 * page imports from HERE only, never an internal path.
 *
 * `ui/LineupLedger.jsx` (`MIN_TOUCH_TARGET_SX`) and `ui/LedgerRow.jsx`
 * (`NFL_TEAM_COLORS`, `FALLBACK_KIT`) both read `shared/lib` - ordinary
 * island layering since #1272 promoted both past the below-island threshold
 * this docblock used to name them under (ADR 0029's 2026-09-05 amendment,
 * formal review finding ac1-widgets-reach-below-the-island).
 *
 * `ui/LedgerRow.jsx` also imports `PlayerNameLink` from `entities/player`
 * (#1311: moved out of `components/PlayerQuickView`, which is no longer a
 * below-island edge - an entity import is ordinary layering) - reused as-is
 * rather than rebuilt; the page owns the Decision card dialog itself (#1240,
 * replacing the Quick View this link used to open, on Lineup only) and hands
 * this widget only the `onOpenDecisionCard` callback.
 */
export { default } from './ui/LineupLedger';
export { buildLedgerSections } from './model/buildLedgerSections';
