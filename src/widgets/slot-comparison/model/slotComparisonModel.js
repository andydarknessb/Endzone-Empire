/**
 * Pure presentation rules for the slot-comparison widget (ADR 0031, #899).
 * No render, no fetch: the UI reads these so each rule has one home and a
 * table test, and the row shape they read is the Matchup detail starter row
 * the entity pairs (`pairStartersBySlot` in entities/matchup): id, name,
 * position, nfl_team, opponent, points, projected, availability, game_state,
 * game_clock, photo_url, stats.
 */

const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };

/**
 * The reason an Unavailable starter (CONTEXT.md, Roster and lineup) shows in
 * place of his projection, in the Lineup page's words; null for an available
 * row or one that carries no verdict. The same rule as the legacy
 * MatchupExtras.unavailableLabel, copied here rather than imported because the
 * legacy Matchup Detail page leaves the tree with #903 (ADR 0031) and a widget
 * never depends on a page.
 */
export function unavailableLabel(availability) {
  if (!availability || availability.available !== false) return null;
  return UNAVAILABLE_LABELS[availability.reason] || 'out';
}

// The stat line's fields in reading order, the same list and order as the
// legacy MatchupExtras.formatStatLine (copied for the reason above).
const STAT_LINE_FIELDS = [
  ['passingYards', 'pass yds'],
  ['passingTDs', 'pass TD'],
  ['interceptions', 'INT'],
  ['rushingYards', 'rush yds'],
  ['rushingTDs', 'rush TD'],
  ['receptions', 'rec'],
  ['receivingYards', 'rec yds'],
  ['receivingTDs', 'rec TD'],
  ['fieldGoal', 'FG'],
  ['extraPoint', 'XP'],
  ['fumbles', 'fum'],
];

/**
 * Compact human summary of a starter's stat line ("289 pass yds · 2 pass TD ·
 * 1 INT"); '' when nothing is recorded. Zero and absent fields are dropped.
 * Parts are joined on a middot, the house separator, where the legacy line
 * used a bullet.
 */
export function formatStatLine(stats) {
  if (!stats) return '';
  const parts = [];
  for (const [key, unit] of STAT_LINE_FIELDS) {
    const value = Number(stats[key]);
    if (value) parts.push(`${value} ${unit}`);
  }
  return parts.join(' · ');
}

// Position -> `pos-*` palette key for the headshot ring, the same map the
// app's PositionChip uses for its fills (QB red, RB green, WR blue, TE orange,
// K purple, DEF gray, individual defenders teal), so the ring and the avatar's
// own initials fill always agree. Unknown reads as the neutral DEF gray,
// exactly as PlayerAvatar's fallback fill does.
const POSITION_KEYS = {
  QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'def',
  DL: 'idp', DE: 'idp', DT: 'idp', NT: 'idp',
  LB: 'idp', ILB: 'idp', OLB: 'idp',
  DB: 'idp', CB: 'idp', S: 'idp', FS: 'idp', SS: 'idp',
};

/** The `pos-*` palette key for a starter's headshot ring. */
export function positionRingKey(position) {
  return POSITION_KEYS[String(position || '').toUpperCase()] || 'def';
}

// The three per-starter game states the wire speaks (#892; the Expected final
// producer's classification) and how each is shown: a live dot, a check, a
// clock. `kind` is the marker, `label` its accessible name and the legend's
// word for it.
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

/**
 * The pace of a starter's points against his projection: the filled share of
 * the bar (0..100) and whether he is at or ahead of it. Null when nothing was
 * projected (a null or non-numeric projection), so a bar is never drawn
 * against a number that does not exist. A zero projection reads as an empty,
 * never-ahead bar, as the design's paceBar does.
 */
export function paceView(points, projected) {
  if (projected == null) return null;
  const proj = Number(projected);
  if (!Number.isFinite(proj)) return null;
  const pts = Number(points) || 0;
  const ratio = proj > 0 ? Math.max(0, Math.min(1, pts / proj)) : 0;
  return { percent: Math.round(ratio * 100), ahead: proj > 0 && pts >= proj };
}

/** A points figure to one decimal, the way every score on the island reads. */
export function formatPoints(value) {
  return (Number(value) || 0).toFixed(1);
}

/**
 * The totals footer's two figures: each column's POINTS summed over the paired
 * rows (an empty side contributes nothing), to one decimal. Points, never
 * projections: the footer is the table's own arithmetic so it agrees with the
 * scoreboard, and a projection is a forecast, not a score.
 */
export function columnTotals(rows) {
  const sum = (side) => (rows || []).reduce(
    (acc, row) => acc + (row && row[side] ? Number(row[side].points) || 0 : 0),
    0
  );
  const round1 = (n) => Math.round(n * 10) / 10;
  return { home: round1(sum('home')), away: round1(sum('away')) };
}

/**
 * The second line of a starter cell: "NFL vs OPP · clock". The opponent is
 * the schedule's team code (no home/away marker rides the wire, ADR 0011), the
 * clock the live "Q3 6:42" string while in progress, else null. Each part is
 * dropped when absent, so a starter with no scheduled game reads as his team
 * alone and never "vs null".
 */
export function lineTwo(player) {
  const teamAndOpponent = [player.nfl_team, player.opponent ? `vs ${player.opponent}` : null]
    .filter(Boolean)
    .join(' ');
  return [teamAndOpponent, player.game_clock].filter(Boolean).join(' · ');
}
