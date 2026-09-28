import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, LinearProgress, Link, Paper, Skeleton, Stack, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { visuallyHidden } from '@mui/utils';
import apiClient from '../../api/apiClient';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { formatInstant } from '../../shared/lib/instantFormat';
import {
  DISPLAY_FONT, HAIRLINE, alertActionSx, alertSx, dimSx, ghostButtonSx, microLabelSx, panelHeaderSx, panelSx,
  panelTitleSx, primaryButtonSx, progressSx, quietButtonSx, skeletonSx, textLinkSx,
} from '../common/homeIslandSx';

// The manager's to-do list (Home v2 slice 2): every open item across their
// leagues from GET /api/user/action-items (Contract A), in the order the
// server ranks them (blocking, timed by deadline, untimed, info). An item
// leaves when its state resolves, so this list is never "read"; it is only
// refetched. It owns its own fetch and states so a slow or failed to-do list
// never holds up the leagues list beside it.

// Rows shown before "Show all" (Handoff: ActionQueue maxVisible=4).
const MAX_VISIBLE = 4;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// Handoff (ActionItemRow): relative time under 24 hours, warning color under 2.
const RELATIVE_WINDOW_MS = 24 * HOUR_MS;
const URGENT_WINDOW_MS = 2 * HOUR_MS;

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// "in 1h 12m", "in 5h 07m", "in 45m".
function formatRelative(remainingMs) {
  const totalMinutes = Math.floor(remainingMs / MINUTE_MS);
  if (totalMinutes < 1) return 'in under a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `in ${minutes}m`;
  return `in ${hours}h ${String(minutes).padStart(2, '0')}m`;
}

// What the deadline column calls each item type's deadline (Contract A).
const DEADLINE_LABEL = {
  lineup_problem: 'Locks',
  picks_open: 'Picks lock',
  trade_review: 'Review ends',
  seats_open: 'Before',
  waiver_claims: 'Claims clear',
};

// The deadline column for one item: a micro label, the main value and a
// secondary line. `urgent` paints it in the warning color.
function deadlineParts(item, now) {
  if (item.type === 'draft_live') return { label: 'Draft', value: 'Live now', sub: null, urgent: true };
  const at = item.deadlineAt ? new Date(item.deadlineAt).getTime() : NaN;
  if (Number.isNaN(at)) return { label: 'No deadline', value: null, sub: null, urgent: false };
  const label = DEADLINE_LABEL[item.type] || 'Due';
  const remaining = at - now;
  if (remaining <= 0) return { label, value: 'Now', sub: null, urgent: true };
  if (remaining < RELATIVE_WINDOW_MS) {
    return { label, value: formatInstant(at, 'time'), sub: formatRelative(remaining), urgent: remaining < URGENT_WINDOW_MS };
  }
  return { label, value: formatInstant(at, 'day'), sub: formatInstant(at, 'kickoff'), urgent: false };
}

