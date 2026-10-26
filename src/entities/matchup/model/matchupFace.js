// Leaf modules, not the shared/lib barrel: the Home card in the initial chunk reaches this file.
import { finite } from '../../../shared/lib/numeric';
import { formatKickoff } from '../../../shared/lib/instantFormat';
import { teamNameLabel } from '../../../shared/lib/teamIdentity';
import { matchupBoard } from './matchupBoard';

/**
 * The one viewer-first Matchup face (ADR 0029 amendment, 2026-10-24): the
 * display rules the versus surfaces (the hero, the scoreboard strip, the
 * preview card, the Home card) used to re-derive, decided here once on top of
 * `matchupBoard`. Pure: no hooks, no fetch, no React.
 *
 *   { first: Side, second: Side, game: { chip, hasStarted, isLive, isFinal, settled,
 *     priced, winProbability, projectedWinProbability, firstShare, firstPct,
 *     secondPct, scoreLeader, leader, scoreGap, marginText, rawMarginText,
 *     projectedLeader, projectedMargin, projectedMarginText, sentence,
 *     resultLine, kickoffLabel } }
 *
 * - The sides are the board's, in its order (the viewer's Team first, else home),
 *   plus the page's `records` lookup and the printed figures.
 * - `priced` is both raw Expected finals present (the board nulls a settled
 *   side's). `winProbability` is started and priced, settled included (the
 *   hero's existing rule). A surface that draws a bar without a price (the
 *   strip) owns that policy itself: `resultLine == null && firstShare != null`.
 * - `firstShare`/`firstPct`/`secondPct` are `serverWinProbability` (the first
 *   side's share) when supplied, else the board's share, for any status the
 *   board prices; null otherwise.
 * - `scoreLeader` compares the raw scores; `rawMarginText` is the compact
 *   bar's raw-score words. `leader`, `scoreGap` and `marginText` compare the
 *   big figure: the score once started, else the Expected final.
 * - `sentence` is the result line once settled, the live sentence once
 *   started, else null. `counts` ({ first: { remaining, yet }, second })
 *   replaces the board's per-side counts for the sentence alone, never mixed;
 *   `countsPending` holds the remaining clause back.
 * - `projectedMarginText` is the pre-kickoff caption alone
 *   (`hasStarted === false`).
 */

const tenth = (value) => Math.round(value * 10) / 10;
const playersText = (n) => `${n} ${n === 1 ? 'player' : 'players'} remaining`;
const nameOf = (s) => s.name || (s.origin === 'home' ? 'Home' : 'Away');

// A page lookup keyed by Team id: an object or a function; a miss is null.
function lookup(table, teamId) {
  if (table == null || teamId == null) return null;
  const value = typeof table === 'function' ? table(teamId) : table[teamId];
  return value == null || value === '' ? null : value;
}

function percents(share) {
  if (share == null) return null;
  const firstShare = Math.max(0, Math.min(1, share));
  const firstPct = Math.round(firstShare * 100);
  return { firstShare, firstPct, secondPct: 100 - firstPct };
}

/** The projected gap as an absolute tenth and its leader, or nulls. */
function projection(firstFinal, secondFinal) {
  if (firstFinal == null || secondFinal == null) return { margin: null, leader: null };
  const margin = tenth(Math.abs(firstFinal - secondFinal));
  return {
    margin,
    leader: margin === 0 ? null : firstFinal > secondFinal ? 'first' : 'second',
  };
}

/** "Ahead now, projected to trail by 7.9 · they have 9 players remaining, 3 yet to play". */
function liveSentence(me, them, counts, countsPending) {
  const lead = tenth((finite(me.score) ?? 0) - (finite(them.score) ?? 0));
  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';
  const { margin, leader } = projection(finite(me.expectedFinal), finite(them.expectedFinal));
  let projected = null;
  if (margin != null) {
    projected = leader
      ? `projected to ${leader === 'first' ? 'lead' : 'trail'} by ${margin.toFixed(1)}`
      : 'projected to finish even';
  }
  const from = (key, side) => (counts ? counts[key] || {} : { remaining: side.playersRemaining, yet: side.yetToPlay });
  const mine = from('first', me);
  const theirs = from('second', them);
  const theirLeft = finite(theirs.remaining) ?? 0;
  const myLeft = finite(mine.remaining) ?? 0;
  let remaining = null;
  // countsPending: the page is still reading the lineups its counts come from, so the clause waits.
  if (countsPending) remaining = null;
  else if (theirLeft > 0) remaining = `they have ${playersText(theirLeft)}`;
  else if (myLeft > 0) remaining = `you have ${playersText(myLeft)}`;
  const yet = finite(theirLeft > 0 ? theirs.yet : myLeft > 0 ? mine.yet : null);
  if (remaining && yet != null) remaining += `, ${yet} yet to play`;
  return [projected ? `${now}, ${projected}` : now, remaining].filter(Boolean).join(' · ');
}

