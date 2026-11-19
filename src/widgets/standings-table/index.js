/**
 * Public surface of the standings-table widget (League Dashboard main grid,
 * ADR 0020 / ticket #641). The page composes it from here; everything else in
 * this folder is the widget's own internal slice.
 */
export { default } from './ui/StandingsTable';
// The phone fold, shared with the pick'em table on the League Dashboard (#2930).
export { foldRows } from './model/foldRows';