// The urgent tone is `warning.main`, the app palette's warning. It is the
// same hex as `dash-warning` in both modes (tokens.js), so it paints the
// island's color, and the render tests pin the deadline to the palette path.
// On a card it is the registered "to-do row deadline under two hours" row.
function DeadlineColumn({ item, now }) {
  const { label, value, sub, urgent } = deadlineParts(item, now);
  const tone = urgent ? 'warning.main' : 'var(--dash-dim)';
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'row', sm: 'column' },
        alignItems: { xs: 'baseline', sm: 'flex-start' },
        flexWrap: 'wrap',
        columnGap: 1,
      }}
    >
      <Typography
        component="span"
        sx={microLabelSx}
      >
        {label}
      </Typography>
      {value && (
        <Typography
          component="span"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontSize: { xs: 18, sm: 24 },
            fontWeight: 700,
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
            color: urgent ? 'warning.main' : 'var(--dash-ink)',
          }}
        >
          {value}
        </Typography>
      )}
      {sub && (
        <Typography component="span" variant="caption" sx={{ color: tone, fontSize: '12px', fontWeight: urgent ? 600 : 400 }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

// How each item type names its progress (Contract A: picks_open carries
// picks made, seats_open seats filled). Anything else reads as plain progress.
const PROGRESS_COPY = {
  picks_open: { label: 'Picks made', suffix: ' made' },
  seats_open: { label: 'Seats filled', suffix: ' filled' },
};

function ItemProgress({ type, progress }) {
  const total = Number(progress?.total);
  const done = Number(progress?.done);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(done)) return null;
  const copy = PROGRESS_COPY[type] || { label: 'Progress', suffix: '' };
  const clamped = Math.min(Math.max(done, 0), total);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {/* The ARIA values are the real counts, not MUI's 0-100 percentage. */}
      <LinearProgress
        variant="determinate"
        value={(clamped / total) * 100}
        aria-label={copy.label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} of ${total}`}
        sx={{ ...progressSx, width: { xs: 80, sm: 140 }, height: 6, borderRadius: 999 }}
      />
      <Typography variant="body2" aria-hidden="true" sx={{ ...dimSx, fontSize: '13px' }}>
        {`${clamped} of ${total}${copy.suffix}`}
      </Typography>
    </Stack>
  );
}

const ActionItemRow = React.forwardRef(function ActionItemRow({ item, primary, now }, ref) {
  return (
    <Box
      component="li"
      ref={ref}
      // Focusable only so Show all can move focus here; not a tab stop.
      tabIndex={ref ? -1 : undefined}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '112px minmax(0, 1fr) auto' },
        gap: { xs: 1.5, sm: 2.5 },
        alignItems: 'center',
        px: { xs: 2, sm: 2.5 },
        py: 2,
        borderBottom: HAIRLINE,
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <DeadlineColumn item={item} now={now} />
      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        <Typography data-testid="action-item-title" sx={{ fontSize: '16px', fontWeight: 600, color: 'var(--dash-ink)' }}>{item.title}</Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* The league tag: ink on a stat tile inside the card. */}
          {item.leagueName && (
            <Box
              component="span"
              sx={{
                px: 1, py: 0.25, borderRadius: '6px', border: HAIRLINE,
                backgroundColor: 'var(--dash-surface2)', color: 'var(--dash-ink)', fontSize: '13px', fontWeight: 500,
              }}
            >
              {item.leagueName}
            </Box>
          )}
          {item.detail && <Typography variant="body2" sx={{ ...dimSx, fontSize: '13px' }}>{item.detail}</Typography>}
          {item.progress && <ItemProgress type={item.type} progress={item.progress} />}
        </Stack>
      </Stack>
      {item.cta?.to && (
        <Button
          component={RouterLink}
          to={item.cta.to}
          variant={primary ? 'contained' : 'outlined'}
          sx={{ ...(primary ? primaryButtonSx : ghostButtonSx), ...MIN_TOUCH_TARGET_SX, px: 2.25, fontSize: '14px', whiteSpace: 'nowrap' }}
        >
          {item.cta.label}
        </Button>
      )}
    </Box>
  );
});

function ActionQueueSkeleton() {
  return (
    <Box data-testid="action-queue-skeleton" aria-busy="true">
      <Box component="span" role="status" sx={visuallyHidden}>Loading your to-do list</Box>
      {[70, 60].map((width) => (
        <Box
          key={width}
          sx={{
            height: 76, boxSizing: 'border-box', px: 2.5, py: 2, display: 'grid', gap: 2.5, alignItems: 'center',
            gridTemplateColumns: { xs: 'minmax(0, 1fr) 96px', sm: '90px minmax(0, 1fr) 110px' },
            borderBottom: HAIRLINE, '&:last-of-type': { borderBottom: 0 },
          }}
        >
          <Skeleton variant="rounded" height={36} sx={{ ...skeletonSx, display: { xs: 'none', sm: 'block' } }} />
          <Box>
            <Skeleton variant="text" width={`${width}%`} sx={skeletonSx} />
            <Skeleton variant="text" width={`${width - 30}%`} sx={skeletonSx} />
          </Box>
          <Skeleton variant="rounded" height={44} sx={{ ...skeletonSx, borderRadius: 'var(--dash-radius-sm)' }} />
        </Box>
      ))}
    </Box>
  );
}

function CaughtUp() {
  return (
    <Stack alignItems="center" spacing={1.25} sx={{ flexGrow: 1, p: 4, textAlign: 'center' }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
          color: 'var(--dash-accent)', backgroundColor: 'var(--dash-accent-soft)',
        }}
      >
        <CheckIcon sx={{ fontSize: 32 }} />
      </Box>
      <Typography
        variant="h5"
        component="h3"
        sx={{ fontFamily: DISPLAY_FONT, fontSize: { xs: '26px', sm: '30px' }, fontWeight: 700, lineHeight: 1.1, textTransform: 'uppercase' }}
      >
        You&apos;re all caught up
      </Typography>
      <Typography sx={{ ...dimSx, maxWidth: 380 }}>
        Every lineup is set and every pick is in.
      </Typography>
      <Link component={RouterLink} to="/waiver-wire" sx={{ ...textLinkSx, ...MIN_TOUCH_TARGET_SX, display: 'flex', alignItems: 'center', fontSize: '14px' }}>
        Browse the waiver wire
      </Link>
    </Stack>
  );
}

// `onLoaded(body)` hands the page the response body after each successful
// fetch, and null after a failed one, so the greeting header can summarize
// the list without a second request.
function ActionQueue({ onLoaded }) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The first row Show all reveals: the control disappears on click, so focus
  // moves here instead of dropping to the top of the page.
  const firstRevealedRef = useRef(null);
  // Relative deadlines ("in 1h 12m") repaint once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (expanded) firstRevealedRef.current?.focus();
  }, [expanded]);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/user/action-items', { params: { tz: viewerTimeZone() } });
      setData(response.data);
      setNow(Date.now());
      setFailed(false);
      onLoadedRef.current?.(response.data);
    } catch (err) {
      // Keep the last good list (if any) under the error. The page's summary
      // line is told there is nothing to summarize, so it steps back.
      setFailed(true);
      onLoadedRef.current?.(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = data?.counts?.total ?? items.length;
  const visible = expanded ? items : items.slice(0, MAX_VISIBLE);
  const hiddenCount = items.length - visible.length;
  // The skeleton only stands in for a list we don't have yet; a retry keeps
  // the good list up.
  const awaitingFirst = loading && !data;
  // Item types whose builder failed on the server: the rest still arrived,
  // but an empty list is then not proof that nothing needs the manager.
  const incomplete = Array.isArray(data?.partial) && data.partial.length > 0;

  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="action-queue-heading"
      sx={{ ...panelSx, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        useFlexGap
        flexWrap="wrap"
        sx={{ ...panelHeaderSx, px: { xs: 2, sm: 2.5 }, py: 2 }}
      >
        <Typography id="action-queue-heading" variant="h6" component="h2" sx={panelTitleSx}>
          Needs your attention
        </Typography>
        {data && (
          <Box
            component="span"
            data-testid="action-queue-count"
            // Warning on the warning tint, or accent on the accent tint when
            // clear: both registered over a card.
            sx={{
              minWidth: 24, height: 24, px: 1, boxSizing: 'border-box', borderRadius: 999, display: 'grid', placeItems: 'center',
              fontSize: '13px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: total > 0 ? 'var(--dash-warning)' : 'var(--dash-accent)',
              backgroundColor: total > 0 ? 'var(--dash-warning-soft)' : 'var(--dash-accent-soft)',
            }}
          >
            {total}
            <Box component="span" sx={visuallyHidden}>{total === 1 ? ' item' : ' items'}</Box>
          </Box>
        )}
        {items.length > 0 && (
          <Typography variant="body2" sx={{ ...dimSx, fontSize: '13px', ml: 'auto', textAlign: 'right' }}>
            {`Deadlines first · times in ${formatInstant(now, 'zone') || 'your time zone'}`}
          </Typography>
        )}
      </Stack>
      {failed && !loading && (
        <Alert
          severity="error"
          sx={{ ...alertSx('danger'), m: 2 }}
          action={<Button color="inherit" onClick={fetchItems} sx={{ ...alertActionSx('danger'), ...MIN_TOUCH_TARGET_SX }}>Try again</Button>}
        >
          We couldn&apos;t load your to-do list.
        </Alert>
      )}
      {awaitingFirst && <ActionQueueSkeleton />}
      {incomplete && !failed && (
        <Alert
          severity="warning"
          sx={{ ...alertSx('warning'), m: 2 }}
          action={<Button color="inherit" onClick={fetchItems} disabled={loading} sx={{ ...alertActionSx('warning'), ...MIN_TOUCH_TARGET_SX }}>Try again</Button>}
        >
          Some of your to-do list couldn&apos;t be checked right now.
        </Alert>
      )}
      {data && items.length === 0 && !incomplete && <CaughtUp />}
      {items.length > 0 && (
      <Box component="ol" id="action-queue-list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {visible.map((entry, index) => (
          <ActionItemRow
            key={entry.id}
            ref={expanded && index === MAX_VISIBLE ? firstRevealedRef : undefined}
            item={entry}
            now={now}
            primary={index === 0}
          />
        ))}
      </Box>
      )}
      {hiddenCount > 0 && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          // The footer well (`dash-surface2`): dim text, an accent action
          // and the focus ring, all registered over a stat tile.
          sx={{ mt: 'auto', px: { xs: 2, sm: 2.5 }, borderTop: HAIRLINE, backgroundColor: 'var(--dash-surface2)' }}
        >
          <Typography variant="body2" sx={{ ...dimSx, fontSize: '13px' }}>{`${hiddenCount} more`}</Typography>
          <Button
            aria-controls="action-queue-list"
            onClick={() => setExpanded(true)}
            sx={{ ...quietButtonSx, ...MIN_TOUCH_TARGET_SX, '&:hover': { ...quietButtonSx['&:hover'], backgroundColor: 'var(--dash-surface3)' } }}
          >
            {`Show all ${items.length}`}
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

export default ActionQueue;
