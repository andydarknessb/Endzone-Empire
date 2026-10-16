import React, { useEffect, useId, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, PixelHeading, PsLink, Skel, Tag,
} from '../../../shared/ui/playselect';
import { useLeagueTransactions } from '../../../entities/activity';
import { activityBadge, formatActivityTime } from '../model/recentActivityModel';

/**
 * The League Dashboard "Recent activity" frame (ADR 0067 wave 1b): a tertiary frame (2px Rule edge,
 * Pixel 16 heading) over `entities/activity`'s `useLeagueTransactions` (ADR 0020, ADR 0029). One row
 * per transaction - an activity kind tag, a sentence led by the Team name, a relative time - a plain
 * "{n} moves" count and an "All activity" link to the full log (`/league/:id/activity`, the existing
 * TransactionLog route). Kind tags are the product's own (Add, Drop, Trade, Waiver, Settings, Stat
 * correction, Recap) in Archivo 13px 700; boxed badges are reserved for things that need the viewer.
 *
 * Paints only `ps-*` tokens (DESIGN.md "Play-select: Home and league pages").
 *
 * The frame fetches exactly 17 rows (`useLeagueTransactions`'s own `limit`), the most it ever shows;
 * below `sm` only the first 3 of those render, with the "All activity" link carrying the rest. At and
 * above it the cap is the optional `rowLimit` (never more than the 17 fetched): the dashboard passes
 * `ceil(team count * 5 / 6)` so that, beside the standings, the two end about level, and 3 on game
 * day. The loading skeleton follows the SAME cap rather than always holding 17.
 *
 * `onFeedShort(boolean)` reports whether the resolved feed has fewer rows than the wide cap (#1998);
 * the dashboard stacks the frame under the standings when it does, since a short frame leaves the
 * column bare beside them.
 *
 * The frame is the region that owns its one read, so it carries `aria-busy` while `status` is
 * 'loading'. A failed read is one danger panel; Try again remounts the read.
 */

// ceil(20 * 5 / 6): the rows for the largest league (20 teams).
const FETCH_LIMIT = 17;
const PHONE_LIMIT = 3;

const metaSx = { fontSize: '13px', color: 'var(--ps-dim)' };

