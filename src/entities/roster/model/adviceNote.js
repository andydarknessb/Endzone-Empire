import { formatPoints, isStartVerdictUnavailable, startVerdictReason } from '../../../shared/lib';

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
// A name's surname for the short form: a generational suffix is not one ("Marvin Harrison Jr." is Harrison).
const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const lastName = (name) => {
  const words = String(name).trim().split(/\s+/);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
  return words.pop();
};

// A benched-for starter the feed rules Out reads "(Out)" beside his name: the reason behind the move.
const outMark = (side) => (isStartVerdictUnavailable(side) && startVerdictReason(side) === 'out' ? ' (Out)' : '');

const gainOf = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The lineup advice sentence that names every move behind its gain (RULINGS Critique 8 and 11, spec
 * #2334): the dashboard's lead card and the Matchup lineup note read this one function. `advice` is
 * the start/sit advice wire's `suggestions` (swaps: a bench player for a starter, with `gain`) and
 * `openSlotFills` (a bench player into an empty starting slot, worth his projection).
 *
 *   one swap  "Start Jordan Addison for Puka Nacua · +23.0 pts"
 *   one fill  "Start Tyjae Spears at FLEX · +12.9 pts"
 *   several   "Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX"
 *
 * The gain is the sum of the moves' gains; a move without a figure is still named and adds nothing.
 * Null when the advice holds no move.
 */
export function adviceNote({ suggestions, openSlotFills } = {}) {
  const swaps = (Array.isArray(suggestions) ? suggestions : []).filter((s) => s?.suggested?.name && s?.current?.name);
  const fills = (Array.isArray(openSlotFills) ? openSlotFills : []).filter((f) => f?.name && f?.slot);
  const count = swaps.length + fills.length;
  if (count === 0) return null;
  const figures = [...swaps.map((s) => gainOf(s.gain)), ...fills.map((f) => gainOf(f.projection))];
  // A total that is not a gain (no figure, or a fill worth nothing) drops the "+x pts" part.
  const sum = figures.filter((g) => g != null).reduce((acc, g) => acc + g, 0);
  const total = sum > 0 ? ` · +${formatPoints(sum)} pts` : '';
  if (count === 1) {
    return swaps.length
      ? `Start ${swaps[0].suggested.name} for ${swaps[0].current.name}${outMark(swaps[0].current)}${total}`
      : `Start ${fills[0].name} at ${fills[0].slot}${total}`;
  }
  const parts = [
    ...swaps.map((s) => `${lastName(s.suggested.name)} in for ${s.current.name}${outMark(s.current)}`),
    ...fills.map((f) => `${lastName(f.name)} into the empty ${f.slot}`),
  ];
  return `${COUNT_WORDS[count] || count} moves${total}: ${parts.join(' · ')}`;
}

/** The advice's total gain in points (swaps' gains plus each fill's projection), or null with no figure. */
export function adviceGain({ suggestions, openSlotFills } = {}) {
  const figures = [
    ...(Array.isArray(suggestions) ? suggestions.map((s) => gainOf(s?.gain)) : []),
    ...(Array.isArray(openSlotFills) ? openSlotFills.map((f) => gainOf(f?.projection)) : []),
  ].filter((g) => g != null);
  return figures.length ? figures.reduce((sum, g) => sum + g, 0) : null;
}
