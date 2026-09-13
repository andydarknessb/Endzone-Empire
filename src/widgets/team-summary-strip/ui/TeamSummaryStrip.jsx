import React from 'react';
import { Box, Typography } from '@mui/material';
import { Badge, Card, Skeleton, StatTile } from '../../../shared/ui';
import { formatPoints } from '../../../shared/lib';
import { isQuestionable } from '../../../entities/roster';
import { useTeamSummaryStrip } from '../model/useTeamSummaryStrip';

/**
 * The Lineup page's summary strip (#1237 AC4, #1238 AC4): live score against
 * projected total, the opponent's, starters yet to play and locked, win
 * probability, and the Start/sit advice tile.
 *
 * The advice tile (#1238) reads the page's own `advice` prop (`useAdvice`,
 * the same read the start-sit-panel widget and the apply-advice feature
 * consume - ADR 0029's "value two widgets both need is passed down by the
 * page") rather than fetching it itself: best ball never calls the advice
 * endpoint at all, so `advice` degrades to the empty shape
 * (`{ suggestions: [], movePlan: [] }`) there and the tile reads "Lineup
 * set" the same as a standard league with no suggestion, which is the
 * correct answer for a league that sets its own lineup automatically. The
 * tile's "swap count" is `suggestions.length` - the number of sit/start
 * pairs the panel itself shows, matching what a manager actually perceives
 * as "the swaps the advice wants" rather than the movePlan's own internal
 * move count (which also counts a solo bench demotion with no replacement).
 *
 * The attention chips (#1239 shipped the Bye cluster chip; #1330 adds the
 * other two the parent spec #1232 user story 19 names: "attention chips for
 * a questionable starter, a starter on bye and a Bye cluster"). The
 * questionable and on-bye chips are computed HERE from `lineup.entries`
 * (`entities/roster`'s `isQuestionable`, ADR 0029: a widget reads an
 * entity's public surface) - one per starter (a non-BENCH, non-IR slot,
 * never spent, mirroring `useTeamSummaryStrip`'s own `starters`) whose
 * designation is questionable-class, and one per starter whose game this
 * week is a bye (`onBye` or `availability.reason === 'bye'`). Best ball
 * (`bestBall` prop, the page's `league.best_ball`) suppresses the on-bye
 * chip only - the lineup sets itself, so "on bye" tells a best-ball manager
 * nothing actionable, but an injury still might. The row (and both new
 * chips) is absent entirely on a past week (`lineup.week < lineup.
 * currentWeek`), the same rule the Bye cluster chip already follows one
 * level up in `LineupPage.jsx`.
 *
 * `worstByeCluster` is the page's own read
 * (`shared/lib`'s `computeByeClusters`/`worstByeCluster` - promoted there,
 * not kept below the island, since a second island slice, the bye-cluster
 * widget, reaches it too, ADR 0031), passed down because this widget has no
 * other way to reach the bye-cluster widget's own internals (ADR 0020/0029:
 * "a widget may not import another widget's"). The chip only shows at the
 * warning threshold (three or more byes), not at two (CONTEXT.md's Bye
 * cluster: two is merely notable).
 *
 * `scoreEvent` (#1241 AC2): the page's own live-scores read (`useLiveScores`),
 * passed straight through to `useTeamSummaryStrip` so the strip's live
 * totals move with the same scores socket the Ledger's points cell does.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens already
 * registered in tokens.contrast.test.js (the stat-tile faint/ink pair, the
 * card surface, the Badge `danger` variant's tint pair).
 */
