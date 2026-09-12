import React, { useEffect, useRef } from 'react';
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
 *
 * Three optional callbacks (#1267, `pages/pickem`) let a composing page keep
 * an unsaved-picks guard and the cross-entity standings invalidation of its
 * own, without this widget losing ownership of its own week state:
 * `onDirtyChange(isDirty)` mirrors the draft's dirty flag out on every
 * change; `onRequestWeekChange(nextWeek, { apply, cancel })`, when given, is
 * called in place of switching the week directly - the page decides whether
 * to call `apply()` right away or park it behind its own confirmation.
 * `cancel` restores DOM focus to the week that is still actually selected
 * (accessibility risk review, #1267): `pick-week`'s own weeks control is a
 * roving-focus radiogroup (`shared/ui/SegmentedControl`) whose arrow-key move
 * carries DOM focus onto the neighbour BEFORE reporting it, so a page that
 * denies the value still leaves focus on a now-unchecked segment unless it
 * is moved back once the denial is confirmed - this widget owns the ref into
 * its own week control (`weeksRef`), so it is the one that can find the
 * segment still checked and focus it. `onSaved(result)` fires with the
 * save's own `{ ok, ... }` result once a save resolves, which is how the
 * page - the composer of both `entities/pickem-game` and
 * `entities/pickem-standings` - knows to clear the standings cache a save
 * just made stale (sibling entities do not import each other, ADR 0029;
 * `entities/pickem-game`'s `usePickemWeek.js` docblock states this
 * contract). None of the three changes this widget's standalone behaviour
 * when omitted.
 */
export default function PickemBoard({ leagueId, onDirtyChange, onRequestWeekChange, onSaved }) {
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

  useEffect(() => {
    if (onDirtyChange) onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const weeksRef = useRef(null);
  const focusCheckedWeek = () => {
    weeksRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.focus();
  };

  const requestWeek = (nextWeek) => {
    if (onRequestWeekChange) {
      onRequestWeekChange(nextWeek, { apply: () => setWeek(nextWeek), cancel: focusCheckedWeek });
    } else {
      setWeek(nextWeek);
    }
  };

  const handleSave = async () => {
    const result = await onSave();
    if (onSaved) onSaved(result);
    return result;
  };

  return (
    <Box data-testid="pickem-board">
      <Box sx={{ mb: 2 }}>
        <PickWeek ref={weeksRef} weeks={weeks} value={week ?? undefined} onChange={requestWeek} fill={compact} />
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
          onSave={handleSave}
        />
      )}
    </Box>
  );
}
