import React from 'react';
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
 * The card fetches exactly 8 rows (`useLeagueTransactions`'s own `limit`);
 * below the `md` breakpoint only the first 5 of those render, matching the
 * mockup's mobile artboard. Loading always holds 8 skeleton rows regardless
 * of breakpoint, so the card never re-flows narrower the instant a mobile
 * read lands.
 *
 * The card is the region that owns its one read, so it carries `aria-busy`
 * while `status` is 'loading' (Skeleton.jsx: the loading state is announced
 * by the owning region, not by each aria-hidden shape).
 */

const FETCH_LIMIT = 8;
const MOBILE_LIMIT = 5;

const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const ROW_SX = (first) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  px: '18px',
  py: '9px',
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

/** One transaction row: type Badge, Team name (or "Commissioner") + sentence, relative time. */
function ActivityRow({ row, first, now }) {
  const badge = activityBadge(row.type);
  const teamLabel = row.teamName || 'Commissioner';

  return (
    <Box component="li" data-testid="recent-activity-row" data-type={row.type} sx={ROW_SX(first)}>
      <Badge variant={badge.variant} sx={{ flex: 'none' }}>
        {badge.label}
      </Badge>
      <Box sx={{ display: 'grid', gap: '2px', flex: '1 1 0', minWidth: 0 }}>
        <Box
          component="span"
          data-testid="recent-activity-team"
          sx={{ ...ELLIPSIS_SX, fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)' }}
        >
          {teamLabel}
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
export default function RecentActivity({ leagueId, now, headingLevel = 2, sx, ...rest }) {
  const { status, rows } = useLeagueTransactions(leagueId, { limit: FETCH_LIMIT });
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));

  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const shown = list.slice(0, mobile ? MOBILE_LIMIT : FETCH_LIMIT);
  const busy = status === 'loading';

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
            sx={{ color: 'inherit' }}
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
          {Array.from({ length: FETCH_LIMIT }, (_, i) => (
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
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {shown.map((row, i) => (
            <ActivityRow key={row.id ?? i} row={row} first={i === 0} now={now} />
          ))}
        </Box>
      )}
    </Card>
  );
}
