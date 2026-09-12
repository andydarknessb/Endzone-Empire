/**
 * Public surface of the `pick-winner` feature (#1265, ADR 0038): one team's
 * row on a Pick'em GameCard. The widget composes it from here only, never
 * from the component file directly.
 *
 * Below-island edges (ADR 0031's 2026-09-11 #1269 amendment: "every
 * below-island edge is named with its reason in the slice's index
 * docblock"), both in `./ui/TeamPickButton.jsx`:
 *
 *   - `src/lib/nflTeamColors` (`getTeamKit`) - the static NFL team colour
 *     lookup, the same external-data allowlist entry the color-literals
 *     guard names, plumbing with no domain meaning. Already past #1272's
 *     promotion threshold with three island consumers (lineup-ledger,
 *     player-decision-card, retro-scoreboard) before this PR; this is the
 *     fourth. Promoting it to `shared/lib` is not this ticket's call
 *     (`src/shared/lib` promotions are held by #1272), so it stays named
 *     here as known debt rather than acted on.
 *   - `src/lib/a11y` (`MIN_TOUCH_TARGET_SX`) - a WCAG touch-target size
 *     constant, not a domain concept.
 *
 * `./lib/teamNames` (the team-code -> full-name lookup) is this slice's own
 * internal module, not a below-island edge.
 */
export { default } from './ui/TeamPickButton';
export { default as TeamPickButton } from './ui/TeamPickButton';
