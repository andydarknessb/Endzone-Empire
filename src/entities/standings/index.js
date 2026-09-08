/**
 * Public surface of the Standings entity (ADR 0029: the FSD island's entities
 * layer; this is its second slice, after the Matchup read model whose shape it
 * follows). Widgets, pages and the legacy `src/components` surfaces read a Team
 * standing from HERE and never from an internal path; the entity itself never
 * imports a feature, a widget, a page or another entity.
 *
 * It owns the standings read and computes a Team's Record ONCE. Three widgets
 * used to derive that record from raw rows and drifted apart (#958: a tie-less
 * Team read 3-1 on its matchup card and 3-1-0 in the standings table), so the
 * rule now has exactly one home, stated in CONTEXT.md under Record.
 *
 * Within the island it depends on nothing above it and reaches below the island
 * for one thing, in the sense ADR 0029's 2026-09-05 amendment allows (plumbing
 * with no domain meaning, never a domain concept):
 *
 *   - `src/hooks/useStandings` - the shared, week-keyed GET of
 *     `/api/scoring/league/:id/standings` (ADR 0004's resource cache). It is a
 *     URL bound to a cache key and a TTL, the same plumbing shape as the
 *     Matchup entity's `src/api/apiClient` edge, and reading it rather than
 *     re-issuing the request is what keeps the two League Dashboard cards on
 *     ONE request per navigation.
 *
 * The current week that read is keyed by is NOT reached for: it lives on the
 * raw League row, a League entity slice is not approved (#942 ruling R4), and
 * so the week is passed in by the caller. A Team identity entity is likewise
 * not created here; a Team standing carries a Team id and nothing else about
 * the Team, and each surface joins its own name and avatar.
 *
 * This docblock is the audit surface for the slice's below-island edges until
 * the boundary lint rule ADR 0020 names as a follow-up exists. Everything else
 * in this folder is internal.
 */
export {
  teamStandingFromRow,
  standingsFromResponse,
  recordsByTeamId,
  findTeamStanding,
} from './model/standingsModel';
export { useLeagueStandings } from './model/useLeagueStandings';
