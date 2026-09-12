import { injuryView } from '../../../shared/ui';

/**
 * The Decision card's injury tile (#1240 AC2: "the injury designation and
 * the feed's detail"). The designation's full name (Questionable/Doubtful/
 * Out/Injured reserve) is the same code-to-name map `InjuryTag` already
 * paints; the feed's own free-text detail is client-reachable in exactly one
 * place - the Ledger row's own Edge line, when its `kind` is `'injury'`
 * (CONTEXT.md's Edge line, priority 1: "the injury designation with its
 * detail"). Researched before writing this: the Decision card context
 * endpoint (`GET /api/team/lineup/:playerId/context`, #1236) carries only
 * `{ line, weather, usage }`, no separate detail field, so the Edge line's
 * own text is the one source rather than a guess or a new server field.
 *
 * Null for a healthy player (no designation at all) - the tile's own
 * null-source hide rule (issue's "Tiles whose source is null are hidden").
 * `detail` is null whenever the Edge line happens to be showing a different
 * kind (a bench player outprojecting the starter, a Factor, pace, a result)
 * - this never fabricates detail text the feed didn't supply.
 */
export function injuryTileView(entry) {
  const view = entry ? injuryView(entry.injuryStatus) : null;
  if (!view) return null;
  const detail = entry.edge && entry.edge.kind === 'injury' ? entry.edge.text : null;
  return { name: view.name, detail };
}

export default injuryTileView;
