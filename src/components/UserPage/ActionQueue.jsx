import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { playModel, useActionItems } from '../../entities/action-item';
import { formatInstant } from '../../shared/lib/instantFormat';
import { timeUntil, timeUntilWords, useNow } from '../../shared/lib/timeUntil';
import NextDraftCard, { featuredDraft } from './NextDraftCard';
import {
  CountBadge, ErrorPanel, Frame, FrameHead, PsButton, PsLink, PixelHeading, PlayCard, Skel, SR_ONLY_SX, pixelSx,
} from '../../shared/ui/playselect';

// "Call your plays" (Home Play-select, DESIGN.md "Play-select"): every open
// item across the manager's leagues from GET /api/user/action-items (Contract
// A) plus the featured draft, as play cards, then "On the sideline" for what
// is only pending. It reads through useActionItems and owns its states so a
// slow or failed list never holds up the leagues beside it. The Action item
// entity's playModel groups the items into Plays (the Shared Lock Rule); this
// file adds the featured draft and draws the cards.

// Cards shown before "Show all" (Handoff: ActionQueue maxVisible=4).
const MAX_VISIBLE = 4;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RULE = '2px solid var(--ps-rule)';

const timeMs = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
};
const weekday = (at, style = 'short') => new Intl.DateTimeFormat(undefined, { weekday: style }).format(at);

// Item type -> play kind (the pictogram). A draft_live and a seats_open both
// belong to the draft; an unknown actionable type reads as a generic play,
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