export function matchupFace(matchup, {
  viewerTeamId = null,
  records = null,
  counts = null,
  countsPending = false,
  serverWinProbability = null,
} = {}) {
  const m = matchup || {};
  const board = matchupBoard(matchup, viewerTeamId);
  const { hasStarted, settled } = board;
  const started = hasStarted === true;

  const side = (s) => {
    const expected = finite(s.expectedFinal);
    const expectedFinalLabel = expected == null ? null : expected.toFixed(1);
    const left = finite(s.playersRemaining);
    const record = lookup(records, s.teamId);
    return {
      ...s,
      record: record == null ? null : String(record),
      expectedFinal: s.expectedFinal ?? null,
      expectedFinalLabel,
      figure: started ? s.scoreLabel : expectedFinalLabel,
      remainingText: left == null ? null : playersText(left),
    };
  };
  const first = side(board.first);
  const second = side(board.second);

  // The raw sides: the board nulls a settled side's Expected final, the bar's rule does not.
  const priced = finite(m.home?.expectedFinal) != null && finite(m.away?.expectedFinal) != null;
  const boardShare = (board.winProbability ?? board.projectedWinProbability)?.first;
  const shares = percents(finite(serverWinProbability) ?? finite(boardShare));
  const winProbability = started && priced ? shares : null;
  const projectedWinProbability = hasStarted === false && priced && board.projectedWinProbability ? shares : null;

  const firstScore = finite(first.score);
  const secondScore = finite(second.score);
  const scoreLeader = firstScore == null || secondScore == null || firstScore === secondScore
    ? null
    : firstScore > secondScore ? 'first' : 'second';
  const rawLeader = scoreLeader === 'first' ? first : scoreLeader === 'second' ? second : null;
  const rawMarginText = firstScore == null || secondScore == null
    ? null
    : rawLeader ? `${teamNameLabel(rawLeader.name)} by ${tenth(Math.abs(firstScore - secondScore)).toFixed(1)}` : 'Tied';

  const gap = first.figure != null && second.figure != null
    ? tenth(Number(first.figure) - Number(second.figure))
    : null;
  const leader = gap == null || gap === 0 ? null : gap > 0 ? 'first' : 'second';
  const scoreGap = gap == null ? null : Math.abs(gap);
  const marginText = gap == null
    ? null
    : leader ? `${nameOf(leader === 'first' ? first : second)} by ${scoreGap.toFixed(1)}` : 'Tied';

  const { margin: projectedMargin, leader: projectedLeader } = projection(
    finite(first.expectedFinal),
    finite(second.expectedFinal),
  );
  let projectedMarginText = null;
  if (hasStarted === false && projectedMargin != null) {
    projectedMarginText = projectedLeader
      ? `Projected margin · ${nameOf(projectedLeader === 'first' ? first : second)} by ${projectedMargin.toFixed(1)}`
      : 'Projected margin · Even';
  }

  let sentence = null;
  if (settled) sentence = board.resultLine;
  else if (started) sentence = liveSentence(first, second, counts, countsPending);

  return {
    first,
    second,
    game: {
      chip: board.chip,
      hasStarted,
      isLive: board.isLive,
      isFinal: board.isFinal,
      settled,
      priced,
      winProbability,
      projectedWinProbability,
      firstShare: shares?.firstShare ?? null,
      firstPct: shares?.firstPct ?? null,
      secondPct: shares?.secondPct ?? null,
      scoreLeader,
      leader,
      scoreGap,
      marginText,
      rawMarginText,
      projectedLeader,
      projectedMargin,
      projectedMarginText,
      sentence,
      resultLine: board.resultLine,
      kickoffLabel: hasStarted === false ? formatKickoff(m.firstKickoffAt) : null,
    },
  };
}

export default matchupFace;
