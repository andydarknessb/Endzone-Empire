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
 * NOT role="status". The Draft room already renders one - ReadinessAnnouncer,
 * hoisted out of the rail by issue #164 so it survives a mobile tab switch -
 * and DraftBoard.test.jsx queries it with a singular getByRole, which throws
 * on a second match. A bare aria-live region is still announced by screen
 * readers but stays invisible to role queries.
 *
 * (This used to name DraftRail's own managers-ready line as the region being
 * protected. #164 stripped role/aria-live from that line, so the rail now
 * renders no status region at all; the constraint is unchanged, but the
 * element it is about moved.)
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
