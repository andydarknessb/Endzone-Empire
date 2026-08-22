import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { buildDraftIcs, draftTimezoneDetail, formatViewerLocalSchedule } from '../../lib/draftTimeFormat';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The four-tier cadence (#117): a countdown days out only needs to be right
// to the minute and repaints once a minute; one under an hour needs to be
// right to the second and repaints every second.
function tierFor(remainingMs) {
  if (remainingMs > DAY_MS) return 'days';
  if (remainingMs > HOUR_MS) return 'hours';
  return 'seconds';
}

function cadenceFor(tier) {
  return tier === 'seconds' ? 1000 : 60000;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toParts(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

// >24h: "2d 03h" · 1-24h: "3h 05m" · <1h: "14m 09s" (#117: tiered cadence).
function formatByTier(remainingMs, tier) {
  const parts = toParts(remainingMs);
  if (tier === 'days') return `${parts.days}d ${pad(parts.hours)}h`;
  if (tier === 'hours') return `${parts.hours}h ${pad(parts.minutes)}m`;
  return `${parts.minutes}m ${pad(parts.seconds)}s`;
}

/**
 * Self-scheduling countdown clock: repaints itself at the tier-appropriate
 * cadence via a self-rescheduling timeout (not a fixed interval), so a
 * countdown that starts in the "hours" tier automatically switches to
 * per-second updates the moment it crosses into the "seconds" tier rather
 * than waiting up to a minute to notice. This is the only piece of Countdown
 * that re-renders every tick - the isolation the shell around it depends on
 * (#117: ticking state isolated from the page tree).
 */
function useCountdownTicking(targetTime, onExpire) {
  const [remainingMs, setRemainingMs] = useState(() => targetTime - Date.now());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    let timeoutId;

    const tick = () => {
      const remaining = targetTime - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        onExpireRef.current?.();
        return;
      }
      timeoutId = setTimeout(tick, cadenceFor(tierFor(remaining)));
    };

    tick();
    return () => clearTimeout(timeoutId);
  }, [targetTime]);

  return remainingMs;
}

function CountdownTicker({ targetTime, prefix = undefined, variant, onExpire }) {
  const remainingMs = useCountdownTicking(targetTime, onExpire);

  if (remainingMs <= 0) return null;

  const text = formatByTier(remainingMs, tierFor(remainingMs));

  if (variant === 'chip') {
    return <Chip size="small" label={`⏱ ${text}`} />;
  }

  return (
    <Typography variant="h6" component="div">
      {prefix} {text}
    </Typography>
  );
}

CountdownTicker.propTypes = {
  targetTime: PropTypes.number.isRequired,
  prefix: PropTypes.string,
  variant: PropTypes.oneOf(['chip', 'full']).isRequired,
  onExpire: PropTypes.func.isRequired,
};

// The five points worth interrupting a screen-reader user for (#117): every
// other tick stays silent. Each is a single timeout fired exactly at its
// offset from the target instant, computed once on mount/target change -
// not a poll - so a milestone already behind the target time at mount is
// never retroactively announced.
const MILESTONES_MS = [5 * MINUTE_MS, MINUTE_MS, 30 * 1000, 10 * 1000, 0];

function milestoneMessage(thresholdMs, eventLabel) {
  if (thresholdMs <= 0) return eventLabel;
  if (thresholdMs >= MINUTE_MS) {
    const minutes = Math.round(thresholdMs / MINUTE_MS);
    return `${eventLabel} in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${eventLabel} in ${Math.round(thresholdMs / 1000)} seconds`;
}

function useMilestoneAnnouncement(targetTime, eventLabel, enabled) {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;

    const now = Date.now();
    const timeoutIds = MILESTONES_MS
      .map((thresholdMs) => ({ thresholdMs, delay: targetTime - thresholdMs - now }))
      // A milestone already in the past at mount is not announced retroactively.
      .filter(({ delay }) => delay >= 0)
      .map(({ thresholdMs, delay }) => setTimeout(() => setAnnouncement(milestoneMessage(thresholdMs, eventLabel)), delay));

    return () => timeoutIds.forEach(clearTimeout);
  }, [targetTime, eventLabel, enabled]);

  return announcement;
}

/**
 * A polite status announcement, separate from the visible ticker (#117: the
 * visible timer is not itself a live region, so it never spams a screen
 * reader every tick). Visually hidden - it exists purely to be announced.
 */
function CountdownAnnouncer({ targetTime, eventLabel, enabled }) {
  const announcement = useMilestoneAnnouncement(targetTime, eventLabel, enabled);

  if (!enabled) return null;

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

/**
 * Live countdown to a future ISO timestamp (#117, parent spec #108). Renders
 * nothing once the date is unset or has passed - callers gate on
 * `draft_status === 'pending'` before rendering this at all, but the
 * null-render is a safety net for the exact moment the clock runs out.
 *
 * The visible ticker (tiered cadence, isolated ticking state) is entirely
 * delegated to CountdownTicker so the shell here - the hover/tap detail, the
 * calendar export, the milestone announcer - never re-renders on a tick.
 */
function Countdown({
  date = null,
  prefix = 'Draft in',
  variant = 'full',
  timeZone = null,
  leagueName = null,
  leagueId = null,
  announce = true,
  eventLabel = 'Draft start',
}) {
  const targetTime = date ? new Date(date).getTime() : NaN;
  const isValidDate = Boolean(date) && !Number.isNaN(targetTime);

  const [expired, setExpired] = useState(() => !isValidDate || targetTime - Date.now() <= 0);

  useEffect(() => {
    setExpired(!isValidDate || targetTime - Date.now() <= 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-evaluate only when the date prop itself changes
  }, [date]);

  const handleExpire = useCallback(() => setExpired(true), []);

  const handleDownloadIcs = useCallback(() => {
    const ics = buildDraftIcs({ leagueId, leagueName, startDate: date });
    if (!ics) return;
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(leagueName).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-draft.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [leagueId, leagueName, date]);

  if (!isValidDate || expired) return null;

  if (variant === 'chip') {
    return (
      <>
        <CountdownTicker targetTime={targetTime} variant="chip" onExpire={handleExpire} />
        <CountdownAnnouncer targetTime={targetTime} eventLabel={eventLabel} enabled={announce} />
      </>
    );
  }

  const viewerSchedule = formatViewerLocalSchedule(date);
  const detail = draftTimezoneDetail(date, timeZone);

  return (
    <Box>
      <CountdownTicker targetTime={targetTime} prefix={prefix} variant="full" onExpire={handleExpire} />
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <Tooltip title={detail} enterTouchDelay={0}>
          <Typography
            variant="body2"
            tabIndex={0}
            sx={{ color: 'text.secondary', cursor: 'help', width: 'fit-content' }}
          >
            {`· ${viewerSchedule}`}
          </Typography>
        </Tooltip>
        {leagueId != null && leagueName && (
          <Button size="small" onClick={handleDownloadIcs}>Add to calendar</Button>
        )}
      </Stack>
      <CountdownAnnouncer targetTime={targetTime} eventLabel={eventLabel} enabled={announce} />
    </Box>
  );
}

Countdown.propTypes = {
  date: PropTypes.string,
  prefix: PropTypes.string,
  variant: PropTypes.oneOf(['chip', 'full']),
  timeZone: PropTypes.string,
  leagueName: PropTypes.string,
  leagueId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  announce: PropTypes.bool,
  eventLabel: PropTypes.string,
};

export default Countdown;
