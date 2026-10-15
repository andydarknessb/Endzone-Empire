import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Box } from '@mui/material';
import apiClient from '../../api/apiClient';
import { formatInstant } from '../../shared/lib/instantFormat';
import { timeUntil, timeUntilWords, useNow } from '../../shared/lib/timeUntil';
import NextDraftCard, { featuredDraft } from './NextDraftCard';
import {
  CountBadge, ErrorPanel, Frame, FrameHead, HomeButton, HomeLink, PixelHeading, PlayCard, Skel, SR_ONLY_SX, pixelSx,
} from './home';

// "Call your plays" (Home Play-select, DESIGN.md "Home surface"): every open
// item across the manager's leagues from GET /api/user/action-items (Contract
// A) plus the featured draft, as play cards, then "On the sideline" for what
// is only pending. It owns its own fetch and states so a slow or failed list
// never holds up the leagues beside it.

// Cards shown before "Show all" (Handoff: ActionQueue maxVisible=4).
const MAX_VISIBLE = 4;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RULE = '2px solid var(--home-rule)';

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const timeMs = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
};
const weekday = (at, style = 'short') => new Intl.DateTimeFormat(undefined, { weekday: style }).format(at);

// Item type -> play kind (the pictogram). A draft_live and a seats_open both
// belong to the draft; an unknown actionable type reads as a generic to-do,
// which the lineup diagram is the closest to.
const KIND = {
  picks_open: 'picks',
  lineup_problem: 'lineup',
  draft_live: 'draft',
  seats_open: 'draft',
  trade_review: 'trade',
  trade_offer: 'trade',
};
const FALLBACK_KIND = 'lineup';

// Info rows (FYI, nothing to do) and join requests sit on the sideline, not in the cards.
const isSideline = (item) => item.severity === 'info' || item.type === 'join_requests';

// The earliest instant anything on the card list reads differently: a lock's
// relative text ticking over, a card crossing into its last hour (the urgent
// strip) or past its lock, a draft's start, or the "updated" stamp's minute.
function nextChange(items, leagues, updatedAt, now) {
  let next = null;
  const consider = (instant) => {
    if (instant > now && (next === null || instant < next)) next = instant;
  };
  items.forEach((item) => {
    if (item.type === 'draft_live' || isSideline(item)) return;
    const at = timeMs(item.deadlineAt);
    if (at === null || at <= now) return;
    consider(at);
    consider(at - HOUR_MS + 1);
    consider(timeUntil(at, now).changesAt);
  });
  leagues.forEach((league) => {
    const at = timeMs(league?.draft_date);
    if (at === null || at <= now) return;
    consider(at);
    consider(timeUntil(at, now).changesAt);
  });
  if (updatedAt) consider(updatedAt + (Math.floor((now - updatedAt) / MINUTE_MS) + 1) * MINUTE_MS);
  return next;
}

// The lock line: "THU 7:15 PM", the date past a week out, "NOW" once passed.
function lockParts(at, now) {
  if (at === null) return { lockDay: 'No deadline', lockTime: '' };
  if (at <= now) return { lockDay: 'Now', lockTime: '' };
  return {
    lockDay: at - now >= 6 * DAY_MS ? formatInstant(at, 'day') : weekday(at),
    lockTime: formatInstant(at, 'time'),
  };
}

const spoken = ({ lockDay, lockTime }) => [lockDay, lockTime].filter(Boolean).join(' ');

// The week number rides in the id's key ("picks_open:4:2026-6"); the item has no field for it.
const weekOf = (item) => /-(\d+)$/.exec(String(item.id))?.[1] ?? null;

