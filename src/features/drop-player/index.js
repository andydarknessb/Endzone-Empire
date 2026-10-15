/**
 * Public surface of the drop-player feature (#1237). The Lineup page and
 * PlayerManagement import from HERE only.
 *
 * Island edge: `useDropPlayer.js` imports `clearWeekMatchupsCache` from
 * `entities/matchup` (ADR 0031: a feature reads entities through their index),
 * so a landed drop refreshes the Expected final the Matchups cache carries.
 */
export { useDropPlayer } from './model/useDropPlayer';
export { default as DropConfirmationDialog } from './ui/DropConfirmationDialog';
