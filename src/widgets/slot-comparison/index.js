/**
 * Public surface of the slot-comparison widget (the Starters table of Matchup
 * Detail, ADR 0031 / ticket #899). The page composes it from here; everything
 * else in this folder is the widget's own internal slice. It takes the paired
 * starter rows the Matchup entity hands down and calls back to open a player
 * and to expand a row.
 *
 * `unavailableLabel` is the one rule for what an Unavailable player shows in
 * place of his projection ("on bye", "out", "on IR"); the Matchup page's
 * bench card reads it from here (#903) so the Starters table and the benches
 * beneath it speak the same words.
 */
export { default as SlotComparison } from './ui/SlotComparison';
export { default } from './ui/SlotComparison';
export { unavailableLabel } from './model/slotComparisonModel';
