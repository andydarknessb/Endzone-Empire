import React from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Chip, LinearProgress, Paper, Stack, Typography,
} from '@mui/material';
import Countdown from '../Countdown/Countdown';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import {
  chipSx, DISPLAY_FONT, dimSx, ghostButtonSx, panelHeaderSx, panelSx, panelTitleSx, primaryButtonSx, progressSx,
  quietButtonSx,
} from '../common/homeIslandSx';

// A pre-draft league past its draft_date is "late" only for this long; an older
// one is stale (its league card still shows it), not a draft about to start.
const LATE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

const STATE_RANK = { live: 0, late: 1, scheduled: 2 };

/**
 * Where a league's draft sits for the Home card: 'live' (draft in progress),
 * 'late' (pre-draft, the scheduled time passed within the last 24 hours and
 * nobody has started it), 'scheduled' (pre-draft, time still ahead) or null (no
 * card, including a pre-draft league long past its date). Phase decides
 * live; draft_date only splits the pre-draft leagues.
 */
function draftState(league, now) {
  const phase = deriveLeaguePhase(league);
  if (phase === LEAGUE_PHASE.DRAFTING) return 'live';
  if (phase !== LEAGUE_PHASE.PRE_DRAFT || !league.draft_date) return null;
  const at = new Date(league.draft_date).getTime();
  if (Number.isNaN(at)) return null;
  if (at > now) return 'scheduled';
  return now - at <= LATE_WINDOW_MS ? 'late' : null;
}

/**
 * The Draft the card features: a draft in progress, else a late one, else the
 * next scheduled one; the earliest draft_date wins within a state. Returns
 * `{ league, state }` or null.
 */
export function featuredDraft(leagues, now = Date.now()) {
  let best = null;
  let bestAt = Infinity;
  (leagues || []).forEach((league) => {
    const state = draftState(league, now);
    if (!state) return;
    const at = league.draft_date ? new Date(league.draft_date).getTime() : Infinity;
    if (best && (STATE_RANK[state] > STATE_RANK[best.state]
      || (state === best.state && at >= bestAt))) return;
    best = { league, state };
    bestAt = at;
  });
  return best;
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

const leagueNameSx = {
  fontFamily: DISPLAY_FONT,
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: 1.1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const primarySx = { ...primaryButtonSx, ...MIN_TOUCH_TARGET_SX, minHeight: 48, fontSize: '15px' };
const ghostSx = { ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX, minHeight: 48, fontSize: '15px' };

const HEADING = { scheduled: 'Next draft', live: 'Draft live', late: 'Draft starting soon' };

/**
 * Home v2 draft card. Scheduled: a countdown, seats filled and the way in.
 * Live (draft in progress) and late (start time passed, not started) keep the
 * card up. `queueHasDraft`: the to-do list already carries a Join draft row for
 * this league, so a live card steps down to the ghost button (one primary).
 */
function NextDraftCard({ league, queueHasDraft = false }) {
  const state = draftState(league, Date.now()) || 'scheduled';
  const isScheduled = state === 'scheduled';
  const primary = isScheduled || (state === 'live' && !queueHasDraft);
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="next-draft-heading"
      sx={{ ...panelSx, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Box sx={{
        ...panelHeaderSx, px: 2.5, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
      }}
      >
        <Typography id="next-draft-heading" variant="h6" component="h2" sx={panelTitleSx}>
          {HEADING[state]}
        </Typography>
        {state === 'live' && <Chip size="small" label="In progress" sx={chipSx('accent')} />}
      </Box>
      <Stack spacing={2.25} useFlexGap sx={{ p: 2.5, flexGrow: 1 }}>
        <Typography sx={leagueNameSx} title={league.name}>
          {league.name}
        </Typography>
        {isScheduled && (
          <>
            <Box sx={countdownSx}>
              <Countdown
                date={league.draft_date}
                timeZone={league.draft_timezone || null}
                leagueName={league.name}
                leagueId={league.id}
              />
            </Box>
            <SeatsFilled filled={Number(league.team_count)} max={Number(league.max_teams)} />
          </>
        )}
        {state === 'late' && (
          <Typography variant="body2" sx={{ ...dimSx, fontSize: '14px' }}>
            {league.draft_autostart_failed
              ? "The draft didn't start on its own. It starts when the commissioner begins it."
              : 'Your draft is about to start.'}
          </Typography>
        )}
        <Stack spacing={1.25} sx={{ mt: 'auto' }}>
          <Button
            component={RouterLink}
            to={`/league/${league.id}/draft`}
            variant={primary ? 'contained' : 'outlined'}
            size="large"
            sx={primary ? primarySx : ghostSx}
          >
            {state === 'live' ? 'Join draft' : 'Open Draft Room'}
          </Button>
          {isScheduled && (
            <Button component={RouterLink} to="/draft-sim" variant="outlined" size="large" sx={ghostSx}>
              Practice in Draft Sim
            </Button>
          )}
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
    draft_status: PropTypes.string,
    draft_timezone: PropTypes.string,
    draft_autostart_failed: PropTypes.bool,
    team_count: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    max_teams: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }).isRequired,
  queueHasDraft: PropTypes.bool,
};

export default NextDraftCard;
