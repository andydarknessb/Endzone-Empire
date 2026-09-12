import React from 'react';
import { Box, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PickWeek from '../../../features/pick-week';
import useBoardPresenter from '../model/useBoardPresenter';
import KickoffWindowGroup from './KickoffWindowGroup';
import GameCard from './GameCard';
import SaveBar from './SaveBar';

/**
 * The Pick'em board widget (#1265, ADR 0038): the week's slate as
 * kickoff-window groups of GameCards, with the week stepper (`pick-week`,
 * reused per ADR 0038's "What to build") above it and the save bar pinned
 * below. `pages/pickem` does not exist yet (a later ticket in ADR 0038's
 * sequence), so this widget owns the one thing a page normally would for
 * this slice: which week is selected (`useBoardPresenter`'s own state,
 * seeded from the league's current week).
 *
 * Three non-ready states before the slate itself: a load failure (a
 * self-contained, compact error, the same shape matchup-preview's card
 * uses), the loading skeleton (one GameCard per state, since the real
 * count is exactly what has not loaded yet), and an empty week (no NFL
 * games scheduled).
 */
export default function PickemBoard({ leagueId }) {
  const theme = useTheme();
  // `pick-week`'s own 44px touch target below `sm` is opt-in (`fill`); the
  // Game Center and Lineup pages that already compose it both pass this same
  // `compact` derivation (accessibility risk review, #1265 - the board's week
  // stepper was the one control on this screen still stuck at 38px on a phone).
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  const {
    week,
    weeks,
    setWeek,
    mode,
    loading,
    error,
    totalManagers,
    slateSize,
    pickedCount,
    windows,
    saving,
    isDirty,
    saveError,
    flaggedMessages,
    confidenceUsedByFor,
    onPickWinner,
    onSetConfidence,
    onSave,
  } = useBoardPresenter(leagueId);

  const ready = !loading && !error;

  return (
    <Box data-testid="pickem-board">
      <Box sx={{ mb: 2 }}>
        <PickWeek weeks={weeks} value={week ?? undefined} onChange={setWeek} fill={compact} />
      </Box>

      {error && (
        <Typography role="alert" data-testid="pickem-board-error" sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
          We could not load this week&apos;s picks right now.
        </Typography>
      )}

      {loading && (
        <Box sx={{ display: 'grid', gap: 2 }} aria-busy="true">
          <GameCard loading />
          <GameCard loading />
        </Box>
      )}

      {ready && windows.length === 0 && (
        <Typography data-testid="pickem-board-empty" sx={{ fontSize: '14px', color: 'var(--dash-dim)' }}>
          {week != null ? `No games scheduled for week ${week}.` : 'No week selected.'}
        </Typography>
      )}

      {ready && windows.length > 0 && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          {windows.map((group) => (
            <KickoffWindowGroup
              key={group.window}
              window={group.window}
              views={group.games}
              mode={mode}
              totalManagers={totalManagers}
              slateSize={slateSize}
              confidenceUsedByFor={confidenceUsedByFor}
              flaggedMessages={flaggedMessages}
              onPickWinner={onPickWinner}
              onSetConfidence={onSetConfidence}
            />
          ))}
        </Box>
      )}

      {ready && windows.length > 0 && (
        <SaveBar
          pickedCount={pickedCount}
          slateSize={slateSize}
          isDirty={isDirty}
          saving={saving}
          saveError={saveError}
          onSave={onSave}
        />
      )}
    </Box>
  );
}
