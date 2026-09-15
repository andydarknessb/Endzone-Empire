/**
 * Public surface of the player-row widget (#1310, ADR 0040). PlayerManagement
 * and WaiverWire import from HERE only.
 *
 * BELOW-ISLAND EDGES (ADR 0031's amendment): `shared/ui` (`PositionChip`,
 * `PlayerAvatar`) and `shared/lib` (`formatPoints`, and since #1272 also
 * `MIN_TOUCH_TARGET_SX`, ordinary island layering rather than a below-island
 * edge) through their barrels - this is an island widget consumer, the same
 * door `player-decision-card` uses for the identical pieces; and
 * `utils/formatRelative`, the same plumbing edge `player-decision-card` and
 * WaiverWire's own clears-time column already name.
 *
 * `entities/player` (`WeeklyPointsBars`, `PlayerNameLink`) is a same-layer
 * entity read through its own public index (ADR 0029) - this widget reuses
 * the eighteen-week bars and the name-opens-the-Decision-card link rather
 * than a second copy of either.
 */
export { default as PlayerRow } from './ui/PlayerRow';
export { default } from './ui/PlayerRow';
export { weeksForSparkline } from './model/weeksAdapter';
// The shared desktop table header (#1310 formal review f2): PlayerManagement
// and WaiverWire's on-waivers table both render this instead of a
// hand-copied header row.
export { default as PlayerRowTableHead, playerRowColumnCount } from './ui/PlayerRowTableHead';
