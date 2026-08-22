import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { buildDraftIcs, draftTimezoneDetail, formatViewerLocalSchedule } from '../../lib/draftTimeFormat';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function slugify(text) {
  return String(text).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

// The createObjectURL -> temporary <a download> -> click -> revokeObjectURL
// sequence a client-built file export always needs (ProfileSettingsModal's
// account-export button does the same thing over a server-sent blob); named
// and factored out here so this Countdown-local use has one obvious home
// rather than inlining the four DOM calls at the call site.
function downloadTextFile(text, mimeType, filename) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The four-tier cadence (#117): a countdown days out only needs to be right
// to the minute and repaints once a minute; one under an hour needs to be
// right to the second and repaints every second.
//
// `>=`, not `>`: toParts() derives each field by cascading modulo off the
// full remaining time, so a remainder that lands on an exact multiple of a
// tier's own span (remainingMs === HOUR_MS or === DAY_MS) wraps that span's
// count to zero - e.g. exactly 3,600,000ms classified into the "seconds"
// tier renders as "0m 00s" (the whole hour vanishes) instead of the "hours"
// tier's correct "1h 00m". Folding the boundary into the coarser tier keeps
// every field a true, non-wrapped count.
function tierFor(remainingMs) {
  if (remainingMs >= DAY_MS) return 'days';
  if (remainingMs >= HOUR_MS) return 'hours';
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

function CountdownTicker({ targetTime, prefix = undefined, variant, detail = '', onExpire }) {
  const remainingMs = useCountdownTicking(targetTime, onExpire);

  if (remainingMs <= 0) return null;

  const text = formatByTier(remainingMs, tierFor(remainingMs));

  if (variant === 'chip') {
    const chip = <Chip size="small" label={`⏱ ${text}`} />;
    // The chip variant is compact enough that the hover/tap detail (#117
    // AC2) wraps the chip itself rather than adding a second visible line.
    return detail ? <Tooltip title={detail} enterTouchDelay={0}>{chip}</Tooltip> : chip;
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
  detail: PropTypes.string,
  onExpire: PropTypes.func.isRequired,
};

// The five points worth interrupting a screen-reader user for (#117): every
// other tick stays silent. Each is a single timeout fired exactly at its
// offset from the target instant, computed once on mount/target change -
// not a poll - so a milestone already behind the target time at mount is
// never retroactively announced.
const MILESTONES_MS = [5 * MINUTE_MS, MINUTE_MS, 30 * 1000, 10 * 1000, 0];

// setTimeout silently misbehaves once a delay exceeds the 32-bit signed int
// range (~24.8 days) - browsers and Node don't reliably clamp it per spec,
// they fire it almost immediately (see MDN's setTimeout "Maximum delay
// value" note). A Draft scheduled more than 24 days out is completely
// ordinary, so the milestone announcer chains through intermediate timeouts
// rather than ever asking for one huge delay directly.
const MAX_TIMEOUT_MS = 2_147_483_647;

function scheduleAt(delayMs, callback) {
  const ref = {};
  const start = (remaining) => {
    if (remaining > MAX_TIMEOUT_MS) {
      ref.id = setTimeout(() => start(remaining - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
    } else {
      ref.id = setTimeout(callback, Math.max(0, remaining));
    }
  };
  start(delayMs);
  return () => clearTimeout(ref.id);
}

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
    // A rescheduled Draft (a new targetTime) invalidates whatever milestone
    // last announced for the old one - e.g. "Draft start in 5 minutes" must
    // not keep sitting in the live region, read as current, once the
    // commissioner pushes the date back an hour.
    setAnnouncement('');
    if (!enabled) return undefined;

    const now = Date.now();
    const cancels = MILESTONES_MS
      .map((thresholdMs) => ({ thresholdMs, delay: targetTime - thresholdMs - now }))
      // A milestone already in the past at mount is not announced retroactively.
      .filter(({ delay }) => delay >= 0)
      .map(({ thresholdMs, delay }) => scheduleAt(delay, () => setAnnouncement(milestoneMessage(thresholdMs, eventLabel))));

    return () => cancels.forEach((cancel) => cancel());
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
  showScheduleDetail = true,
}) {
  const targetTime = date ? new Date(date).getTime() : NaN;
  const isValidDate = Boolean(date) && !Number.isNaN(targetTime);

  const [expired, setExpired] = useState(() => !isValidDate || targetTime - Date.now() <= 0);

  useEffect(() => {
    setExpired(!isValidDate || targetTime - Date.now() <= 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-evaluate only when the date prop itself changes
  }, [date]);

  const handleExpire = useCallback(() => setExpired(true), []);

  // Memoized: these two rebuild an Intl.DateTimeFormat apiece, and the shell
  // otherwise re-renders whenever its parent does for reasons that have
  // nothing to do with the Draft schedule (e.g. an unrelated chat-unread
  // count ticking over) - not just on the tick this shell is already
  // isolated from.
  const detail = useMemo(
    () => (showScheduleDetail ? draftTimezoneDetail(date, timeZone) : ''),
    [date, timeZone, showScheduleDetail]
  );
  const viewerSchedule = useMemo(
    () => (showScheduleDetail ? formatViewerLocalSchedule(date) : ''),
    [date, showScheduleDetail]
  );

  const handleDownloadIcs = useCallback(() => {
    const ics = buildDraftIcs({ leagueId, leagueName, startDate: date });
    if (!ics) return;
    downloadTextFile(ics, 'text/calendar;charset=utf-8', `${slugify(leagueName)}-draft.ics`);
  }, [leagueId, leagueName, date]);

  if (!isValidDate || expired) return null;

  if (variant === 'chip') {
    return (
      <>
        <CountdownTicker targetTime={targetTime} variant="chip" detail={detail} onExpire={handleExpire} />
        <CountdownAnnouncer targetTime={targetTime} eventLabel={eventLabel} enabled={announce} />
      </>
    );
  }

  return (
    <Box>
      <CountdownTicker targetTime={targetTime} prefix={prefix} variant="full" onExpire={handleExpire} />
      {showScheduleDetail && (
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
      )}
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
  // False for a countdown that isn't the Draft's own schedule (the per-pick
  // clock in DraftPresenter): no viewer/league-timezone line, no calendar
  // export - both would be about the wrong instant entirely.
  showScheduleDetail: PropTypes.bool,
};

export default Countdown;
