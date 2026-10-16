/**
 * Public surface of the matchup-preview widget (League Dashboard hero-right,
 * ADR 0020 / ticket #640). The page composes it from here; everything else in
 * this folder is the widget's own internal slice.
 */
export { default } from './ui/MatchupPreview';
// The model alone, for the League Dashboard's Play-select view of the same read (the page renders
// it; this widget keeps its own look for the Lineup page until its wave).
export { useMatchupPreview } from './model/useMatchupPreview';