// The earliest instant anything on the card list reads differently: a lock's
// relative text ticking over, a card crossing into its last hour (the urgent
// strip) or past its lock, a draft's start, or the "updated" stamp's minute.
function nextChange(items, leagues, updatedAt, now) {
  let next = null;
  const consider = (instant) => {
    if (instant > now && (next === null || instant < next)) next = instant;
  };
  playModel(items, { now }).plays.flatMap((play) => play.feet).forEach((item) => {
    if (item.type === 'draft_live') return;
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

// A Play (the entity's Shared Lock Rule: the items that share one lock, whatever their type and
// across leagues, or one untimed item) as a card, with a foot per item when there are several.
function playSpec(play) {
  const { feet, leagues: names, name } = play;
  const first = feet[0];
  const at = timeMs(first.deadlineAt);
  const multi = feet.length > 1;
  const crossLeague = names.length > 1;
  const sameType = new Set(feet.map((foot) => foot.type)).size === 1;
  const hasPicks = feet.some((foot) => foot.type === 'picks_open');
  const games = Math.max(0, ...feet.map((foot) => Number(foot.progress?.total) || 0));
  const league = crossLeague ? `${names.length} leagues` : first.leagueName;
  const cta = multi ? undefined : { label: first.cta?.label || (hasPicks ? 'Make picks' : first.title), to: first.cta?.to };
  const label = (foot) => foot.cta?.label || (foot.type === 'picks_open' ? 'Make picks' : foot.title);
  return {
    key: play.key,
    at,
    title: name,
    render: (now, lead, state) => {
      const words = at !== null ? timeUntilWords(at, now) : null;
      const lock = lockParts(at, now);
      const picksNote = words
        ? `First game locks in ${words}. Each game locks at its own kickoff.`
        : 'Games are locking. Each game locks at its own kickoff.';
      return (
        <PlayCard
          kind={KIND[first.type] || FALLBACK_KIND}
          name={name}
          league={league}
          detail={hasPicks && games ? `${games} games` : null}
          {...lock}
          countdown={state === 'urgent' ? `${Math.max(1, Math.floor((at - now) / MINUTE_MS))} min` : undefined}
          lockNote={hasPicks ? picksNote : (multi ? null : first.detail)}
          cta={cta}
          actions={multi ? feet.map((foot) => {
            const note = foot.progress ? `${foot.progress.done} of ${foot.progress.total} made` : null;
            return {
              key: foot.id,
              label: crossLeague && sameType ? foot.leagueName : label(foot),
              note: note || (crossLeague && !sameType ? foot.leagueName : null),
              to: foot.cta?.to,
              ariaLabel: `${label(foot)} in ${foot.leagueName}${note ? `, ${note}` : ''}`,
            };
          }) : undefined}
          ariaLabel={`${cta?.label || name} in ${league}${at !== null ? `, ${spoken(lock)}` : ''}`}
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

// The plays on the page, in order, and the sideline rows, from the action items,
// the leagues and the clock: the one list the cards, the count badge and the
// greeting's number all come from. The lead is the earliest lock still ahead;
// the plays with no lock (drafts, untimed offers) follow in the server's order.
// A live draft never outranks a timed play, but a play whose lock has already
// passed never outranks the draft card either, and a past-deadline seats_open
// is dropped when a draft card for its league is shown.
export function buildPlays(items, leagues, now, onDraftExpire) {
  const featured = featuredDraft(leagues, now);
  const drafts = [];
  if (featured) drafts.push(draftSpec(featured.league, onDraftExpire));
  const liveDrafts = items.filter((item) => item.type === 'draft_live' && item.severity !== 'info');
  liveDrafts.forEach((item) => {
    if (featured?.state === 'live' && String(featured.league.id) === String(item.leagueId)) return;
    drafts.push(draftSpec({ id: item.leagueId, name: item.leagueName, draft_status: 'active' }, onDraftExpire));
  });
  const draftLeagues = new Set(drafts.map((spec) => String(spec.leagueId)));
  const stale = (item) => item.type === 'seats_open' && timeMs(item.deadlineAt) !== null && timeMs(item.deadlineAt) <= now
    && draftLeagues.has(String(item.leagueId));
  const model = playModel(items.filter((item) => !liveDrafts.includes(item) && !stale(item)), { now });
  const specs = model.plays.map(playSpec);
  const timed = specs.filter((spec) => spec.at !== null);
  const untimed = specs.filter((spec) => spec.at === null);
  const passed = drafts.length > 0 ? timed.filter((spec) => spec.at <= now) : [];
  return {
    specs: [...timed.filter((spec) => !passed.includes(spec)), ...drafts, ...passed, ...untimed],
    sideline: model.sideline,
  };
}

const metaSx = {
  fontSize: '13px',
  color: 'var(--ps-dim)',
  marginLeft: { md: 'auto' },
  flexBasis: { xs: '100%', md: 'auto' },
};

const sidelineHeadSx = { margin: 0, ...pixelSx(16), color: 'var(--ps-dim)' };

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
        <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{[item.leagueName, tail].filter(Boolean).join(' · ')}</Box>
      </Box>
      {item.cta?.to && (
        <PsLink to={item.cta.to} ariaLabel={`${item.cta.label} in ${item.leagueName}`}>{item.cta.label}</PsLink>
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
              display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', backgroundColor: 'var(--ps-panel)', border: RULE,
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
  const [updatedAt, setUpdatedAt] = useState(null);
  const [expanded, setExpanded] = useState(false);
  // The first card Show all reveals: the button disappears on click, so focus
  // moves here instead of dropping to the top of the page.
  const firstRevealedRef = useRef(null);
  const {
    items, partial, loading, error, fetchedAt, reload,
  } = useActionItems();
  // Loading with items present is loaded (a refetch keeps the plays); an error with none is a failure.
  const pending = loading && items.length === 0 && !error;
  const failed = !pending && Boolean(error) && items.length === 0;
  const loaded = !pending && !failed;
  // Lock text ("in 1h 12m"), the urgent strip and the stamp repaint exactly
  // when one of them would read differently; a refetch re-reads the clock.
  const now = useNow((at) => nextChange(items, leagues, updatedAt, at), items);

  useEffect(() => {
    if (expanded) firstRevealedRef.current?.focus();
  }, [expanded]);

  // The read settled: stamp it and hand the page the body (null on a failure).
  useEffect(() => {
    if (pending) return;
    if (failed) {
      onLoadedRef.current?.(null);
      return;
    }
    setUpdatedAt(fetchedAt ?? Date.now());
    onLoadedRef.current?.({ items, partial });
  }, [pending, failed, items, partial, fetchedAt]);

  const { specs, sideline } = loaded ? buildPlays(items, leagues, now, onDraftExpire) : { specs: [], sideline: [] };
  // What the greeting reads off the list: which plays, which locks have passed, and today's date.
  const playsSignature = loaded
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
    reload();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reload is a fresh function each render; only refreshKey should refetch

  if (pending) return <ActionQueueSkeleton />;

  // Item types whose builder failed on the server: the rest still arrived, but
  // an empty list is then not proof that nothing needs the manager.
  if (failed || (partial.length > 0 && specs.length === 0)) {
    return (
      <ErrorPanel
        title="Couldn't check what needs you"
        body="Your leagues are below. Open each one, or try again."
        onRetry={() => reload()}
        retryAriaLabel="Try checking your plays again"
      />
    );
  }

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
          <Box component="p" sx={{ margin: 0, fontSize: '14px', color: 'var(--ps-dim)' }}>
            {nextLock && new Date(nextLock).toDateString() === new Date(now).toDateString() && 'Nothing else is due today.'}
            {nextLock && new Date(nextLock).toDateString() !== new Date(now).toDateString() && `Nothing else is due before ${weekday(nextLock, 'long')}'s kickoff.`}
            {!nextLock && 'Nothing else needs you today.'}
          </Box>
        </Box>
      </Box>
      {hiddenCount > 0 && (
        <Box sx={{ padding: '0 12px 12px' }}>
          <PsButton variant="quiet" onClick={() => setExpanded(true)}>{`Show all ${specs.length}`}</PsButton>
        </Box>
      )}
    </Frame>
  );
}

export default ActionQueue;
