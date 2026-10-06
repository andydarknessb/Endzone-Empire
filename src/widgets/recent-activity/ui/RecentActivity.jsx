import React, { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Badge, Card, Skeleton } from '../../../shared/ui';
import { useLeagueTransactions } from '../../../entities/activity';
import { activityBadge, formatActivityTime } from '../model/recentActivityModel';

/**
 * The League Dashboard "Recent activity" rail card (ticket #1105): a Card
 * titled "Recent activity" over `entities/activity`'s `useLeagueTransactions`
 * (ADR 0020, ADR 0029), transcribed from the design source (docs/design/
 * league-dashboard-v2/build.mjs, `recentActivity()`). One row per
 * transaction - a type Badge, a Team name / sentence column, a relative time
 * - and a tail link to the full log (`/league/:id/activity`, the existing
 * TransactionLog route).
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. The row's
 * ink/dim/faint tiers on `dash-surface` and the five Badge variants
 * (success/danger/live/neutral/warning) on that same surface are already
 * registered in tokens.contrast.test.js (see Badge.jsx's own docblock); no
 * new pairing is composed here. The tail link sets `color: inherit` so it
 * reads in the tail's own `dash-faint` tier rather than the app-wide anchor
 * accent (`src/theme/base.css`'s bare `a` rule), matching the mockup's plain
 * (non-accented) "All activity" text.
 *
 * The card fetches exactly 17 rows (`useLeagueTransactions`'s own `limit`), the
 * most the rail ever shows; below the `md` breakpoint only the first 5 of those
 * render, matching the mockup's mobile artboard. At and above it the cap is the
 * optional `rowLimit` (never more than the 17 fetched): the dashboard passes
 * `ceil(team count * 5 / 6)` because, while the feed fills the rail, this card
 * rides the rail beside the standings (a feed with fewer rows stacks it under
 * them, see `onFeedShort` below), and a standings row measures 49px against
 * 58.8px for an activity row (6:5), so that many rows end the rail about where
 * the standings table does instead of leaving bare page under it (#1993). 17 is that count for a
 * 20-team league, the largest. The loading skeleton follows the SAME cap (5
 * rows below `md`, `rowLimit` or 17 at and above it) rather than always
 * holding 17, so loading never overshoots the row count the breakpoint is
 * about to show.
 *
 * `onFeedShort(boolean)` reports whether the resolved feed has fewer rows than
 * the md+ cap (#1998); the dashboard stacks the card under the standings when
 * it does, since a short card leaves the rail column bare beside them.
 *
 * The card is the region that owns its one read, so it carries `aria-busy`
 * while `status` is 'loading' (Skeleton.jsx: the loading state is announced
 * by the owning region, not by each aria-hidden shape).
 */

// ceil(20 * 5 / 6): the rail rows for the largest league (20 teams), see below.
const FETCH_LIMIT = 17;
const MOBILE_LIMIT = 5;

const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// padding/gap match the design source verbatim (docs/design/
// league-dashboard-v2/build.mjs's recentActivity(): `padding:8px 18px`).
const ROW_SX = (first) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  px: '18px',
  py: '8px',
  borderTop: first ? 0 : '1px solid var(--dash-line)',
});

/** One skeleton row: the same badge + two-line + time shape as a real row, so the placeholder holds the loaded card's height. */
function ActivitySkeletonRow({ first }) {
  return (
    <Box data-testid="recent-activity-skeleton-row" sx={ROW_SX(first)}>
      <Skeleton data-testid="recent-activity-skeleton" variant="rounded" width={54} height={20} sx={{ flex: 'none' }} />
      <Box sx={{ flex: '1 1 0', minWidth: 0, display: 'grid', gap: 0.5 }}>
        <Skeleton data-testid="recent-activity-skeleton" variant="text" width="55%" height={14} />
        <Skeleton data-testid="recent-activity-skeleton" variant="text" width="80%" height={12} />
      </Box>
      <Skeleton data-testid="recent-activity-skeleton" variant="text" width={44} height={12} sx={{ flex: 'none' }} />
    </Box>
  );
}

/**
 * One transaction row: type Badge, Team name (or "Commissioner") + sentence,
 * relative time. The Team column renders `row.teamLabel` verbatim - the
 * entity (`entities/activity`) is the one place that decides what a
 * teamless row's Team column reads (#1144): "Commissioner" for a teamless
 * `commissioner` row, blank for every other teamless row (`recap`,
 * `stat_correction`, ...). This widget makes no transaction-type decision of
 * its own.
 */
