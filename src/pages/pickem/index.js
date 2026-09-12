/**
 * Public surface of the Pick'em page slice (ADR 0020/0038, #1267). Mounted at
 * `/league/:leagueId/pickem` (App.jsx); the legacy `src/components/LeaguePickem`
 * it replaces is deleted in this same ticket, no shim.
 */
export { default } from './PickemPage';
