/**
 * Public surface of the scoreboard-strip widget (the sticky scoreboard on
 * Matchup Detail, ADR 0031 / ticket #898). The page composes it from here;
 * everything else in this folder is the widget's own internal slice. The view
 * model is exported alongside the component so a page test can derive the
 * strings it expects from the same rules the strip renders by.
 */
export { default, default as ScoreboardStrip } from './ui/ScoreboardStrip';
export { scoreboardView } from './model/scoreboardView';
