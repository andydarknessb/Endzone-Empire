/**
 * Public surface of the Matchup entity (ADR 0029: the FSD island's entities
 * layer, first slice). Widgets, pages and the legacy `src/components` surfaces
 * import a Matchup from HERE and never from an internal path; the entity itself
 * never imports a feature, a widget or a page. #1207 opened a temporary
 * exception to "never another entity": `matchupModel.js` re-exported
 * `pairStartersBySlot` from `entities/roster` for one release (#1198 R1's
 * move), because `useMatchup.js` still paired starters itself. #1210 closed
 * it: the pairing moved up to `pages/matchup/model/useMatchupPage.js` (ADR
 * 0029 permits a page importing an entity directly), `useMatchup.js` returns
 * the two sides' unpaired starters instead, and nothing under this entity
 * imports `entities/roster` any more. Within the island it otherwise
 * depends on `shared` (the score feed, `shared/lib`); it also reaches the
 * legacy tree below the island for three things the brief and precedent settle -
 * the existing generic Team profile helper (`src/lib/teamProfileEvents`, which
 * the issue mandated), a plain fetch (`src/api/apiClient`, the same module
 * `shared/lib/useEndpoint` reads) and, since #1872, the shared cached read
 * (`src/hooks/useResource`, ADR 0004) behind `useWeekMatchups`, and, since #1881, the
 * cache store's `invalidate` (`src/lib/resourceCache`) behind `clearWeekMatchupsCache`,
 * which the lineup-write and drop-player features call when a save or roster
 * change lands (ADR 0031: a feature reads an entity through its index) - plus, since #885, the anon Supabase client
 * (`src/api/supabaseClient`) for the shared live game state subscription used
 * by Matchup Detail and Game Center. Everything else in this folder is
 * internal.
 *
 * Since #1137 (ADR 0031's below-island clause) the entity also models the
 * Scoring play: `playsFromScoreEvent`, `matchupPlaySide` and `playLabel`
 * (model/play.js), the domain shape that used to live below the island at
 * `src/lib/scoringEvents`. Both hooks' `onScores` callback receives modelled
 * plays now, never the raw wire array.
 */
export {
  matchupFromListRow,
  matchupFromDetailBody,
  applyScoreEvent,
  applyIdentityPatch,
  matchupStatusView,
  matchupResultLine,
  viewerMatchupOf,
} from './model/matchupModel';
export {
  playsFromScoreEvent, deltasFor, matchupPlaySide, playLabel, formatSignedPoints,
} from './model/play';
export { useLeagueMatchups } from './model/useLeagueMatchups';
export { useWeekMatchups, clearWeekMatchupsCache } from './model/useWeekMatchups';
export { useMatchup } from './model/useMatchup';
export { useLiveGameStates } from './model/useLiveGameStates';
