/**
 * Public surface of the Season archive entity (ADR 0029: the FSD island's
 * entities layer, third slice after Matchup and Standings). The
 * `league-history` page imports a Season or the League's all-time Team
 * roster from HERE and never from an internal path; the entity itself never
 * imports a feature, a widget, a page or another entity - in particular,
 * never `entities/standings`. Formatting a Record is that entity's rule
 * alone (CONTEXT.md "Record"), so this module hands back the raw archived
 * standings row matching a champion, never a formatted Record or points
 * line, and leaves that join to the page, which ADR 0029 permits a page to
 * do directly for two sibling entities.
 *
 * Within the island it depends on nothing above it and reaches below the
 * island for three things, in the sense ADR 0029's 2026-09-05 amendment
 * allows (plumbing with no domain meaning, never a domain concept):
 *
 *   - `src/api/apiClient` - the plain fetch of `GET /api/league/:id/history`,
 *     the same module the Matchup entity reads (ADR 0004's admission: a
 *     league's history is read once per navigation, not the multi-mount
 *     shape `useResource` exists for).
 *   - `src/lib/teamProfileEvents` - the existing generic Team profile event
 *     helper, patching a live rename/avatar change into an unfrozen season's
 *     champions/standings/draftGrades and into an all-time row, matched by
 *     Team id.
 *   - `src/lib/httpFailure` - the existing HTTP failure-envelope reader every
 *     other entity/page hook already reads through.
 *
 * This docblock is the audit surface for the slice's below-island edges
 * until the boundary lint rule ADR 0020 names as a follow-up exists.
 * Everything else in this folder is internal.
 */
export {
  isPickemStandings,
  seasonView,
  isFrozenPickemSeason,
  allTimeRowFromRow,
  allTimeFromResponse,
} from './model/seasonArchiveModel';
export { useLeagueHistory } from './model/useLeagueHistory';
