/**
 * Public surface of the Pick'em page slice (ADR 0020/0038, #1267). Mounted at
 * `/league/:leagueId/pickem` (App.jsx); the legacy page component under
 * `src/components` that it replaces is deleted in this same ticket, no shim.
 */
export { default } from './PickemPage';
