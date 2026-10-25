import { matchupFace } from '../../../entities/matchup';
import { initialsFor, teamNameLabel } from '../../../shared/lib';
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
  const { first, second, game } = matchupFace(matchup, { viewerTeamId });
  if (game.hasStarted !== true) return null;
  // The face already puts the viewer's side first: `a` is the left one.
  const side = (s) => ({ abbr: initialsFor(s.name), name: teamNameLabel(s.name), score: s.scoreLabel });
  return {
    a: side(first),
    b: side(second),
    lead: game.scoreLeader === 'first' ? 'a' : game.scoreLeader === 'second' ? 'b' : undefined,
    // The compact bar keeps its own fallback: a missing raw score still reads Tied, as before the face.
    marginText: game.rawMarginText ?? 'Tied',
    live: game.isLive,
  };
}
