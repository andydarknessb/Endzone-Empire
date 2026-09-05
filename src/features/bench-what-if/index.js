/**
 * Public surface of the `bench-what-if` feature (ADR 0031, #900): the Bench
 * what-if card on Matchup Detail. The page composes it from this index only,
 * never from the component file directly.
 *
 * The action is a react-router Link to the Lineup page with the swap named in
 * the query (`?swapOut=<id>&swapIn=<id>`); nothing is swapped here (ADR 0019:
 * Lineup is the sole team management surface). `swapLineupHref` builds that
 * href so a page test can assert the same string the card renders.
 */
export { default, default as BenchWhatIf, swapLineupHref } from './ui/BenchWhatIf';
