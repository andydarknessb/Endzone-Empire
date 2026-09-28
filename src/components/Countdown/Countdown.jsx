import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useCountdownTicking from '../../hooks/useCountdownTicking';
import PropTypes from 'prop-types';
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { buildDraftIcs, draftTimezoneDetail, formatViewerLocalSchedule } from '../../lib/draftTimeFormat';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { timeUntil } from '../../shared/lib/timeUntil';

const MINUTE_MS = 60 * 1000;

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

// The tiered display (#117) is the shared house style at second precision:
// "2d 03h" days out, "3h 05m" within a day, "14m 09s" inside the last hour
// and "30s" in the last minute (spec #1737). The same module says when the
// text next changes, so the ticker needs no cadence rule of its own.
function untilText(targetTime, remainingMs) {
  return timeUntil(targetTime, targetTime - remainingMs, { precision: 'second' });
}

// The ticking state itself lives in the shared hook (src/hooks/useCountdownTicking,
// lifted out of here by #754 so the Draft room's pick clock shares it). Each
// tick schedules the next for the instant the text next changes, so a
// countdown days out repaints at most once a minute and one inside the last
// hour once a second, and the switch between them lands exactly on the
// crossing. CountdownTicker is the only piece of Countdown that re-renders
// every tick, the isolation the shell around it depends on (#117: ticking
// state isolated from the page tree).
function nextChangeDelay(targetTime) {
  return (remainingMs) => {
    const until = untilText(targetTime, remainingMs);
    return until && !until.passed ? until.changesAt - (targetTime - remainingMs) : 1000;
  };
}

function CountdownTicker({ targetTime, prefix = undefined, variant, detail = '', onExpire }) {
  const nextDelay = useMemo(() => nextChangeDelay(targetTime), [targetTime]);
  const remainingMs = useCountdownTicking(targetTime, { onExpire, nextDelay });

  if (remainingMs <= 0) return null;

  const { text } = untilText(targetTime, remainingMs);

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

  if (variant === 'inline') {
    return (
      <Box
        data-testid="draft-schedule-inline"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <CountdownTicker targetTime={targetTime} prefix={prefix} variant="full" onExpire={handleExpire} />
        {showScheduleDetail && (
          <Tooltip title={detail} enterTouchDelay={0}>
            <Typography variant="body2" tabIndex={0} sx={{ color: 'text.secondary', cursor: 'help' }}>
              {`· ${viewerSchedule}`}
            </Typography>
          </Tooltip>
        )}
        {showScheduleDetail && leagueId != null && leagueName && (
          <Button size="small" onClick={handleDownloadIcs}>Add to calendar</Button>
        )}
        <CountdownAnnouncer targetTime={targetTime} eventLabel={eventLabel} enabled={announce} />
      </Box>
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
              {/* No leading separator here, unlike the inline variant above:
                  this row starts the line, so a middot would have nothing to
                  its left (a pre-draft league's first screen opened with it). */}
              {viewerSchedule}
            </Typography>
          </Tooltip>
          {leagueId != null && leagueName && (
            // `size="small"` stays so MUI's padding, and therefore the button's
            // width, does not change: the floor is added underneath it.
            <Button size="small" sx={MIN_TOUCH_TARGET_SX} onClick={handleDownloadIcs}>Add to calendar</Button>
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
  variant: PropTypes.oneOf(['chip', 'full', 'inline']),
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
