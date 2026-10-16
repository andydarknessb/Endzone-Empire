import { matchupPhase } from './matchupBoard';

/**
 * True when `week` has at least one Matchup and every one of them is settled: `final` true, or a status
 * of 'played' or 'final'. The server marks a finished game 'played' until the commissioner advances
 * (only advancing writes 'final'), so 'played' is the state in which Advance week must open. The control
 * reads this: a week with a game still to play, or no games read yet, is not ready to advance.
 *
 * @param {Array<{ week: number|string|null, final?: boolean, status?: string|null }>} matchups
 * @param {number|string} week
 */
export function allWeekSettled(matchups, week) {
  const mine = (Array.isArray(matchups) ? matchups : []).filter((m) => Number(m.week) === Number(week));
  return mine.length > 0 && mine.every((m) => m.final === true || matchupPhase(m.status).settled);
}
