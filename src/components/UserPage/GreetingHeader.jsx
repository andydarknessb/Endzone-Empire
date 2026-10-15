import React from 'react';
import { Box } from '@mui/material';
import { formatInstant } from '../../shared/lib/instantFormat';
import { LiveChip, PixelHeading } from './home';

/**
 * The greeting header (DESIGN.md "Home surface: Play-select"): the page's h1,
 * one status line in Archivo, the live chip beside it, and (on a desktop) the
 * Join and Create buttons at the top right. None of it fetches: the page hands
 * down what it and ActionQueue already hold.
 */

const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// The item with the earliest deadline still ahead today, as { at, item }. A live
// draft's deadline is "now", not a lock, so it never names the time. Info
// items (a waiver claim clearing) rank last on the server, so the greeting
// never names one over the row the queue puts first.
function firstLockToday(items, now) {
  let first = null;
  items.forEach((item) => {
    if (!item || item.type === 'draft_live' || item.severity === 'info' || !item.deadlineAt) return;
    const at = new Date(item.deadlineAt).getTime();
    if (Number.isNaN(at) || at <= now || !sameLocalDay(at, now)) return;
    if (first === null || at < first.at) first = { at, item };
  });
  return first;
}

/**
 * The summary line for a GET /api/user/action-items body, or null when there
 * is nothing honest to say (no body yet, or an empty list with item types the
 * server could not check, where "all caught up" would be a claim it can't
 * back). `count` is the number of plays the cards show (ActionQueue's
 * buildPlays), so the greeting and the badge give one number; without it the
 * server's own total stands.
 */
export function greetingSummary(body, now = Date.now(), count = undefined) {
  if (!body || typeof body !== 'object') return null;
  const items = Array.isArray(body.items) ? body.items : [];
  const incomplete = Array.isArray(body.partial) && body.partial.length > 0;
  let total = items.filter((item) => item && item.severity !== 'info').length;
  if (typeof body.counts?.total === 'number') total = body.counts.total;
  if (typeof count === 'number') total = count;
  if (total <= 0) return incomplete ? null : "You're all caught up.";

  const head = total === 1 ? '1 thing needs you.' : `${total} things need you.`;
  const dueToday = typeof body.counts?.dueToday === 'number' ? Math.min(body.counts.dueToday, total) : 0;
  if (dueToday <= 0) return head;

  const first = firstLockToday(items, now);
  if (first === null) return `${head} ${dueToday === 1 ? '1 is due today' : `${dueToday} are due today`}.`;
  const { title } = first.item;
  const time = formatInstant(first.at, 'time');
  return dueToday === 1
    ? `${head} 1 is due today: ${title}, at ${time}.`
    : `${head} ${dueToday} are due today. First up: ${title}, at ${time}.`;
}

/** How many of the manager's matchups are live right now (ADR 0030 status). */
export function liveMatchupCount(leagues) {
  return (Array.isArray(leagues) ? leagues : [])
    .filter((league) => league?.status && league.statusError !== true && league.status.matchup?.status === 'live')
    .length;
}


const greetingDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

const introSx = { m: 0, fontSize: { xs: '15px', md: '17px' }, color: 'var(--home-dim)' };

/**
 * h1, then "Week N · Weekday, Mon D · <summary>" and the live chip. The week
 * part is left out when `week` is null, the summary when it is, and the whole
 * line when neither is known. `actions` is the Join / Create pair, shown here
 * on a desktop.
 */
export function GreetingHeader({
  username, week, summary, liveCount, actions,
}) {
  const weekText = week ? `Week ${week} · ${greetingDateFormat.format(new Date())}` : null;
  return (
    <Box
      component="header"
      data-testid="dashboard-hero"
      sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <PixelHeading level={1} id="user-page-heading">{`Welcome back, ${username}`}</PixelHeading>
        {(weekText || summary || liveCount > 0) && (
          <Box sx={{
            display: 'flex', flexDirection: { xs: 'column', md: 'row' }, flexWrap: 'wrap', alignItems: { xs: 'flex-start', md: 'center' }, gap: '8px 16px',
          }}
          >
            {(weekText || summary) && (
              <Box component="p" sx={introSx}>
                {weekText && <span>{weekText}</span>}
                {weekText && summary && ' · '}
                {summary && <span data-testid="greeting-summary">{summary}</span>}
              </Box>
            )}
            {liveCount > 0 && (
              <span data-testid="live-matchups-chip">
                <LiveChip>{liveCount === 1 ? '1 matchup live' : `${liveCount} matchups live`}</LiveChip>
              </span>
            )}
          </Box>
        )}
      </Box>
      {actions}
    </Box>
  );
}

/** First run's h1 and promise paragraph (build-firstrun.js). */
export function FirstRunIntro({ username }) {
  return (
    <Box component="header" data-testid="dashboard-hero" sx={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '720px' }}>
      <PixelHeading level={1} id="user-page-heading">Start a league tonight</PixelHeading>
      <Box component="p" sx={introSx}>
        {`Welcome, ${username}. Free to play: pick fantasy, NFL pick'em, or both, send your friends the invite code, and draft as soon as they're in.`}
      </Box>
    </Box>
  );
}
