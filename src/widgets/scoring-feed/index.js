/**
 * Public surface of the scoring-feed widget (Game Center, ADR 0031 / ticket
 * #895): the live ticker strip and the Scoring feed card. The page composes
 * them from here; everything else in this folder is the widget's own internal
 * slice. `ScoringFeed` is the card (the default export of the ui module) under
 * the widget's name; `ScoringStrip` and `ScoringFeedList` are the two pieces
 * the ticket names. The model helpers are exported so the page can format a
 * play the same way the widget does (a toast, a document title) without
 * reaching into the slice.
 */
export { default as ScoringFeed, ScoringStrip, ScoringFeedList } from './ui/ScoringFeed';
export {
  IDLE_LINE,
  formatPoints,
  formatPlayTime,
  playsThisHour,
  playsThisHourLabel,
  sideKey,
} from './model/scoringFeedModel';
