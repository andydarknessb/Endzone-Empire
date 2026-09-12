/**
 * Public surface of the Pickem standings entity (ADR 0029: the FSD island's
 * entities layer; ADR 0038: Pick'em joins the island). Widgets, features, the
 * `pickem` page and the legacy `src/components` surfaces read a standings row
 * from HERE and never from an internal path; the entity itself never imports
 * a feature, a widget, a page or another entity.
 *
 * It owns the standings read and the per-row derivations the table needs:
 * `accuracy` (correct / (correct + incorrect), a tied or pending game
 * crediting neither side), `bestWeek` (the highest-scoring week from a
 * team's `weekly` map) and `trend` (this week's rank against `previousRank`),
 * plus marking rows that share a rank as tied.
 *
 * Within the island it depends on nothing above it and reaches below the
 * island for one thing, in the sense ADR 0029's 2026-09-05 amendment allows
 * (plumbing with no domain meaning, never a domain concept):
 *
 *   - `src/hooks/useResource` and `src/lib/resourceCache` - the shared,
 *     TTL'd GET (ADR 0004's resource cache), the same plumbing shape as the
 *     Standings entity's `src/hooks/useStandings` edge and the Matchup
 *     entity's `src/api/apiClient` edge.
 *
 * This docblock is the audit surface for the slice's below-island edges until
 * the boundary lint rule ADR 0020 names as a follow-up exists. Everything
 * else in this folder is internal.
 */
export { accuracy, bestWeek, standingsModel, trend } from './model/standingsModel';
export { clearPickemStandingsCache, usePickemStandings } from './model/usePickemStandings';