// Shared Lock Rule: the picks_open items that share one lock are one card, with
// one foot per league (alphabetical) when there are several; a different lock
// is a different card.
function picksSpec(group) {
  const at = (entry) => timeMs(entry.deadlineAt);
  const sorted = [...group].sort((a, b) => (at(a) ?? Infinity) - (at(b) ?? Infinity)
    || String(a.leagueName).localeCompare(String(b.leagueName)));
  const first = sorted[0];
  const lockAt = at(first);
  const week = weekOf(first);
  const games = Math.max(0, ...group.map((entry) => Number(entry.progress?.total) || 0));
  const multi = group.length > 1;
  const cta = { label: first.cta?.label || 'Make picks', to: first.cta?.to };
  return {
    key: `picks_open:${lockAt}`,
    at: lockAt,
    title: first.title,
    render: (now2, lead, state) => {
      const words = lockAt !== null ? timeUntilWords(lockAt, now2) : null;
      const lock = lockParts(lockAt, now2);
      return (
        <PlayCard
          kind="picks"
          name={week ? `Week ${week} picks` : 'Your picks'}
          league={multi ? `${group.length} leagues` : first.leagueName}
          detail={games ? `${games} games` : null}
          {...lock}
          countdown={state === 'urgent' ? `${Math.max(1, Math.floor((lockAt - now2) / MINUTE_MS))} min` : undefined}
          lockNote={words
            ? `First game locks in ${words}. Each game locks at its own kickoff.`
            : 'Games are locking. Each game locks at its own kickoff.'}
          cta={cta}
          actions={multi ? sorted.map((entry) => {
            const note = entry.progress ? `${entry.progress.done} of ${entry.progress.total} made` : null;
            return {
              label: entry.leagueName,
              note,
              to: entry.cta?.to,
              ariaLabel: `${cta.label} in ${entry.leagueName}${note ? `, ${note}` : ''}`,
            };
          }) : undefined}
          ariaLabel={`${cta.label} in ${multi ? `${group.length} leagues` : first.leagueName}${lockAt !== null ? `, ${spoken(lock)}` : ''}`}
          state={state}
          lead={lead}
        />
      );
    },
  };
}

function itemSpec(item) {
  const at = timeMs(item.deadlineAt);
  return {
    key: item.id,
    at,
    title: item.title,
    render: (now, lead, state) => {
      const lock = lockParts(at, now);
      return (
        <PlayCard
          kind={KIND[item.type] || FALLBACK_KIND}
          name={item.title}
          league={item.leagueName}
          {...lock}
          countdown={state === 'urgent' ? `${Math.max(1, Math.floor((at - now) / MINUTE_MS))} min` : undefined}
          lockNote={item.detail}
          cta={item.cta}
          ariaLabel={`${item.cta?.label || item.title} in ${item.leagueName}${at !== null ? `, ${spoken(lock)}` : ''}`}
          state={state}
          lead={lead}
        />
      );
    },
  };
}

// The featured draft, or a live draft the list names while the leagues have not
// loaded (or name another league), as a draft card. A draft has no lock: `at` is null.
function draftSpec(league, onDraftExpire) {
  return {
    key: `draft:${league.id}`,
    leagueId: league.id,
    at: null,
    render: (now, lead) => (
      <NextDraftCard
        league={league}
        now={now}
        lead={lead}
        commissioner={league.is_owner === true || league.is_commissioner === true}
        onExpire={onDraftExpire}
      />
    ),
  };
}

