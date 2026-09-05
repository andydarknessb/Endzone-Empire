/**
 * Public surface of the nfl-game-strip widget (ADR 0031, ticket #901): the
 * strip of real NFL game tiles a Matchup spans, rendered from the
 * `live_game_states` rows the Matchup entity hands down as `model.games`
 * (#885). The Matchup Detail page composes it from here; everything else in
 * this folder is the widget's own internal slice.
 *
 * `gameTileView` is the pure per-row read (one live_game_states row in, the
 * tile's labels out) the presenter renders from; it is exported so a page test
 * can assert the shape a tile is built from without rendering the strip.
 */
export { default, default as NflGameStrip } from './ui/NflGameStrip';
export { gameTileView, formatKickoffTime } from './model/gameTileView';
