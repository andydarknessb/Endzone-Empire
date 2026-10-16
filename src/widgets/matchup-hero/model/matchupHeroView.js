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
 *   - which side is the viewer's (`viewerSide`), matched on Team id and never
 *     on home/away (#112: the You tag follows the viewer's Team, the layout
 *     stays home-left / away-right);
 *   - the status chip and `hasStarted`, straight from the entity's `matchupBoard`
 *     (ADR 0030: status is a server fact, never inferred here);
 *   - the per-side win probability percentages, rounded the way TwoSidedOdds rounds them
 *     (`homePct` rounded, `awayPct` its complement), while live and settled (`winProbability`)
 *     and, before kickoff, from the projections alone (`projectedWinProbability`);
 *   - the one plain sentence under the bar: the board's `resultLine` once settled, and while live
 *     Critique 11's (spec #2334): "Ahead now, projected to trail by 7.9 · they have 9 players
 *     remaining, 3 yet to play". The counts are the server's `playersRemaining` and `yetToPlay` on each side of the
 *     Matchup; a page whose payload lacks `yetToPlay` passes `counts` ({ home: { remaining, yet }, away: ... },
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
  const homePct = Math.round(clamped * 100);
  return { homeShare: clamped, homePct, awayPct: 100 - homePct };
};

/** "Ahead now, projected to trail by 7.9 · they have 9 players remaining, 3 yet to play". */
function liveSentence(m, viewerSide, counts) {
  const meKey = viewerSide === 'away' ? 'away' : 'home';
  const themKey = meKey === 'home' ? 'away' : 'home';
  const me = m[meKey] || {};
  const them = m[themKey] || {};
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
  const mine = from(meKey, me);
  const theirs = from(themKey, them);
  const theirLeft = finite(theirs.remaining) ?? 0;
  const myLeft = finite(mine.remaining) ?? 0;
  let remaining = null;
  if (theirLeft > 0) remaining = `they have ${players(theirLeft)}`;
  else if (myLeft > 0) remaining = `you have ${players(myLeft)}`;
  const yet = finite(theirLeft > 0 ? theirs.yet : myLeft > 0 ? mine.yet : null);
  if (remaining && yet != null) remaining += `, ${yet} yet to play`;
  return [projection ? `${now}, ${projection}` : now, remaining].filter(Boolean).join(' · ');
}

/**
 * The whole view for one hero card. `viewerSide` is 'home' or 'away' when the viewer's Team is one
 * of the two, else null (no tag, and the sentence falls back to the home side's perspective; the
 * page only renders this card for the viewer's own Matchup, so that fallback is a degrade path).
 */
export function matchupHeroView(matchup, viewerTeamId, { counts = null } = {}) {
  const m = matchup || {};
  const board = matchupBoard(m, viewerTeamId);
  const { chip, hasStarted, viewerSide } = board;

  let winProbability = null;
  let sentence = null;
  if (hasStarted === true) {
    winProbability = percents(board.winProbability.home);
    sentence = board.resultLine ?? liveSentence(m, viewerSide, counts);
  }
  const projected = hasStarted === false && board.projectedWinProbability
    ? percents(board.projectedWinProbability.home)
    : null;

  const homeScore = finite(m.home?.score);
  const awayScore = finite(m.away?.score);
  const leadSide = homeScore == null || awayScore == null || homeScore === awayScore
    ? null
    : homeScore > awayScore ? 'home' : 'away';
  const homeFinal = finite(m.home?.expectedFinal);
  const awayFinal = finite(m.away?.expectedFinal);
  const margin = homeFinal == null || awayFinal == null ? null : tenth(Math.abs(homeFinal - awayFinal));
  const projectedLeader = margin == null || margin === 0 ? null : homeFinal > awayFinal ? 'home' : 'away';

  return {
    viewerSide,
    scoreLabels: { home: board.home.scoreLabel, away: board.away.scoreLabel },
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
export function compactScoreboardView(matchup) {
  const view = matchupHeroView(matchup, null);
  if (view.hasStarted !== true) return null;
  const home = matchup.home || {};
  const away = matchup.away || {};
  const side = (s, label) => ({ abbr: initialsFor(s.name), name: teamNameLabel(s.name), score: label });
  const diff = Math.abs(tenth((finite(home.score) ?? 0) - (finite(away.score) ?? 0)));
  const leader = view.leadSide === 'home' ? home : away;
  return {
    a: side(home, view.scoreLabels.home),
    b: side(away, view.scoreLabels.away),
    lead: view.leadSide === 'home' ? 'a' : view.leadSide === 'away' ? 'b' : undefined,
    marginText: view.leadSide ? `${teamNameLabel(leader.name)} by ${diff.toFixed(1)}` : 'Tied',
    live: view.isLive,
  };
}