// The plays on the page, in order, from a GET /api/user/action-items body, the
// leagues and the clock: the one list the cards, the count badge and the
// greeting's number all come from. The lead is the earliest lock still ahead;
// the plays with no lock (drafts, untimed offers) follow in the server's order.
// A live draft never outranks a timed play, but a play whose lock has already
// passed never outranks the draft card either, and a past-deadline seats_open
// is dropped when a draft card for its league is shown.
export function buildPlays(body, leagues, now, onDraftExpire) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const featured = featuredDraft(leagues, now);
  const drafts = [];
  if (featured) drafts.push(draftSpec(featured.league, onDraftExpire));
  const actionable = items.filter((item) => !isSideline(item));
  actionable.filter((item) => item.type === 'draft_live').forEach((item) => {
    if (featured?.state === 'live' && String(featured.league.id) === String(item.leagueId)) return;
    drafts.push(draftSpec({ id: item.leagueId, name: item.leagueName, draft_status: 'active' }, onDraftExpire));
  });
  const draftLeagues = new Set(drafts.map((spec) => String(spec.leagueId)));
  const stale = (item) => item.type === 'seats_open' && timeMs(item.deadlineAt) !== null && timeMs(item.deadlineAt) <= now
    && draftLeagues.has(String(item.leagueId));
  const picks = actionable.filter((item) => item.type === 'picks_open');
  const others = actionable.filter((item) => item.type !== 'picks_open' && item.type !== 'draft_live' && !stale(item));
  const picksByLock = new Map();
  picks.forEach((item) => {
    const key = timeMs(item.deadlineAt);
    picksByLock.set(key, [...(picksByLock.get(key) || []), item]);
  });
  const specs = [...[...picksByLock.values()].map(picksSpec), ...others.map(itemSpec)];
  const timed = specs.filter((spec) => spec.at !== null).sort((a, b) => a.at - b.at);
  const untimed = specs.filter((spec) => spec.at === null);
  const passed = drafts.length > 0 ? timed.filter((spec) => spec.at <= now) : [];
  return [...timed.filter((spec) => !passed.includes(spec)), ...drafts, ...passed, ...untimed];
}

const metaSx = {
  fontSize: '13px',
  color: 'var(--home-dim)',
  marginLeft: { md: 'auto' },
  flexBasis: { xs: '100%', md: 'auto' },
};

const sidelineHeadSx = { margin: 0, ...pixelSx(16), color: 'var(--home-dim)' };

function SidelineRow({ item }) {
  const at = timeMs(item.deadlineAt);
  const tail = item.type === 'waiver_claims' && at !== null
    ? `clears ${formatInstant(at, 'weekdayTime')}`
    : item.detail;
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px 16px',
        padding: '12px 0',
        borderTop: RULE,
      }}
    >
      <Box>
        <Box sx={{ fontWeight: 600 }}>{item.title}</Box>
        <Box sx={{ fontSize: '14px', color: 'var(--home-dim)' }}>{[item.leagueName, tail].filter(Boolean).join(' · ')}</Box>
      </Box>
      {item.cta?.to && (
        <HomeLink to={item.cta.to} ariaLabel={`${item.cta.label} in ${item.leagueName}`}>{item.cta.label}</HomeLink>
      )}
    </Box>
  );
}

function ActionQueueSkeleton() {
  return (
    <Frame labelledBy="action-queue-loading">
      <Box data-testid="action-queue-skeleton" aria-busy="true">
        <Box component="span" id="action-queue-loading" role="status" sx={SR_ONLY_SX}>Loading your plays</Box>
        <FrameHead>
          <Skel width="200px" height={20} />
          <Skel width="28px" height={28} />
          <Box component="span" sx={{ ...metaSx, width: { xs: '100%', md: '240px' } }}><Skel width="100%" height={14} /></Box>
        </FrameHead>
        <Box
          aria-hidden="true"
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: '8px', padding: '12px' }}
        >
          <Box sx={{ gridColumn: { md: 'span 2' }, padding: '8px', border: '4px solid transparent' }}>
            <Box sx={{
              display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', backgroundColor: 'var(--home-panel)', border: RULE,
            }}
            >
              <Skel width="96px" height={48} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><Skel width="70%" height={20} /><Skel width="50%" height={14} /></Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><Skel width="40%" height={14} /><Skel width="80%" height={14} /></Box>
              <Skel width="100%" height={40} />
            </Box>
          </Box>
          <Box sx={{
            gridColumn: { md: 'span 2' }, padding: '12px 12px 12px 20px', display: 'flex', flexDirection: 'column', gap: '12px',
          }}
          >
            <Skel width="40%" height={16} />
            <Skel width="90%" height={14} />
            <Skel width="70%" height={14} />
          </Box>
        </Box>
      </Box>
    </Frame>
  );
}

