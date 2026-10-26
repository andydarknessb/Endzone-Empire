/**
 * Public surface of the trophy-room widget, composed by the League Dashboard (the completed
 * season's frame and the mid-season link row) and by the Trophy case page (ADR 0020; the second
 * island consumer is what moved it out of the dashboard's `ui/` folder).
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), each named with its reason:
 *   - `components/TrophyCase`: the award ordering helpers (`COLLAPSED_ROWS`, `isSeasonAward`,
 *     `orderAwards`) and the shared trophy glyph the row does not paint itself.
 */
export { default as TrophyRoom, TrophyLink } from './ui/TrophyRoom';
