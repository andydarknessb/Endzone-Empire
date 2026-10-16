/**
 * Public surface of the `bench-what-if` feature (ADR 0031, #900): the Bench what-if note on Matchup
 * Detail and the lineup note row that stands in for it while the viewer has an empty or Out starting
 * slot they can still fix. The page composes them from this index only, never from the component
 * files directly.
 *
 * The what-if's action is a react-router Link to the Lineup page with the swap named in the query
 * (`?swapOut=<id>&swapIn=<id>`); nothing is swapped here (ADR 0019: Lineup is the sole team
 * management surface). `swapLineupHref` builds that href so a page test can assert the same string
 * the note renders. The lineup note's decision is `lineupNote` in `entities/roster`; `LineupNote` lays
 * its result out.
 */
export { default, default as BenchWhatIf, swapLineupHref } from './ui/BenchWhatIf';
export { default as LineupNote } from './ui/LineupNote';
