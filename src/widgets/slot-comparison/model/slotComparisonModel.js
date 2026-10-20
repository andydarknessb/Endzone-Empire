/**
 * Pure presentation rules for the slot-comparison widget (ADR 0031, #899).
 * No render, no fetch: the UI reads these so each rule has one home and a
 * table test, and the row shape they read is the Matchup detail starter row
 * the Matchup page model pairs (`pairStartersBySlot`, from `entities/roster`;
 * #1210 moved the pairing out of `entities/matchup`): id, name, position,
 * nfl_team, opponent, points, projected, availability, game_state, game_clock,
 * photo_url, stats.
 */

import { starterStateView } from '../../../shared/lib';

// The state marker map lives in shared/lib (#2010); re-exported so this
// widget's UI and tests keep one import path.
export { starterStateView };

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

/** A points figure to one decimal, the way every score on the island reads. */
export function formatPoints(value) {
  return (Number(value) || 0).toFixed(1);
}

/**
 * The game line of a starter cell: "NFL vs OPP · clock". The opponent is
 * the schedule's team code (no home/away marker rides the wire, ADR 0011), the
 * clock the live "Q3 6:42" string while in progress, else null; the clock keeps
 * its space non-breaking so a wrapped line never splits "Q4" from "12:45". A
 * starter the server marks on bye (availability reason 'bye') reads "DET · Bye"
 * once his game has started (`notStarted` false); before that his figure says
 * "on bye" and the line stays the team alone (#2395). No team at all reads
 * empty, never "vs null".
 */
export function lineTwo(player, notStarted = false) {
  const bye = player.availability?.reason === 'bye' && !notStarted ? 'Bye' : null;
  const teamAndOpponent = [player.nfl_team, player.opponent ? `vs ${player.opponent}` : null]
    .filter(Boolean)
    .join(' ');
  const clock = player.game_clock ? player.game_clock.replace(' ', ' ') : null;
  return [teamAndOpponent, bye, clock].filter(Boolean).join(' · ');
}