function ActivityRow({ row, first, now }) {
  const badge = activityBadge(row.type);

  return (
    <Box component="li" data-testid="recent-activity-row" data-type={row.type} sx={ROW_SX(first)}>
      <Badge variant={badge.variant} sx={{ flex: 'none' }}>
        {badge.label}
      </Badge>
      <Box sx={{ display: 'grid', gap: '1px', flex: '1 1 0', minWidth: 0 }}>
        <Box
          component="span"
          data-testid="recent-activity-team"
          sx={{ ...ELLIPSIS_SX, fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)' }}
        >
          {row.teamLabel}
        </Box>
        <Box
          component="span"
          data-testid="recent-activity-sentence"
          sx={{ ...ELLIPSIS_SX, fontSize: '12.5px', color: 'var(--dash-dim)' }}
        >
          {row.sentence}
        </Box>
      </Box>
      <Box
        component="span"
        data-testid="recent-activity-time"
        sx={{ flex: 'none', fontSize: '12px', color: 'var(--dash-faint)' }}
      >
        {formatActivityTime(row.at, now)}
      </Box>
    </Box>
  );
}

/**
 * `now` (epoch ms or a Date) is the clock the row times are measured
 * against; it defaults to the render time and exists so a test can pin it.
 */
export default function RecentActivity({ leagueId, now, headingLevel = 2, rowLimit, onFeedShort, sx, ...rest }) {
  const { status, rows } = useLeagueTransactions(leagueId, { limit: FETCH_LIMIT });
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));

  // The md+ cap: the caller's `rowLimit` when it is a positive number, never
  // above the rows the read returns. Below md the phone cap wins regardless.
  const wideLimit = rowLimit > 0 ? Math.min(rowLimit, FETCH_LIMIT) : FETCH_LIMIT;
  const limit = mobile ? MOBILE_LIMIT : wideLimit;
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const shown = list.slice(0, limit);
  const busy = status === 'loading';

  // Reports up whether the resolved feed is too short to fill the md+ rail
  // (zero rows and a failed read included), judged on `wideLimit` and not on
  // the phone cap, so the answer does not change with the viewport. The page
  // stacks the card under the standings on it (#1998). The widget stays the
  // feed's only reader: a second `useLeagueTransactions` caller is a second
  // request.
  const feedShort = !busy && list.length < wideLimit;
  useEffect(() => {
    if (onFeedShort) onFeedShort(feedShort);
  }, [onFeedShort, feedShort]);

  return (
    <Card
      data-testid="recent-activity"
      title="Recent activity"
      count={status === 'ready' ? String(shown.length) : undefined}
      tail={
        leagueId != null ? (
          <Box
            component={RouterLink}
            to={`/league/${leagueId}/activity`}
            data-testid="recent-activity-all-link"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              // The card's only interactive element, so its hit area needs to
              // clear the touch-target floor on its own. Matches LineupsCard's
              // "Full comparison" tail action (src/widgets/retro-scoreboard/
              // ui/LineupsCard.jsx) in full: the same minHeight/px shape, plus
              // its border-radius and focus/hover treatment, not just the size.
              minHeight: mobile ? 44 : 30,
              px: '6px',
              mx: '-6px',
              borderRadius: 'var(--radius-sm)',
              color: 'inherit',
              '&:hover': { color: 'var(--dash-ink)' },
              '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
            }}
          >
            All activity
          </Box>
        ) : undefined
      }
      headingLevel={headingLevel}
      aria-busy={busy}
      sx={sx}
      {...rest}
    >
      {status === 'loading' && (
        <Box aria-hidden="true">
          {Array.from({ length: limit }, (_, i) => (
            <ActivitySkeletonRow key={i} first={i === 0} />
          ))}
        </Box>
      )}

      {status === 'error' && (
        <Box sx={{ p: 2.25 }}>
          <Typography role="alert" data-testid="recent-activity-error" sx={{ m: 0, fontSize: '13px', color: 'var(--dash-ink)' }}>
            We could not load recent activity right now.
          </Typography>
        </Box>
      )}

      {status === 'ready' && shown.length === 0 && (
        <Box sx={{ p: 2.25 }}>
          <Typography component="p" data-testid="recent-activity-empty" sx={{ m: 0, fontSize: '13px', color: 'var(--dash-dim)' }}>
            No moves yet this season.
          </Typography>
        </Box>
      )}

      {status === 'ready' && shown.length > 0 && (
        <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {shown.map((row, i) => (
            <ActivityRow key={row.id ?? i} row={row} first={i === 0} now={now} />
          ))}
        </Box>
      )}
    </Card>
  );
}
