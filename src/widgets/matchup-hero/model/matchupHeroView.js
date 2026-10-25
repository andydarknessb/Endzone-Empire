import { matchupFace } from '../../../entities/matchup';
import { finite, initialsFor, teamNameLabel } from '../../../shared/lib';
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
 *
 * Every rule above is `matchupFace`'s (entities/matchup, ADR 0029 amendment 2026-10-24); this view
 * maps the face onto the hero's keys and prices or words nothing itself.
 */

// compactScoreboardView's margin is the raw-score gap; the face's scoreGap reads the printed labels.
const tenth = (value) => Math.round(value * 10) / 10;

/**
 * The whole view for one hero card. `first` and `second` are the face's sides (the viewer's Team
 * first when it is one of the two, else home; the sentence reads from `first`'s perspective, which
 * for a non-participant is a degrade path: the page only renders this card for the viewer's own Matchup).
 */
export function matchupHeroView(matchup, viewerTeamId, { counts = null, countsPending = false } = {}) {
  const { first, second, game } = matchupFace(matchup || {}, { viewerTeamId, counts, countsPending });
  const { chip } = game;
  return {
    first,
    second,
    scoreLabels: { first: first.scoreLabel, second: second.scoreLabel },
    hasStarted: game.hasStarted,
    isLive: game.isLive,
    leadSide: game.scoreLeader,
    projectedLeader: game.projectedLeader,
    projectedMargin: game.projectedMargin,
    chipLabel: chip?.label ?? null,
    chipVariant: chip?.variant ?? 'neutral',
    chipDot: chip?.dot ?? false,
    winProbability: game.winProbability,
    projectedWinProbability: game.projectedWinProbability,
    sentence: game.sentence,
    kickoff: game.kickoffLabel,
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
