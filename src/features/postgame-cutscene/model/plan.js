import { teamStandingFromRow } from '../../../entities/standings';

/** Scenes that play; the rest collapse into one summary snackbar. */
export const MAX_SCENES = 3;

export const OUTCOME_WORD = Object.freeze({
  win: 'YOU WIN!',
  loss: 'GAME OVER.',
  tie: 'TIE GAME',
});

/**
 * The queue: the first MAX_SCENES items in the server order play, and the rest
 * are summarised by their W-L(-T) as one line ("2 MORE RESULTS: 1-1"). Ties are
 * appended only when there is at least one, the Record convention.
 */
export function planQueue(cutscenes) {
  const list = Array.isArray(cutscenes) ? cutscenes : [];
  const scenes = list.slice(0, MAX_SCENES);
  const rest = list.slice(MAX_SCENES);
  if (!rest.length) return { scenes, overflowText: null };
  const count = (outcome) => rest.filter((c) => c.outcome === outcome).length;
  const wins = count('win');
  const losses = count('loss');
  const ties = count('tie');
  const tally = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  return { scenes, overflowText: `${rest.length} MORE RESULTS: ${tally}` };
}

/** 1 -> "1ST", 2 -> "2ND", 11 -> "11TH", 23 -> "23RD". */
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}TH`;
  const suffix = { 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH';
  return `${n}${suffix}`;
}

/**
 * The Record line under the score: "RECORD 3-1 · 4TH OF 12" (the Record string is
 * the standings entity's), "PLAYOFF WEEK" in a playoff week, or null when the
 * server sent no standing.
 */
export function recordLine(item) {
  if (item.playoff) return 'PLAYOFF WEEK';
  if (!item.record) return null;
  const { record } = teamStandingFromRow(item.record);
  const place = item.standing ? ` · ${ordinal(item.standing.rank)} OF ${item.standing.of}` : '';
  return `RECORD ${record}${place}`;
}

/** The dialog name: the result as a sentence. */
export function resultSentence(item) {
  const me = item.me.name || 'You';
  const opp = item.opponent.name || 'your opponent';
  const score = `${item.me.score} to ${item.opponent.score}`;
  if (item.outcome === 'win') return `${me} beat ${opp}, ${score}`;
  if (item.outcome === 'loss') return `${me} lost to ${opp}, ${score}`;
  return `${me} tied ${opp}, ${score}`;
}