// `onLoaded(body)` hands the page the response body after each successful
// fetch, and null after a failed one, so the greeting header can summarize
// the list without a second request. `onPlaysChange(plays, now)` hands it the
// plays the cards show, with the clock they were built at, whenever that list
// changes (a play added or dropped, a lock passing, the date turning), so the
// greeting and the badge never count on different clocks. `refreshKey` changing refetches quietly
// (no skeleton; a failed refetch keeps the plays on screen). `onDraftExpire`
// fires when a scheduled draft's time arrives.
function ActionQueue({
  onLoaded, onPlaysChange = undefined, leagues = [], refreshKey = 0, onDraftExpire = undefined,
}) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onPlaysChangeRef = useRef(onPlaysChange);
  onPlaysChangeRef.current = onPlaysChange;
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The first card Show all reveals: the button disappears on click, so focus
  // moves here instead of dropping to the top of the page.
  const firstRevealedRef = useRef(null);
  const items = Array.isArray(data?.items) ? data.items : [];
  // Lock text ("in 1h 12m"), the urgent strip and the stamp repaint exactly
  // when one of them would read differently; a refetch re-reads the clock.
  const now = useNow((at) => nextChange(items, leagues, updatedAt, at), data);

  useEffect(() => {
    if (expanded) firstRevealedRef.current?.focus();
  }, [expanded]);

  // Only the newest fetch may report: an answer that lands after unmount or
  // after a newer fetch began is dropped, so it never reaches onLoaded or state.
  const latestFetch = useRef(0);
  useEffect(() => () => { latestFetch.current += 1; }, []);

  const fetchItems = useCallback(async ({ silent = false } = {}) => {
    latestFetch.current += 1;
    const mine = latestFetch.current;
    const stale = () => mine !== latestFetch.current;
    try {
      if (!silent) setLoading(true);
      const response = await apiClient.get('/api/user/action-items', { params: { tz: viewerTimeZone() } });
      if (stale()) return;
      setData(response.data);
      setUpdatedAt(Date.now());
      setFailed(false);
      onLoadedRef.current?.(response.data);
    } catch (err) {
      if (stale()) return;
      // A quiet refetch that fails leaves the plays we have.
      if (silent && dataRef.current) return;
      setFailed(true);
      onLoadedRef.current?.(null);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const specs = data ? buildPlays(data, leagues, now, onDraftExpire) : [];
  // What the greeting reads off the list: which plays, which locks have passed, and today's date.
  const playsSignature = data
    ? `${new Date(now).toDateString()}|${specs.map((spec) => `${spec.key}@${spec.at}@${spec.title}${spec.at !== null && spec.at <= now ? 'p' : ''}`).join('|')}`
    : null;
  const latestPlays = useRef(null);
  latestPlays.current = { specs, now };
  useEffect(() => {
    if (playsSignature !== null) onPlaysChangeRef.current?.(latestPlays.current.specs, latestPlays.current.now);
  }, [playsSignature]);

  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    fetchItems({ silent: true });
  }, [refreshKey, fetchItems]);

  if (loading && !data) return <ActionQueueSkeleton />;

  // Item types whose builder failed on the server: the rest still arrived, but
  // an empty list is then not proof that nothing needs the manager.
  const incomplete = Array.isArray(data?.partial) && data.partial.length > 0;
  if (failed || !data || (incomplete && specs.length === 0)) {
    return (
      <ErrorPanel
        title="Couldn't check what needs you"
        body="Your leagues are below. Open each one, or try again."
        onRetry={() => fetchItems()}
        retryAriaLabel="Try checking your plays again"
      />
    );
  }

  const sideline = items.filter(isSideline);
  const lead = specs[0];
  const urgent = lead?.at != null && lead.at > now && lead.at - now < HOUR_MS;
  const visible = expanded ? specs : specs.slice(0, MAX_VISIBLE);
  const hiddenCount = specs.length - visible.length;
  const wide = specs.length <= 2;
  const zone = formatInstant(now, 'zone') || 'your time zone';
  const minutes = Math.floor((now - updatedAt) / MINUTE_MS);
  const stamp = minutes < 1 ? 'updated just now' : `updated ${minutes} min ago`;
  const nextLock = specs.map((spec) => spec.at).filter((at) => at !== null && at > now).sort((x, y) => x - y)[0];

  const head = (
    <FrameHead>
      <PixelHeading id="action-queue-heading">Call your plays</PixelHeading>
      {specs.length > 0 && <CountBadge n={specs.length} />}
      {specs.length > 0 && (
        <Box component="span" sx={metaSx}>{`Earliest lock first · times in ${zone} · ${stamp}`}</Box>
      )}
    </FrameHead>
  );

  if (specs.length === 0) {
    return (
      <Frame labelledBy="action-queue-heading" head={head}>
        <Box sx={{ padding: '20px', ...pixelSx(16) }}>Nothing needs you right now.</Box>
        {sideline.length > 0 && (
          <Box sx={{ padding: '0 20px 4px', borderTop: RULE }}>
            <Box component="h3" sx={{ ...sidelineHeadSx, margin: '12px 0 0' }}>On the sideline</Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: '0 32px', paddingBottom: '12px' }}>
              {sideline.map((item) => <SidelineRow key={item.id} item={item} />)}
            </Box>
          </Box>
        )}
      </Frame>
    );
  }

  return (
    <Frame labelledBy="action-queue-heading" head={head}>
      <Box
        id="action-queue-list"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' },
          gap: '8px',
          padding: '12px',
        }}
      >
        {visible.map((spec, index) => (
          <Box
            key={spec.key}
            ref={expanded && index === MAX_VISIBLE ? firstRevealedRef : undefined}
            tabIndex={expanded && index === MAX_VISIBLE ? -1 : undefined}
            sx={{ gridColumn: { md: specs.length === 1 ? 'span 2' : 'span 1' }, minWidth: 0 }}
          >
            {spec.render(now, index === 0, index === 0 && urgent ? 'urgent' : index === 0 ? 'next' : 'open')}
          </Box>
        ))}
        <Box
          sx={{
            gridColumn: { xs: '1 / -1', md: wide ? 'span 2' : '1 / -1' },
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: { xs: '12px 4px 4px', md: wide ? '12px 12px 12px 20px' : '12px 4px 4px' },
            borderTop: { xs: RULE, md: wide ? 'none' : RULE },
            borderLeft: { xs: 'none', md: wide ? RULE : 'none' },
          }}
        >
          <Box component="h3" sx={sidelineHeadSx}>On the sideline</Box>
          {sideline.map((item) => <SidelineRow key={item.id} item={item} />)}
          <Box component="p" sx={{ margin: 0, fontSize: '14px', color: 'var(--home-dim)' }}>
            {nextLock && new Date(nextLock).toDateString() === new Date(now).toDateString() && 'Nothing else is due today.'}
            {nextLock && new Date(nextLock).toDateString() !== new Date(now).toDateString() && `Nothing else is due before ${weekday(nextLock, 'long')}'s kickoff.`}
            {!nextLock && 'Nothing else needs you today.'}
          </Box>
        </Box>
      </Box>
      {hiddenCount > 0 && (
        <Box sx={{ padding: '0 12px 12px' }}>
          <HomeButton variant="quiet" onClick={() => setExpanded(true)}>{`Show all ${specs.length}`}</HomeButton>
        </Box>
      )}
    </Frame>
  );
}

export default ActionQueue;
