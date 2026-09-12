import React from 'react';
import { Box, Typography } from '@mui/material';
import GameCard from './GameCard';

/**
 * pickem-board widget (#1265, ADR 0038): one kickoff-window's worth of
 * GameCards under a heading. The grouping itself is
 * `entities/pickem-game`'s `groupByKickoffWindow` (ADR 0038: "Do not
 * reimplement... grouping" - the entity groups, this renders one group);
 * this component only knows how to label the five windows CONTEXT.md names
 * (Kickoff window) and lay their cards out.
 */
const WINDOW_LABELS = {
  'thursday-night': 'Thursday Night',
  'sunday-early': 'Sunday Early',
  'sunday-late': 'Sunday Late',
  'sunday-night': 'Sunday Night',
  'monday-night': 'Monday Night',
};

export default function KickoffWindowGroup({
  window: windowKey,
  views,
  mode,
  totalManagers,
  slateSize,
  confidenceUsedByFor,
  flaggedMessages = {},
  loading = false,
  onPickWinner,
  onSetConfidence,
}) {
  const label = WINDOW_LABELS[windowKey] || windowKey;
  return (
    <Box component="section" aria-label={label} data-testid={`kickoff-window-${windowKey}`}>
      <Typography
        component="h3"
        sx={{
          m: 0,
          mb: 1,
          fontFamily: 'var(--dash-font-display)',
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--dash-dim)',
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {views.map((view) => (
          <GameCard
            key={view.gameKey}
            view={view}
            mode={mode}
            totalManagers={totalManagers}
            slateSize={slateSize}
            confidenceUsedBy={confidenceUsedByFor ? confidenceUsedByFor(view.gameKey) : []}
            flaggedMessage={flaggedMessages[view.gameKey] ?? null}
            loading={loading}
            onPickWinner={onPickWinner}
            onSetConfidence={onSetConfidence}
          />
        ))}
      </Box>
    </Box>
  );
}
