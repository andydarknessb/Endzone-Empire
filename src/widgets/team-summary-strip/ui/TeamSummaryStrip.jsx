import React from 'react';
import { Box, Typography } from '@mui/material';
import { Card, Skeleton, StatTile } from '../../../shared/ui';
import { useTeamSummaryStrip } from '../model/useTeamSummaryStrip';

/**
 * The Lineup page's summary strip (#1237 AC4): live score against projected
 * total, the opponent's, starters yet to play and locked, and win
 * probability. The advice tile is a placeholder until ticket 6 (ADR 0037)
 * and is therefore not rendered here at all.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens already
 * registered in tokens.contrast.test.js (the stat-tile faint/ink pair, the
 * card surface).
 */
export default function TeamSummaryStrip({ leagueId, week, viewerTeamId, lineup }) {
  const { status, viewer, opponent, winProbability, lockedStarters, totalStarters } = useTeamSummaryStrip({
    leagueId,
    week,
    viewerTeamId,
    lineup,
  });

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
