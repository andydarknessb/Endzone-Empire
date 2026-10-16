/**
 * Public surface of the `pick-winner` feature (#1265, ADR 0038): one team's
 * row on a Pick'em GameCard. The widget composes it from here only, never
 * from the component file directly.
 *
 * `./ui/TeamPickButton.jsx` paints from `shared/ui/playselect` (ADR 0067 wave 2).
 *
 * `./lib/teamNames` (the team-code -> full-name lookup) is this slice's own
 * internal module, not a below-island edge.
 */
export { default } from './ui/TeamPickButton';
export { default as TeamPickButton } from './ui/TeamPickButton';
export { getTeamName } from './lib/teamNames';
