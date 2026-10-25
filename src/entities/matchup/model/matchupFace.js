// Leaf modules, not the shared/lib barrel: the Home card in the initial chunk reaches this file.
import { finite } from '../../../shared/lib/numeric';
import { ordinal } from '../../../shared/lib/ordinal';
import { formatKickoff } from '../../../shared/lib/instantFormat';
import { matchupBoard } from './matchupBoard';

/**
 * The one viewer-first Matchup face (ADR 0029 amendment, 2026-10-24): the
 * display rules the versus surfaces (the hero, the scoreboard strip, the
 * preview card, the Home card) used to re-derive, decided here once on top of
 * `matchupBoard`. Pure: no hooks, no fetch, no React.
 *
 *   { first: Side, second: Side, game: { chip, hasStarted, isLive, isFinal, settled, priced,
 *     winProbability, projectedWinProbability, firstShare, firstPct, secondPct,
 *     scoreLeader, leader, scoreGap, marginText, projectedLeader, projectedMargin,
 *     projectedMarginText, sentence, resultLine, kickoffLabel } }
 *
 * - The sides are the board's, in its order (the viewer's Team first, else home), plus the
 *   page lookups (`records`, `ranks`, `cpuTeamIds`) and the printed figures.
 * - `priced` is both raw Expected finals present (the board nulls a settled side's), so a bar is
 *   never a 50/50 the forecast never made. `winProbability` is started and priced, settled
 *   included (the hero's existing rule). A surface that draws a bar without a price (the strip)
 *   owns that policy itself: `resultLine == null && firstShare != null`.
 * - `firstShare`/`firstPct`/`secondPct` are `serverWinProbability` (the first side's share)
 *   when supplied, else the board's share, for any status the board prices; null otherwise.
 * - `scoreLeader` compares the raw scores; `leader`, `scoreGap` and `marginText` compare the
 *   big figure: the score once started, else the Expected final.
 * - `sentence` is the result line once settled, the live sentence once started, else null.
 *   `counts` ({ first: { remaining, yet }, second }) replaces the board's per-side counts for
 *   the sentence alone, never mixed; `countsPending` holds the remaining clause back.
 * - `projectedMarginText` is the pre-kickoff caption alone (`hasStarted === false`).
 */

const tenth = (value) => Math.round(value * 10) / 10;
const playersText = (n) => `${n} ${n === 1 ? 'player' : 'players'} remaining`;
const startersText = (n) => `${n} ${n === 1 ? 'starter' : 'starters'} set to play`;
const nameOf = (s) => s.name || (s.origin === 'home' ? 'Home' : 'Away');

// A page lookup keyed by Team id: an object or a function; a miss (or no lookup) is null.
function lookup(table, teamId) {
  if (table == null || teamId == null) return null;
  const value = typeof table === 'function' ? table(teamId) : table[teamId];
  return value == null || value === '' ? null : value;
}

function hasTeam(ids, teamId) {
  if (ids == null || teamId == null) return false;
  return typeof ids.has === 'function' ? ids.has(teamId) : Array.isArray(ids) && ids.includes(teamId);
}

function percents(share) {
  if (share == null) return null;
  const firstShare = Math.max(0, Math.min(1, share));
  const firstPct = Math.round(firstShare * 100);
  return { firstShare, firstPct, secondPct: 100 - firstPct };
}

/** "Ahead now, projected to trail by 7.9 · they have 9 players remaining, 3 yet to play". */
function liveSentence(me, them, counts, countsPending) {
  const lead = tenth((finite(me.score) ?? 0) - (finite(them.score) ?? 0));
  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';
  const myFinal = finite(me.expectedFinal);
  const theirFinal = finite(them.expectedFinal);
  let projection = null;
  if (myFinal != null && theirFinal != null) {
    // Round the absolute gap, not the signed one: Math.round(-2.5) is -2, so the
    // signed form gives the two viewers different tenths on a half-tenth gap.
    const gap = tenth(Math.abs(myFinal - theirFinal));
    const by = gap.toFixed(1);
    if (myFinal > theirFinal) projection = `projected to lead by ${by}`;
    else if (myFinal < theirFinal) projection = `projected to trail by ${by}`;
    else projection = 'projected to finish even';
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
  return [projection ? `${now}, ${projection}` : now, remaining].filter(Boolean).join(' · ');
}

export function matchupFace(matchup, {
  viewerTeamId = null,
  records = null,
  ranks = null,
  cpuTeamIds = null,
  counts = null,
  countsPending = false,
  expectedFinalFor = null,
  serverWinProbability = null,
} = {}) {
  const m = matchup || {};
  const board = matchupBoard(matchup, viewerTeamId);
  const { hasStarted, settled } = board;
  const started = hasStarted === true;

  const side = (s) => {
    const rank = finite(lookup(ranks, s.teamId));
    const ord = ordinal(rank);
    let expectedFinal = null;
    if (!settled) expectedFinal = expectedFinalFor ? expectedFinalFor(s.teamId) ?? null : s.expectedFinal;
    const expected = finite(expectedFinal);
    const expectedFinalLabel = expected == null ? null : expected.toFixed(1);
    const left = finite(s.playersRemaining);
    const record = lookup(records, s.teamId);
    return {
      ...s,
      isCpu: hasTeam(cpuTeamIds, s.teamId),
      record: record == null ? null : String(record),
      rank,
      rankLabel: ord ? `${ord} in league` : null,
      expectedFinal,
      expectedFinalLabel,
      figure: started ? s.scoreLabel : expectedFinalLabel,
      figureLabel: settled ? 'Final score' : started ? 'Live score' : 'Proj',
      remainingText: left == null ? null : playersText(left),
      setToPlayText: left == null ? null : startersText(left),
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

  const gap = first.figure != null && second.figure != null
    ? tenth(Number(first.figure) - Number(second.figure))
    : null;
  const leader = gap == null || gap === 0 ? null : gap > 0 ? 'first' : 'second';
  const scoreGap = gap == null ? null : Math.abs(gap);
  let marginText = null;
  if (gap != null) marginText = leader ? `${nameOf(leader === 'first' ? first : second)} by ${scoreGap.toFixed(1)}` : 'Tied';

  const firstFinal = finite(first.expectedFinal);
  const secondFinal = finite(second.expectedFinal);
  // Round the absolute gap: the signed form makes Math.round(-2.5) differ from
  // Math.round(2.5), so the two viewers would see different tenths.
  const projectedMargin = firstFinal == null || secondFinal == null
    ? null
    : tenth(Math.abs(firstFinal - secondFinal));
  const projectedLeader = projectedMargin == null || projectedMargin === 0
    ? null
    : firstFinal > secondFinal ? 'first' : 'second';
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
