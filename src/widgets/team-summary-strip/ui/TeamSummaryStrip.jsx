import React from 'react';
import { Box, Typography } from '@mui/material';
import { Badge, Card, Skeleton, StatTile } from '../../../shared/ui';
import { formatPoints } from '../../../shared/lib';
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
 * The attention chips (#1239, parent spec #1232 user story 19: "attention
 * chips for a questionable starter, a starter on bye and a Bye cluster"):
 * this ticket builds only the Bye cluster chip, since no acceptance
 * criterion here (or a page test scenario) names the other two, and no
 * prior ticket shipped them either - a "Needs attention" row that shows
 * only the chips this codebase actually computes, ready for the other two
 * to join it once a ticket builds them, rather than fabricating chips no
 * criterion asks for. `worstByeCluster` is the page's own read
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
export default function TeamSummaryStrip({ leagueId, week, viewerTeamId, lineup, advice, worstByeCluster, scoreEvent }) {
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

        {byeClusterAttention && (
          <Box data-testid="strip-attention" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '11px', fontWeight: 700, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
              Needs attention
            </Typography>
            <Badge variant="danger" data-testid="attention-chip-bye-cluster">
              {byeClusterAttention}
            </Badge>
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
