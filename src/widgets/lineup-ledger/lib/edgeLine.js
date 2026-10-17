/**
 * The Edge line's kinds (CONTEXT.md's Edge line; ADR 0037; #1237 AC3). The six kinds
 * `server/services/lineup.service.js`'s `computeEdgeLine` emits, in its own priority order: `injury`,
 * `bench-above-starter`, `factor`, `pace`, `result`, `none`. `none` (and a null edge) carries no text and is
 * never rendered. See `./EdgeLineIcon.jsx` for the matching per-kind pictogram.
 *
 * Play-select (ADR 0067 wave 3, spec #2347 ruling 4): the kind is told by its pictogram and its words, never
 * by green or red. The injury line reads in Ink, every other kind in Dim.
 */
export const EDGE_LINE_KINDS = ['injury', 'bench-above-starter', 'factor', 'pace', 'result'];

/** The Edge line's ink: Ink for the injury designation, Dim for every other kind. */
export function edgeLineColor(kind) {
  return kind === 'injury' ? 'var(--ps-ink)' : 'var(--ps-dim)';
}

/**
 * The Edge line's DISPLAYED kind (#1241 AC3, ADR 0037 ticket 9): the
 * server's own `edge.kind` only refreshes on the next `GET
 * /api/team/lineup`, but `pace` and `result` are both about the game's own
 * progress, which the Realtime `live_game_states` row (read instantly,
 * `gameCell.js`'s own `kind`) already knows sooner. Only those two kinds
 * ever transition: `pace` while the Game cell reads `live`, `result` once it
 * reads `final`, in EITHER direction (a manager keeps a page open across a
 * kickoff and past the final whistle) - the cell must never show a stale
 * kind. Every higher-priority kind (`injury`, `bench-above-starter`,
 * `factor`) and `none` are facts about the player, not the game clock, so
 * they are never overridden here; a pre-kickoff or unrecognised Game cell
 * kind (`pre`, `unavailable`, `undefined`) also leaves `pace`/`result`
 * exactly as the server sent them; that combination should not arise in
 * practice (the server would not emit either kind before a game exists),
 * but the fallback is "trust the server", never a guess of its own.
 */
export function displayEdgeKind(kind, gameCellKind) {
  if (kind !== 'pace' && kind !== 'result') return kind;
  if (gameCellKind === 'live') return 'pace';
  if (gameCellKind === 'final') return 'result';
  return kind;
}
