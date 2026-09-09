/**
 * Public surface of the around-the-league widget (League Dashboard, #1103).
 * The page composes it from here, passing only the league id; the widget
 * owns its own reads (entities/matchup's `useLeagueMatchups`, plus the
 * league itself for the current week and the viewer's Team id). Everything
 * else in this folder is the widget's own internal slice.
 */
export { default, default as AroundTheLeague } from './ui/AroundTheLeague';
