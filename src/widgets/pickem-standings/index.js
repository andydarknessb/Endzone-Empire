/**
 * Public surface of the pickem-standings widget (#1266, ADR 0038). The page
 * composes it from here; everything else in this folder is the widget's own
 * internal slice.
 */
export { default } from './ui/StandingsTable';
// The model alone, for the League Dashboard's Play-select pick'em panel and standings screen (the
// page renders them; this widget keeps its own look for the Pick'em page until its wave).
export { usePickemStandingsTable } from './model/usePickemStandingsTable';
