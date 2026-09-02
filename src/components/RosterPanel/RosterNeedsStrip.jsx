import React, { useMemo } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { assignRosterSlots } from '../../lib/rosterAssignment';

/**
 * "What do I still need?" above the roster panel: how full the roster is, which
 * starting slots are still open, how much bench is left, when the next pick
 * lands, and whether there are enough picks left to finish a legal starting
 * lineup.
 *
 * Carries aria-live="polite" and deliberately not the status role - a ruling
 * (#664, 2026-09-02), not a test constraint. See FeedAnnouncer's docblock
 * (and the grep it names) for the Draft room's current set of other status
 * regions - this strip isn't one of them, and that is exactly the point:
 *
 * (1) The role's only real effect here is atomicity, not politeness: the
 *     status role implies an implicit aria-atomic of true, while a bare
 *     aria-live="polite" region (nothing in this codebase sets aria-atomic
 *     explicitly) stays non-atomic. Both already announce at the same
 *     "polite" priority, so adding the role would not change WHEN a screen
 *     reader speaks - it would change WHAT gets read on every update, from
 *     just the piece that changed to this whole dense block (starters,
 *     next pick, needed slots, bench, severity) every time any one of them
 *     does. For a region with this many independently-changing parts, that
 *     is a regression, not a wash.
 * (2) It would also make this strip harder to tell apart, for anything that
 *     counts or enumerates status regions by role, from the room's other
 *     status regions - most of which are visually hidden and built to speak
 *     once and fall silent. This strip is the opposite: a visible,
 *     continuously-updating summary that sits on screen for the whole
 *     draft.
 * (3) No test asserts this strip's role either way. (The #513/#648 counting
 *     tests in DraftBoard.test.jsx count status regions by their copy, not
 *     their number, so adding the role here would not collide with them -
 *     that is not why it stays off.) A later reversal needs a new ruling,
 *     not a passing suite, to justify it.
 *
 * Provider-free (MUI only): the Draft Simulator mounts it with no providers.
 * Narrow-width chip collapsing is a `maxChips` prop rather than a media query,
 * because the constraint is the container (a 340px rail) and not the viewport,
 * and the same viewport renders this full-width on the My-team tab.
 */
function RosterNeedsStrip({
  rosterSlots = [],
  benchCount = 0,
  irCount = 0,
  irDraftable = true,
  picks = [],
  remainingPicks = null,
  nextPickLabel = null,
  maxChips = 4,
}) {
  const { summary } = useMemo(
    () => assignRosterSlots({ picks, rosterSlots, benchCount, irCount, irDraftable }),
    [picks, rosterSlots, benchCount, irCount, irDraftable]
  );

  const {
    startersFilled, starterInstances, unfilledStarters, benchFilled, benchInstances,
  } = summary;
  const openStarters = unfilledStarters.reduce((sum, slot) => sum + slot.count, 0);

  const visibleChips = unfilledStarters.slice(0, Math.max(0, maxChips));
  const hiddenChips = unfilledStarters.length - visibleChips.length;

  // Two levels, not one. "Exactly enough" and "already short" read very
  // differently to someone still on the clock.
  let severity = null;
  if (remainingPicks != null && openStarters > 0) {
    if (remainingPicks < openStarters) {
      severity = {
        color: 'error.main',
        text: `Only ${remainingPicks} ${remainingPicks === 1 ? 'pick' : 'picks'} left `
          + `for ${openStarters} open starting ${openStarters === 1 ? 'spot' : 'spots'}.`,
      };
    } else if (remainingPicks === openStarters) {
      severity = {
        color: 'warning.main',
        text: 'Every remaining pick has to fill a starting spot.',
      };
    }
  }

  if (!Array.isArray(rosterSlots) || rosterSlots.length === 0) return null;

  return (
    <Box
      aria-live="polite"
      aria-label="Roster needs"
      sx={{
        p: 1.5,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderColor: severity ? severity.color : 'divider',
        bgcolor: 'var(--surface)',
      }}
    >
      <Stack
        direction="row" spacing={1} justifyContent="space-between"
        alignItems="baseline" flexWrap="wrap" useFlexGap
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {startersFilled} of {starterInstances} starters filled
        </Typography>
        {nextPickLabel && (
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
          >
            Next pick {nextPickLabel}
          </Typography>
        )}
      </Stack>

      {unfilledStarters.length > 0 && (
        <Stack
          direction="row" spacing={0.5} alignItems="center"
          flexWrap="wrap" useFlexGap sx={{ mt: 1 }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Need</Typography>
          {/* data-testid is a test-only seam: a non-clickable Chip carries no
              role, so which needs are listed, and in what order, is otherwise
              only reachable through the chip's styling class. */}
          {visibleChips.map((slot) => (
            <Chip
              key={`${slot.slotKey}-${slot.slotLabel}`}
              size="small"
              variant="outlined"
              color={severity ? 'warning' : 'default'}
              label={slot.count > 1 ? `${slot.slotLabel} ×${slot.count}` : slot.slotLabel}
              data-testid="roster-need-chip"
            />
          ))}
          {hiddenChips > 0 && (
            <Chip size="small" variant="outlined" label={`+${hiddenChips} more`} />
          )}
        </Stack>
      )}

      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        {benchFilled} of {benchInstances} bench filled
      </Typography>

      {severity && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
          <WarningAmberIcon fontSize="small" sx={{ color: severity.color }} />
          <Typography variant="body2" sx={{ color: severity.color }}>
            {severity.text}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

export default RosterNeedsStrip;
