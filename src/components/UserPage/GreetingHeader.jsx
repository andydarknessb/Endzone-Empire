import React from 'react';
import { Box, Typography } from '@mui/material';
import { teamStandingFromRow } from '../../entities/standings';
import { ordinal } from '../../shared/lib/ordinal';
import { isPickemOnly } from '../../shared/lib/leagueType';
import { hasStatus } from '../common/LeagueStatusCard';
import {
  DISPLAY_FONT, HAIRLINE, dimSx, microLabelSx,
} from '../common/homeIslandSx';

/**
 * The greeting header's three read-outs under and beside the h1 (Main.dc.html
 * and Mobile.dc.html): the summary line from the to-do list, the stat strip
 * and the live chip from the leagues list's status blocks (Contract B). None
 * of them fetches: the page hands down what it and ActionQueue already hold.
 *
 * Painted on the page (`dash-bg`, ADR 0051): the summary line is `dash-dim`
 * on the page; each stat tile is a `dash-surface` card with `dash-dim` terms
 * and `dash-ink` values; the live chip is `dash-danger` on the danger tint
 * over the page (4.57 light at the ruled 6% tint), its border decoration.
 */

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// The earliest deadline still ahead today. A live draft's deadline is "now",
// not a lock, so it never names the time.
function firstLockToday(items, now) {
  let first = null;
  items.forEach((item) => {
    if (!item || item.type === 'draft_live' || !item.deadlineAt) return;
    const at = new Date(item.deadlineAt).getTime();
    if (Number.isNaN(at) || at <= now || !sameLocalDay(at, now)) return;
    if (first === null || at < first) first = at;
  });
  return first;
}

/**
 * The summary line for a GET /api/user/action-items body, or null when there
 * is nothing honest to say (no body yet, or an empty list with item types the
 * server could not check, where "all caught up" would be a claim it can't
 * back). The total is the server's uncapped count, not the rows served.
 */
export function greetingSummary(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;
  const items = Array.isArray(body.items) ? body.items : [];
  const incomplete = Array.isArray(body.partial) && body.partial.length > 0;
  const total = typeof body.counts?.total === 'number' ? body.counts.total : items.length;
  if (total <= 0) return incomplete ? null : "You're all caught up.";

  const head = total === 1 ? '1 thing needs you.' : `${total} things need you.`;
  const dueToday = typeof body.counts?.dueToday === 'number' ? body.counts.dueToday : 0;
  if (dueToday <= 0) return head;

  const due = dueToday === 1 ? '1 is due today' : `${dueToday} are due today`;
  const first = firstLockToday(items, now);
  if (first === null) return `${head} ${due}.`;
  return `${head} ${due}, and ${dueToday === 1 ? 'it' : 'the first'} locks at ${timeFormat.format(first)}.`;
}

export function GreetingSummary({ actionItems }) {
  const text = greetingSummary(actionItems);
  if (!text) return null;
  return (
    <Typography data-testid="greeting-summary" sx={{ ...dimSx, fontSize: { xs: '15px', md: '16px' }, mt: 1.25 }}>
      {text}
    </Typography>
  );
}

const count = (value) => Number(value) || 0;

/**
 * The stat strip's tiles for the leagues list, each left out when no league
 * carries its data: the league count, the fantasy record summed across
 * fantasy leagues (spelled by the standings entity, the Record's one home),
 * and the best standing (the lowest rank; a tie goes to the bigger league).
 */
export function greetingStats(leagues) {
  const list = Array.isArray(leagues) ? leagues : [];
  if (list.length === 0) return [];
  const tiles = [{ key: 'leagues', label: 'Leagues', value: String(list.length) }];
  const withStatus = list.filter(hasStatus);

  const records = withStatus.filter((league) => !isPickemOnly(league) && league.status.record);
  if (records.length > 0) {
    const sum = records.reduce((acc, { status: { record } }) => ({
      wins: acc.wins + count(record.wins),
      losses: acc.losses + count(record.losses),
      ties: acc.ties + count(record.ties),
    }), { wins: 0, losses: 0, ties: 0 });
    tiles.push({ key: 'record', label: 'Fantasy record', value: teamStandingFromRow(sum).record });
  }

  const standings = withStatus
    .map((league) => league.status.standing)
    .filter((standing) => standing && ordinal(Number(standing.rank)));
  if (standings.length > 0) {
    const best = standings.reduce((a, b) => {
      const ra = Number(a.rank);
      const rb = Number(b.rank);
      if (rb !== ra) return rb < ra ? b : a;
      return count(b.of) > count(a.of) ? b : a;
    });
    tiles.push({
      key: 'standing', label: 'Best standing', value: ordinal(Number(best.rank)), of: count(best.of) > 0 ? best.of : null,
    });
  }
  return tiles;
}

const tileSx = {
  display: 'flex',
  flexDirection: 'column-reverse',
  px: 2,
  py: 1.25,
  borderRadius: 'var(--dash-radius-sm)',
  backgroundColor: 'var(--dash-surface)',
  border: HAIRLINE,
};

const valueSx = {
  m: 0,
  fontFamily: DISPLAY_FONT,
  fontSize: '26px',
  fontWeight: 700,
  lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--dash-ink)',
};

export function GreetingStats({ leagues }) {
  const tiles = greetingStats(leagues);
  if (tiles.length === 0) return null;
  return (
    <Box
      component="dl"
      data-testid="greeting-stats"
      sx={{ m: 0, mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}
    >
      {/* The term comes first in the DOM (a dt before its dd); the tile shows
          the value on top, as the board draws it. */}
      {tiles.map((tile) => (
        <Box key={tile.key} sx={tileSx}>
          <Box component="dt" sx={microLabelSx}>{tile.label}</Box>
          <Box component="dd" sx={valueSx}>
            {tile.value}
            {tile.of != null && (
              <Box component="span" sx={{ ...dimSx, fontFamily: 'var(--dash-font-body)', fontSize: '13px', fontWeight: 500 }}>
                {` of ${tile.of}`}
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** How many of the manager's matchups are live right now (ADR 0030 status). */
export function liveMatchupCount(leagues) {
  return (Array.isArray(leagues) ? leagues : [])
    .filter((league) => hasStatus(league) && league.status.matchup?.status === 'live')
    .length;
}

export function LiveMatchupsChip({ leagues }) {
  const live = liveMatchupCount(leagues);
  if (live === 0) return null;
  return (
    <Box
      component="span"
      data-testid="live-matchups-chip"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: '3px',
        borderRadius: 999,
        backgroundColor: 'var(--dash-danger-soft)',
        color: 'var(--dash-danger)',
        border: '1px solid var(--dash-danger)',
      }}
    >
      <Box
        component="span"
        aria-hidden="true"
        data-testid="live-dot"
        sx={{ width: 7, height: 7, borderRadius: 999, backgroundColor: 'var(--dash-danger)', flexShrink: 0 }}
      />
      {live === 1 ? '1 matchup live' : `${live} matchups live`}
    </Box>
  );
}
