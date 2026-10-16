/**
 * True when `week` has at least one Matchup and every one of them is final
 * (`final` true or `status` 'final'). The Advance week control reads it: a week
 * with a game still to settle, or no games read yet, is not ready to advance.
 *
 * @param {Array<{ week: number|string|null, final?: boolean, status?: string|null }>} matchups
 * @param {number|string} week
 */
export function allWeekFinal(matchups, week) {
  const mine = (Array.isArray(matchups) ? matchups : []).filter((m) => Number(m.week) === Number(week));
  return mine.length > 0 && mine.every((m) => m.final === true || m.status === 'final');
}
