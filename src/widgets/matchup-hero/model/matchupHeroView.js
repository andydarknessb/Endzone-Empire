import { matchupBoard } from '../../../entities/matchup';
import { finite, formatKickoff, initialsFor, teamNameLabel } from '../../../shared/lib';
// ordinal itself is shared/lib's contract now (#1272 Addendum); MatchupHero
// imports it directly rather than through this view model.

/**
 * The matchup-hero widget's view model, pure (ticket #893, ADR 0031). Given
 * the one Matchup shape from `entities/matchup` and the viewer's Team id, it
 * answers everything the card paints that is not a straight field read, so
 * the UI stays a presenter:
 *
 *   - the two sides in the board's order (`first`, `second`: the viewer's Team first, else
 *     home; spec #2402), each with `isViewer` matched on Team id (#112: the You tag follows
 *     the viewer's Team);
 *   - the status chip and `hasStarted`, straight from the entity's `matchupBoard`
 *     (ADR 0030: status is a server fact, never inferred here);
 *   - the per-side win probability percentages, rounded the way TwoSidedOdds rounds them
 *     (`firstPct` rounded, `secondPct` its complement), while live and settled (`winProbability`)
 *     and, before kickoff, from the projections alone (`projectedWinProbability`);
 *   - the one plain sentence under the bar: the board's `resultLine` once settled, and while live
 *     Critique 11's (spec #2334): "Ahead now, projected to trail by 7.9 · they have 9 players
 *     remaining, 3 yet to play". The counts are the server's `playersRemaining` and `yetToPlay` on each side of the
 *     Matchup; a page whose payload lacks `yetToPlay` passes `counts` ({ first: { remaining, yet }, second: ... },
 *     both from the entity helpers over the lineups) and the sentence reads that one source throughout, never
 *     a mix. With neither it stops at the remaining count. The opponent's count leads (the threat to the
 *     lead); with none left of theirs it names the viewer's own;
 *   - the kickoff line for a Matchup that has not started, formatted from `firstKickoffAt` (#892)
 *     with Intl, weekday short plus time, and the projected margin from the two Expected finals.
 *
 * `winProbability`, `sentence` and `kickoff` are each null when the status does not call for them:
 * a started Matchup has the first two and no kickoff, a scheduled one has the kickoff alone, and an
 * unknown status (null, or a value the entity does not know) has none, so the card asserts neither
 * state (the entity's `hasStarted === null` contract).
 */

const tenth = (value) => Math.round(value * 10) / 10;
const players = (n) => `${n} ${n === 1 ? 'player' : 'players'} remaining`;

const percents = (share) => {
  const clamped = Math.max(0, Math.min(1, Number(share) || 0));
  const firstPct = Math.round(clamped * 100);
  return { firstShare: clamped, firstPct, secondPct: 100 - firstPct };
};

/** "Ahead now, projected to trail by 7.9 · they have 9 players remaining, 3 yet to play". */
function liveSentence(me, them, counts, countsPending) {
  const lead = tenth((finite(me.score) ?? 0) - (finite(them.score) ?? 0));
  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';
  const myFinal = finite(me.expectedFinal);
  const theirFinal = finite(them.expectedFinal);
  let projection = null;
  if (myFinal != null && theirFinal != null) {
    const gap = tenth(myFinal - theirFinal);
    const by = Math.abs(gap).toFixed(1);
    if (gap > 0) projection = `projected to lead by ${by}`;
    else if (gap < 0) projection = `projected to trail by ${by}`;
    else projection = 'projected to finish even';
  }
  const from = (key, side) => (counts ? counts[key] : { remaining: side.playersRemaining, yet: side.yetToPlay });
  const mine = from('first', me);
  const theirs = from('second', them);
  const theirLeft = finite(theirs.remaining) ?? 0;
  const myLeft = finite(mine.remaining) ?? 0;
  let remaining = null;
  // countsPending: the page is still reading the lineups its counts come from, so the clause waits.
  if (countsPending) remaining = null;
  else if (theirLeft > 0) remaining = `they have ${players(theirLeft)}`;
  else if (myLeft > 0) remaining = `you have ${players(myLeft)}`;
  const yet = finite(theirLeft > 0 ? theirs.yet : myLeft > 0 ? mine.yet : null);
  if (remaining && yet != null) remaining += `, ${yet} yet to play`;
  return [projection ? `${now}, ${projection}` : now, remaining].filter(Boolean).join(' · ');
}

