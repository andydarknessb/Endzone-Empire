/**
 * Public surface of the pickem-standings widget (#1266, ADR 0038). The page
 * composes it from here; everything else in this folder is the widget's own
 * internal slice.
 */
export { default } from './ui/StandingsTable';
// The model alone, for the League Dashboard's own Play-select pick'em panel and standings screen
// (it renders them; the Pick'em page renders this widget).
export { usePickemStandingsTable } from './model/usePickemStandingsTable';
