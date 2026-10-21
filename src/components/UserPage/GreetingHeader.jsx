import React from 'react';
import { Box } from '@mui/material';
import { formatInstant } from '../../shared/lib/instantFormat';
import { LiveChip, PixelHeading } from '../../shared/ui/playselect';

/**
 * The greeting header (DESIGN.md "Play-select: Home and league pages"): the page's h1,
 * one status line in Archivo, the live chip beside it, and (on a desktop) the
 * Join and Create buttons at the top right. None of it fetches: the page hands
 * down what it and ActionQueue already hold.
 */

const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// The play with the earliest lock still ahead today. A draft has no lock (its
// `at` is null), so it never names the time.
function firstLockToday(plays, now) {
  let first = null;
  plays.forEach((play) => {
    if (play.at === null || play.at <= now || !sameLocalDay(play.at, now)) return;
    if (first === null || play.at < first.at) first = play;
  });
  return first;
}

/**
 * The summary line, or null when there is nothing honest to say (no body or no
 * plays yet, or an empty list with item types the server could not check, where
 * "all caught up" would be a claim it can't back). `plays` is what the cards
 * show (ActionQueue's Plays, read at `now`), so the greeting's count, its
 * due-today count and the badge all come from one list: due today is the plays
 * whose lock falls on today's date in the viewer's zone.
 */
export function greetingSummary(body, plays, now = Date.now()) {
  if (!body || typeof body !== 'object' || !Array.isArray(plays)) return null;
  const incomplete = Array.isArray(body.partial) && body.partial.length > 0;
  const total = plays.length;
  if (total <= 0) return incomplete ? null : "You're all caught up.";

  const head = total === 1 ? '1 thing needs you.' : `${total} things need you.`;
  const dueToday = plays.filter((play) => play.at !== null && sameLocalDay(play.at, now)).length;
  if (dueToday <= 0) return head;

  const first = firstLockToday(plays, now);
  if (first === null) return `${head} ${dueToday === 1 ? '1 is due today' : `${dueToday} are due today`}.`;
  const { title } = first;
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

/** Is any pick'em game in progress? It puts Home in game day without being a matchup. */
export function pickemLive(leagues) {
  return (Array.isArray(leagues) ? leagues : [])
    .some((league) => league?.status && league.statusError !== true && league.status.pickem?.inProgress === true);
}


const greetingDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

const introSx = { m: 0, fontSize: { xs: '15px', md: '17px' }, color: 'var(--ps-dim)' };

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
