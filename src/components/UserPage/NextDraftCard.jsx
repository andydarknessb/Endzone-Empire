import React from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, LinearProgress, Paper, Stack, Typography,
} from '@mui/material';
import Countdown from '../Countdown/Countdown';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import {
  DISPLAY_FONT, dimSx, ghostButtonSx, panelHeaderSx, panelSx, panelTitleSx, primaryButtonSx, progressSx,
  quietButtonSx,
} from '../common/homeIslandSx';

// The shared Countdown paints app tokens (it serves legacy pages too), so the
// card repaints it from outside: the ticker in the display face, the schedule
// line in `dash-dim` and Add to calendar as the quiet accent action, all on
// the card surface.
const countdownSx = {
  color: 'var(--dash-ink)',
  '& .MuiTypography-h6': {
    fontFamily: DISPLAY_FONT,
    fontSize: '30px',
    fontWeight: 700,
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums',
  },
  '& .MuiTypography-body2': { ...dimSx, fontSize: '14px' },
  '& .MuiButton-root': quietButtonSx,
};

/**
 * The manager's next Draft: the pre-draft league (from the /api/league rows)
 * with the earliest draft_date still ahead, or null when there is none. A date
 * already behind us is skipped: that draft is late to start, not upcoming, and
 * a countdown to it would render nothing.
 */
export function nextScheduledDraft(leagues, now = Date.now()) {
  let next = null;
  let nextAt = Infinity;
  (leagues || []).forEach((league) => {
    if (deriveLeaguePhase(league) !== LEAGUE_PHASE.PRE_DRAFT || !league.draft_date) return;
    const at = new Date(league.draft_date).getTime();
    if (Number.isNaN(at) || at <= now || at >= nextAt) return;
    next = league;
    nextAt = at;
  });
  return next;
}

function SeatsFilled({ filled, max }) {
  if (!Number.isFinite(filled) || !Number.isFinite(max) || max <= 0) return null;
  const clamped = Math.min(Math.max(filled, 0), max);
  return (
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between">
        <Typography id="next-draft-seats-label" variant="body2" sx={{ ...dimSx, fontSize: '13px' }}>Seats filled</Typography>
        <Typography variant="body2" aria-hidden="true" sx={{ fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {`${clamped} / ${max}`}
        </Typography>
      </Stack>
      {/* The ARIA values are the real counts, not MUI's 0-100 percentage. */}
      <LinearProgress
        variant="determinate"
        value={(clamped / max) * 100}
        aria-labelledby="next-draft-seats-label"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} of ${max}`}
        sx={{ ...progressSx, height: 8, borderRadius: 999 }}
      />
    </Stack>
  );
}

SeatsFilled.propTypes = {
  filled: PropTypes.number,
  max: PropTypes.number,
};

/** Home v2 "Next draft" card: a countdown, seats filled and the way in. */
function NextDraftCard({ league }) {
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="next-draft-heading"
      sx={{ ...panelSx, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Box sx={{ ...panelHeaderSx, px: 2.5, py: 2 }}>
        <Typography id="next-draft-heading" variant="h6" component="h2" sx={panelTitleSx}>
          Next draft
        </Typography>
      </Box>
      <Stack spacing={2.25} useFlexGap sx={{ p: 2.5, flexGrow: 1 }}>
        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontSize: '28px',
            fontWeight: 700,
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={league.name}
        >
          {league.name}
        </Typography>
        <Box sx={countdownSx}>
          <Countdown
            date={league.draft_date}
            timeZone={league.draft_timezone || null}
            leagueName={league.name}
            leagueId={league.id}
          />
        </Box>
        <SeatsFilled filled={Number(league.team_count)} max={Number(league.max_teams)} />
        <Stack spacing={1.25} sx={{ mt: 'auto' }}>
          <Button
            component={RouterLink}
            to={`/league/${league.id}/draft`}
            variant="contained"
            size="large"
            sx={{ ...primaryButtonSx, ...MIN_TOUCH_TARGET_SX, minHeight: 48, fontSize: '15px' }}
          >
            Open Draft Room
          </Button>
          <Button
            component={RouterLink}
            to="/draft-sim"
            variant="outlined"
            size="large"
            sx={{ ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX, minHeight: 48, fontSize: '15px' }}
          >
            Practice in Draft Sim
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

NextDraftCard.propTypes = {
  league: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    name: PropTypes.string,
    draft_date: PropTypes.string,
    draft_timezone: PropTypes.string,
    team_count: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    max_teams: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }).isRequired,
};

export default NextDraftCard;
