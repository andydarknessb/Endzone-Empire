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

// The stat line's fields in reading order: the legacy MatchupExtras.formatStatLine
// list (copied for the reason above), then the D/ST and IDP keys the live rows carry.
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
  ['sack', 'Sk'],
  ['interceptionReturn', 'INT'],
  ['fumbleRecovery', 'FR'],
  ['defensiveTD', 'TD'],
  ['safety', 'Sfty'],
  ['blockedKick', 'Blk'],
  ['pointsAllowed', 'PA'],
  ['yardsAllowed', 'YdA'],
  ['soloTackle', 'Solo'],
  ['assistedTackle', 'Ast'],
  ['idpSack', 'Sk'],
  ['idpInterception', 'INT'],
  ['forcedFumble', 'FF'],
  ['idpFumbleRecovery', 'FR'],
  ['passDeflection', 'PD'],
  ['qbHit', 'QBH'],
  ['tacklesForLoss', 'TFL'],
  ['idpSafety', 'Sfty'],
  ['idpDefensiveTD', 'TD'],
  ['twoPointReturn', '2pt Ret'],
];

// Shown at zero when present: a D/ST shutout reads "0 PA".
const ALWAYS_SHOW = new Set(['pointsAllowed']);

/**
 * Compact human summary of a starter's stat line ("289 pass yds · 2 pass TD ·
 * 1 INT"); '' when nothing is recorded. Zero and absent fields are dropped,
 * except a present pointsAllowed, which keeps its 0. Covers D/ST and IDP keys.
 * Parts are joined on a middot, the house separator, where the legacy line
 * used a bullet.
 */
export function formatStatLine(stats) {
  if (!stats) return '';
  const parts = [];
  for (const [key, unit] of STAT_LINE_FIELDS) {
    if (stats[key] == null) continue;
    const value = Number(stats[key]);
    if (value || ALWAYS_SHOW.has(key)) parts.push(`${value} ${unit}`);
  }
  return parts.join(' · ');
}

/** A points figure to one decimal, the way every score on the island reads. */
export function formatPoints(value) {
  return (Number(value) || 0).toFixed(1);
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
