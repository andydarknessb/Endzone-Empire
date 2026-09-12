import React from 'react';
import { Box, Typography } from '@mui/material';
import { Card, Skeleton, StatTile } from '../../../shared/ui';
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
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens already
 * registered in tokens.contrast.test.js (the stat-tile faint/ink pair, the
 * card surface).
 */
export default function TeamSummaryStrip({ leagueId, week, viewerTeamId, lineup, advice }) {
  const { status, viewer, opponent, winProbability, lockedStarters, totalStarters } = useTeamSummaryStrip({
    leagueId,
    week,
    viewerTeamId,
    lineup,
  });

  const suggestionCount = Array.isArray(advice?.suggestions) ? advice.suggestions.length : 0;
  const gain =
    advice?.optimalTotal != null && advice?.projectedTotal != null
      ? advice.optimalTotal - advice.projectedTotal
      : null;
  const adviceValue =
    suggestionCount > 0 ? `+${formatPoints(gain)} pts · ${suggestionCount} swap${suggestionCount === 1 ? '' : 's'}` : 'Lineup set';

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
