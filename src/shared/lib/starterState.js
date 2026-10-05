// The three per-starter game states the wire speaks (#892; the Expected final
// producer's classification) and how each is shown: a live dot, a check, a
// clock. `kind` is the marker, `label` its accessible name and the legend's
// word for it. Promoted from the slot-comparison widget model (#2010, ADR
// 0031's second-consumer rule) once the retro-scoreboard Lineups card drew
// the same markers.
const STATE_VIEWS = {
  in_progress: { kind: 'live', label: 'In progress' },
  final: { kind: 'final', label: 'Final' },
  scheduled: { kind: 'scheduled', label: 'Yet to play' },
};

/**
 * The state marker for a starter's `game_state`, or null for an unknown state
 * (null, absent, or a value the wire does not speak): no marker is drawn and
 * nothing is guessed, the same refusal the Matchup status view makes for an
 * unknown Matchup status (ADR 0030).
 */
export function starterStateView(gameState) {
  return STATE_VIEWS[gameState] || null;
}