/** One skeleton row: the same kind tag + sentence + time shape as a real row, so the placeholder holds the loaded frame's height. */
function ActivitySkeletonRow({ last }) {
  return (
    <Box
      data-testid="recent-activity-skeleton-row"
      sx={{
        display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px', padding: '8px 0', boxSizing: 'border-box',
        borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <Skel width="72px" height={28} />
      <Box sx={{ flex: 1 }}><Skel width="70%" height={16} /></Box>
      <Skel width="44px" height={14} />
    </Box>
  );
}

/**
 * One transaction row: kind tag, the Team name (or "Commissioner") with its sentence, relative time.
 * The Team column renders `row.teamLabel` verbatim - the entity (`entities/activity`) is the one place
 * that decides what a teamless row's Team column reads (#1144): "Commissioner" for a teamless
 * `commissioner` row, blank for every other teamless row (`recap`, `stat_correction`, ...). This
 * widget makes no transaction-type decision of its own.
 */
function ActivityRow({ row, last, now }) {
  const badge = activityBadge(row.type);
  const sentence = (
    <>
      <Box component="span" data-testid="recent-activity-team" sx={{ fontWeight: 600 }}>{row.teamLabel}</Box>
      {row.teamLabel ? ' ' : null}
      <Box component="span" data-testid="recent-activity-sentence">{row.sentence}</Box>
    </>
  );
  const time = (
    <Box component="span" data-testid="recent-activity-time" sx={{ ...metaSx, whiteSpace: 'nowrap' }}>
      {formatActivityTime(row.at, now)}
    </Box>
  );
  return (
    <Box
      component="li"
      data-testid="recent-activity-row"
      data-type={row.type}
      sx={{
        display: 'grid',
        gridTemplateAreas: { xs: '"tag time" "text text"', sm: '"tag text time"' },
        gridTemplateColumns: { xs: 'auto 1fr', sm: '160px minmax(0, 1fr) auto' },
        alignItems: 'start',
        gap: { xs: '6px 12px', sm: '12px' },
        minHeight: '44px',
        boxSizing: 'border-box',
        padding: { xs: '10px 0', sm: '8px 0' },
        borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <Box component="span" sx={{ gridArea: 'tag', display: 'flex' }}>
        <Tag data-testid="recent-activity-kind">{badge.label}</Tag>
      </Box>
      <Box sx={{ gridArea: 'text', minWidth: 0, fontSize: '15px', paddingTop: { sm: '2px' } }}>{sentence}</Box>
      <Box sx={{ gridArea: 'time', justifySelf: 'end', paddingTop: { sm: '5px' } }}>{time}</Box>
    </Box>
  );
}

/**
 * `now` (epoch ms or a Date) is the clock the row times are measured against; it defaults to the
 * render time and exists so a test can pin it.
 */
export default function RecentActivity(props) {
  // Try again remounts the body, so its one useEndpoint read fires again.
  const [attempt, setAttempt] = useState(0);
  return <RecentActivityBody key={attempt} onRetry={() => setAttempt((n) => n + 1)} {...props} />;
}

function RecentActivityBody({
  leagueId, now, headingLevel = 2, rowLimit, onFeedShort, onRetry, sx, ...rest
}) {
  const { status, rows } = useLeagueTransactions(leagueId, { limit: FETCH_LIMIT });
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const headingId = useId();

  const wideLimit = rowLimit > 0 ? Math.min(rowLimit, FETCH_LIMIT) : FETCH_LIMIT;
  const limit = phone ? Math.min(PHONE_LIMIT, wideLimit) : wideLimit;
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const shown = list.slice(0, limit);
  const busy = status === 'loading';

  // The feed is "short" when it cannot fill the wide cap, so the frame sits under the standings.
  // While the read loads it is not short, so the row starts two columns.
  const feedShort = !busy && list.length < wideLimit;
  useEffect(() => {
    if (onFeedShort) onFeedShort(feedShort);
  }, [onFeedShort, feedShort]);

  if (status === 'error') {
    return (
      <Box data-testid="recent-activity" sx={sx} {...rest}>
        <ErrorPanel
          title="Recent activity"
          body="We could not load recent activity right now."
          onRetry={onRetry}
          retryAriaLabel="Try loading recent activity again"
        />
      </Box>
    );
  }

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="recent-activity"
      aria-busy={busy}
      sx={[{ display: 'flex', flexDirection: 'column', height: '100%' }, ...(Array.isArray(sx) ? sx : [sx])]}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} level={headingLevel} size={16}>Recent activity</PixelHeading>
          {status === 'ready' && shown.length > 0 && (
            <Box component="span" sx={metaSx}>{`${shown.length} ${shown.length === 1 ? 'move' : 'moves'}`}</Box>
          )}
          {leagueId != null && (
            <Box component="span" sx={{ marginLeft: 'auto' }} data-testid="recent-activity-all-link">
              <PsLink to={`/league/${leagueId}/activity`}>All activity</PsLink>
            </Box>
          )}
        </FrameHead>
      )}
      {...rest}
    >
      {status === 'loading' && (
        <Box aria-hidden="true" sx={{ padding: '4px 16px 8px' }}>
          {Array.from({ length: limit }, (_, i) => (
            <ActivitySkeletonRow key={i} last={i === limit - 1} />
          ))}
        </Box>
      )}

      {status === 'ready' && shown.length === 0 && (
        <Box
          component="p"
          data-testid="recent-activity-empty"
          sx={{ m: 0, padding: '20px', flex: 1, fontSize: '16px', color: 'var(--ps-dim)' }}
        >
          No moves yet this season.
        </Box>
      )}

      {status === 'ready' && shown.length > 0 && (
        <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, padding: '4px 16px 8px' }}>
          {shown.map((row, i) => (
            <ActivityRow key={row.id ?? i} row={row} last={i === shown.length - 1} now={now} />
          ))}
        </Box>
      )}
    </Frame>
  );
}