/**
 * The whole view for one hero card. `first` and `second` are the board's sides (the viewer's Team
 * first when it is one of the two, else home; the sentence reads from `first`'s perspective, which
 * for a non-participant is a degrade path: the page only renders this card for the viewer's own Matchup).
 */
export function matchupHeroView(matchup, viewerTeamId, { counts = null, countsPending = false } = {}) {
  const m = matchup || {};
  const board = matchupBoard(m, viewerTeamId);
  const { chip, hasStarted, first, second } = board;

  // The bar is the Endzone Forecast's: with an Expected final missing on either side there is nothing
  // to price it from, so no bar and no credit line rather than a 50/50 the forecast never made.
  // (The board nulls a settled side's expectedFinal, so the priced check reads the raw sides.)
  const firstFinal = finite(m[first.origin]?.expectedFinal);
  const secondFinal = finite(m[second.origin]?.expectedFinal);
  const priced = firstFinal != null && secondFinal != null;
  let winProbability = null;
  let sentence = null;
  if (hasStarted === true) {
    winProbability = priced ? percents(board.winProbability.first) : null;
    sentence = board.resultLine ?? liveSentence(first, second, counts, countsPending);
  }
  const projected = hasStarted === false && priced && board.projectedWinProbability
    ? percents(board.projectedWinProbability.first)
    : null;

  const firstScore = finite(first.score);
  const secondScore = finite(second.score);
  const leadSide = firstScore == null || secondScore == null || firstScore === secondScore
    ? null
    : firstScore > secondScore ? 'first' : 'second';
  const margin = firstFinal == null || secondFinal == null ? null : tenth(Math.abs(firstFinal - secondFinal));
  const projectedLeader = margin == null || margin === 0 ? null : firstFinal > secondFinal ? 'first' : 'second';

  return {
    first,
    second,
    scoreLabels: { first: first.scoreLabel, second: second.scoreLabel },
    hasStarted,
    isLive: board.isLive,
    leadSide,
    projectedLeader,
    projectedMargin: margin,
    chipLabel: chip?.label ?? null,
    chipVariant: chip?.variant ?? 'neutral',
    chipDot: chip?.dot ?? false,
    winProbability,
    projectedWinProbability: projected,
    sentence,
    kickoff: hasStarted === false ? formatKickoff(m.firstKickoffAt) : null,
  };
}

export default matchupHeroView;

/**
 * The compact scoreboard bar's props (RULINGS Critique 11 item 8, shared/ui/playselect CompactScoreboard)
 * for a started Matchup: home on the left, scores to a tenth, the leader and the margin in words
 * ("Darkness Falls by 2.1", "Tied" level). Null before kickoff, when there is no score to pin.
 */
export function compactScoreboardView(matchup, viewerTeamId = null) {
  const view = matchupHeroView(matchup, viewerTeamId);
  if (view.hasStarted !== true) return null;
  // The board already puts the viewer's side first: `a` is the left one.
  const { first, second } = view;
  const side = (x, label) => ({ abbr: initialsFor(x.name), name: teamNameLabel(x.name), score: label });
  const diff = Math.abs(tenth((finite(first.score) ?? 0) - (finite(second.score) ?? 0)));
  const leader = view.leadSide === 'first' ? first : second;
  return {
    a: side(first, view.scoreLabels.first),
    b: side(second, view.scoreLabels.second),
    lead: view.leadSide === 'first' ? 'a' : view.leadSide === 'second' ? 'b' : undefined,
    marginText: view.leadSide ? `${teamNameLabel(leader.name)} by ${diff.toFixed(1)}` : 'Tied',
    live: view.isLive,
  };
}
