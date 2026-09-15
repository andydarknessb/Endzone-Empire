/**
 * Public surface of the `pick-winner` feature (#1265, ADR 0038): one team's
 * row on a Pick'em GameCard. The widget composes it from here only, never
 * from the component file directly.
 *
 * `./ui/TeamPickButton.jsx` reads `getTeamKit` and `MIN_TOUCH_TARGET_SX` from
 * `shared/lib` - ordinary island layering since #1272 promoted both past the
 * below-island threshold this docblock used to name them under (ADR 0031's
 * 2026-09-11 #1269 amendment). `nflTeamColors` had already passed the
 * second-island-consumer threshold with three island consumers
 * (lineup-ledger, player-decision-card, retro-scoreboard) before this
 * feature became its fourth; `a11y` was promoted at the same time, alongside
 * the other five #1272 modules.
 *
 * `./lib/teamNames` (the team-code -> full-name lookup) is this slice's own
 * internal module, not a below-island edge.
 */
export { default } from './ui/TeamPickButton';
export { default as TeamPickButton } from './ui/TeamPickButton';