export default function TeamSummaryStrip({ leagueId, week, viewerTeamId, lineup, advice, worstByeCluster, scoreEvent, bestBall }) {
  const { status, viewer, opponent, winProbability, lockedStarters, totalStarters } = useTeamSummaryStrip({
    leagueId,
    week,
    viewerTeamId,
    lineup,
    scoreEvent,
  });

  const suggestionCount = Array.isArray(advice?.suggestions) ? advice.suggestions.length : 0;
  const gain =
    advice?.optimalTotal != null && advice?.projectedTotal != null
      ? advice.optimalTotal - advice.projectedTotal
      : null;
  const adviceValue =
    suggestionCount > 0 ? `+${formatPoints(gain)} pts · ${suggestionCount} swap${suggestionCount === 1 ? '' : 's'}` : 'Lineup set';

  // AC4: the worst bye cluster earns its own attention chip only at the
  // warning threshold (three or more) - a notable cluster of two stays the
  // grid's own concern (CONTEXT.md's Bye cluster: "two is worth noticing,
  // three or more is a warning").
  const byeClusterAttention =
    worstByeCluster != null && worstByeCluster.count >= 3
      ? `Wk ${worstByeCluster.week} · ${worstByeCluster.count} byes`
      : null;

  // #1330: a past week is a settled record, never an outlook - the same rule
  // LineupPage.jsx already applies for the Bye cluster grid/chip, re-derived
  // here since this widget's own questionable/on-bye chips read `lineup`
  // directly rather than a page-computed flag.
  const isPastWeek = Boolean(lineup && lineup.week != null && lineup.currentWeek != null && lineup.week < lineup.currentWeek);

  // Starters (non-BENCH, non-IR, never spent - the same definition
  // `useTeamSummaryStrip` already applies for lockedStarters/totalStarters
  // above), the population both new chip kinds are drawn from.
  const starters = !isPastWeek && Array.isArray(lineup?.entries)
    ? lineup.entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR' && !e.spent)
    : [];

  const questionableChips = starters.filter(isQuestionable).map((e) => ({
    key: `questionable-${e.playerId}`,
    testId: `attention-chip-questionable-${e.playerId}`,
    label: `${lastNameOf(e.name)} ${e.injuryStatus}${e.injuryDetail ? ` · ${e.injuryDetail}` : ''}`,
  }));

  // Best ball leagues show the injury chips but never the on-bye chip - the
  // lineup sets itself, so "on bye" names nothing a best-ball manager can act
  // on, but an injury still might.
  const byeChips = bestBall
    ? []
    : starters
        .filter((e) => e.onBye || e.availability?.reason === 'bye')
        .map((e) => ({
          key: `bye-${e.playerId}`,
          testId: `attention-chip-bye-${e.playerId}`,
          label: `${lastNameOf(e.name)} on bye`,
        }));

  // The whole row - the Bye cluster chip included - is absent entirely on a
  // past week (a settled record, never an outlook), not only the two new
  // chip kinds: a `worstByeCluster` prop computed before the week changed
  // (or a caller that has not yet re-derived it) must never survive into a
  // past week's render here.
  const hasAttentionRow = !isPastWeek && (questionableChips.length > 0 || byeChips.length > 0 || byeClusterAttention != null);

  return (
    <Card title="This week" data-testid="team-summary-strip" aria-busy={status === 'loading'}>
      <Box sx={{ p: '14px 18px', display: 'grid', gap: '10px' }}>
        {status === 'loading' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} variant="rounded" height={54} />
            ))}
          </Box>
        )}

        {status === 'error' && (
          <Typography role="alert" sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
            We could not load this week&apos;s matchup right now.
          </Typography>
        )}

        {status === 'empty' && (
          <Typography sx={{ fontSize: '13px', color: 'var(--dash-faint)' }}>No matchup this week</Typography>
        )}

        {status === 'ready' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: '10px' }}>
            <StatTile
              data-testid="strip-score"
              label="Score vs proj."
              value={figureLabel(viewer?.score, viewer?.projected)}
            />
            <StatTile
              data-testid="strip-opponent-score"
              label="Opponent vs proj."
              value={figureLabel(opponent?.score, opponent?.projected)}
            />
            <StatTile
              data-testid="strip-starters-remaining"
              label="Starters"
              value={
                viewer?.playersRemaining != null
                  ? `${viewer.playersRemaining} to play`
                  : '-'
              }
            />
            <StatTile
              data-testid="strip-starters-locked"
              label="Locked"
              value={`${lockedStarters} of ${totalStarters}`}
            />
          </Box>
        )}

        {winProbability != null && (
          <Typography component="p" data-testid="strip-win-probability" sx={{ m: 0, fontSize: '12px', color: 'var(--dash-faint)' }}>
            {`Win probability ${winProbability}%`}
          </Typography>
        )}

        {hasAttentionRow && (
          <Box data-testid="strip-attention" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '11px', fontWeight: 700, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
              Needs attention
            </Typography>
            {questionableChips.map((chip) => (
              <Badge key={chip.key} variant="warning" data-testid={chip.testId}>
                {chip.label}
              </Badge>
            ))}
            {byeChips.map((chip) => (
              <Badge key={chip.key} variant="warning" data-testid={chip.testId}>
                {chip.label}
              </Badge>
            ))}
            {byeClusterAttention && (
              <Badge variant="danger" data-testid="attention-chip-bye-cluster">
                {byeClusterAttention}
              </Badge>
            )}
          </Box>
        )}

        {/* The advice tile stands apart from the ready/empty/error grid above
            (#1238 AC4): it reads its own `advice` prop, not the matchup read
            this widget's `status` tracks, so a bye week or a failed matchup
            read never hides "how many swaps the advice wants". */}
        <StatTile
          data-testid="strip-advice"
          label="Advice"
          value={adviceValue}
          sx={{ width: 'fit-content' }}
        />
      </Box>
    </Card>
  );
}

// The chip label's player name (e.g. "Lamb Q · ankle" for "CeeDee Lamb"): the
// last whitespace-separated token of the entry's full name, matching the
// design's own examples. No entity-layer helper does this today (every other
// surface renders the full name), so it stays local to this widget rather
// than a below-island promotion with one consumer (ADR 0031's threshold).
function lastNameOf(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1];
}

// "112.3 / 108.5" when both are known, a single figure when only one is,
// and a dash when neither is.
function figureLabel(score, projected) {
  const s = score != null ? score.toFixed(1) : null;
  const p = projected != null ? projected.toFixed(1) : null;
  if (s != null && p != null) return `${s} / ${p}`;
  if (s != null) return s;
  if (p != null) return p;
  return '-';
}
