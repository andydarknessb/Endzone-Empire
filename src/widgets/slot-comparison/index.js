/**
 * Public surface of the slot-comparison widget (the Starters table of Matchup
 * Detail, ADR 0031 / ticket #899). The page composes it from here; everything
 * else in this folder is the widget's own internal slice. It takes the paired
 * starter rows the Matchup entity hands down and calls back to open a player
 * and to expand a row.
 */
export { default as SlotComparison } from './ui/SlotComparison';
export { default } from './ui/SlotComparison';
