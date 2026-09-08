/**
 * Public surface of the matchup-grid widget (Game Center's League matchups
 * region, ADR 0031 / ticket #894). The page composes it from here; everything
 * else in this folder is the widget's own internal slice.
 *
 * `MatchupGrid` takes the week's Matchups as entity models (entities/matchup),
 * the league id every card links under, and an optional `records` lookup from
 * Team id to a record string. The page builds that lookup with the standings
 * entity's `recordsByTeamId` (src/entities/standings, #959) and passes a record
 * down the way ADR 0031 rules (Team record does not join the wire); the widget
 * never formats a Record itself.
 */
export { default, default as MatchupGrid } from './ui/MatchupGrid';
