/**
 * Public surface of the lineup-ledger widget (ADR 0020, #1237). The Lineup
 * page imports from HERE only, never an internal path.
 *
 * Below-island edges (ADR 0029's 2026-09-05 amendment: each named here with
 * its reason, plumbing with no domain meaning only) - formal review finding
 * ac1-widgets-reach-below-the-island:
 *   - `src/lib/a11y` (`MIN_TOUCH_TARGET_SX`, `ui/LineupLedger.jsx`): a WCAG
 *     touch-target size constant, not a domain concept.
 *   - `src/lib/nflTeamColors` (`ui/LedgerRow.jsx`): the static NFL team
 *     colour lookup, the same external-data allowlist entry the
 *     color-literals guard names.
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
