import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  CountBadge, Frame, FrameHead, PixelCheck, PixelHeading, PlayCard, SR_ONLY_SX, Skel, pixelSx,
} from '../../../shared/ui/playselect';
import { useInviteCopy } from '../../../features/copy-invite';
import { itemType, playName } from '../../../entities/action-item';
import { formatInstant, timeUntil, useNow } from '../../../shared/lib';
import { YourMoveHeadSkel } from './PageStates';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Item type -> play kind (the pictogram). The Action item entity reads an item's type off its id
// ("picks_open:4:2026-6"); the wire has no kind field.
const KIND = {
  picks_open: 'picks',
  lineup_problem: 'lineup',
  draft_live: 'draft',
  seats_open: 'draft',
  trade_review: 'trade',
  trade_offer: 'trade',
  join_requests: 'join',
  waiver_claims: 'waivers',
};
const FALLBACK_KIND = 'lineup';

const timeMs = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
};

// The lock line: "THU 7:15 PM", the date past a week out, "Now" once passed, "No deadline" without one.
function lockParts(at, now) {
  if (at === null) return { lockDay: 'No deadline', lockTime: '' };
  if (at <= now) return { lockDay: 'Now', lockTime: '' };
  return {
    lockDay: at - now >= 6 * DAY_MS
      ? formatInstant(at, 'day')
      : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at),
    lockTime: formatInstant(at, 'time'),
  };
}
const spoken = ({ lockDay, lockTime }) => [lockDay, lockTime].filter(Boolean).join(' ');

// The earliest instant a lock line reads differently: its relative text ticking over, a card
// crossing into its last hour (the urgent strip), or passing its lock.
function nextChange(cards, now) {
  let next = null;
  const consider = (instant) => {
    if (instant > now && (next === null || instant < next)) next = instant;
  };
  cards.forEach((card) => {
    const at = timeMs(card.feet?.[0]?.deadlineAt);
    if (at === null || at <= now) return;
    consider(at);
    consider(at - HOUR_MS + 1);
    consider(timeUntil(at, now)?.changesAt ?? null);
  });
  return next;
}

// An open-seats foot (the pre-draft Play) copies the league's invite when the viewer holds the code: the
// page it sits on is that league, so a link there goes nowhere.
function MoveCard({
  card, lead, urgent, wide, compact, now, inviteCode,
}) {
  const feet = card.feet || [];
  const first = feet[0] || {};
  const invite = useInviteCopy(inviteCode);
  const at = timeMs(first.deadlineAt);
  const lock = lockParts(at, now);
  const isUrgent = lead && urgent && at !== null && at > now;
  const multi = feet.length > 1;
  const name = card.name ?? playName(feet);
  const minutes = at !== null ? Math.max(1, Math.floor((at - now) / MINUTE_MS)) : null;
  const details = feet.map((foot) => foot.detail).filter(Boolean);
  // An open-seats lock reads "Draft" while it is still ahead; once passed it is just "Now".
  const drafting = itemType(first) === 'seats_open' && at !== null && at > now;
  const lockSpoken = at !== null ? `, ${drafting ? 'draft' : 'locks'} ${spoken(lock)}` : '';
  const isInvite = (foot) => Boolean(inviteCode) && itemType(foot) === 'seats_open';
  const hasInvite = feet.some(isInvite);
  const footActions = feet.map((foot) => {
    const base = { key: foot.id, label: foot.cta?.label || foot.title, bare: true };
    return isInvite(foot)
      ? { ...base, onClick: invite.copy, done: invite.copied, doneLabel: 'Copied' }
      : { ...base, to: foot.cta?.to, ariaLabel: `${base.label}${foot.detail ? `, ${foot.detail}` : ''}${lockSpoken}` };
  });

  return (
    <>
      <PlayCard
        kind={KIND[itemType(first)] || FALLBACK_KIND}
        name={name}
        league=""
        detail={multi ? details.join(' · ') : null}
        {...lock}
        lockWord={drafting ? 'Draft' : undefined}
        countdown={isUrgent ? `${minutes} min` : undefined}
        lockNote={card.note || (multi ? null : first.detail) || undefined}
        cta={multi || hasInvite ? undefined : { label: first.cta?.label || name, to: first.cta?.to }}
        actions={multi || hasInvite ? footActions : undefined}
        ariaLabel={`${first.cta?.label || name}${lockSpoken}`}
        state={lead ? (isUrgent ? 'urgent' : 'next') : 'open'}
        lead={lead}
        headingLevel={3}
        wide={wide}
        compact={compact}
      />
      {hasInvite && <Box role="status" aria-live="polite" sx={SR_ONLY_SX}>{invite.announcement}</Box>}
    </>
  );
}

/**
 * The page's "Your move" section (ADR 0067 wave 1b, ticket #2330): this league's open plays as a
 * primary frame. The lead is the earliest lock, wide on desktop (the field band left of the text), with
 * a foot per action when several items share its lock (the Shared Lock Rule), and it alone wears the
 * cursor and the one filled foot. Every other card is compact (name, lock, foot; no field band), stacked
 * beside it on desktop and under it on a phone. The badge counts the cards.
 *
 * Props, all plain data (the page builds them from the league's action items):
 *   lead   { feet: [{ id, title, detail, cta: { label, to }, deadlineAt }], note? } the lead card; `note`
 *          is the lock note that names the swap ("Start Jordan Addison for Puka Nacua · +23.0 pts")
 *   rest   [same card shape] the non-lead cards, in order
 *   badge  the card count
 *   empty  true, or { note }: nothing is due, so a calm "You're set" card with no cursor and no filled
 *          action (a tertiary frame; its note defaults to "Nothing needs you right now.")
 *   noTeam with `empty`, the viewer has no Team: the heading reads "No team in this league", with no check
 *          and the note "Nothing here needs you."
 *   pending the Action items read is in flight with nothing cached: the frame's outline and one skeleton
 *          card, a status named "Checking what needs you", with no heading text and no check
 *   urgent the lead locks within an hour: its strip and cursor turn Danger
 *   inviteCode the league's invite code, when the viewer holds it: an open-seats Play's foot then copies it
 */
export default function YourMove({
  lead, rest = [], badge, empty = false, urgent = false, inviteCode, noTeam = false, pending = false,
}) {
  const headingId = useId();
  const cards = lead ? [lead, ...rest] : rest;
  const now = useNow((at) => nextChange(cards, at), cards.length);

  if (pending) {
    return (
      <Frame
        component="div"
        role="status"
        aria-label="Checking what needs you"
        data-testid="your-move-pending"
        tabIndex={-1}
        head={<YourMoveHeadSkel />}
      >
        <Box sx={{ padding: { xs: '8px', md: '12px' } }}>
          <Skel width="100%" height={96} />
        </Box>
      </Frame>
    );
  }

  if (empty || !lead) {
    const note = noTeam ? 'Nothing here needs you.' : ((empty && empty.note) || 'Nothing needs you right now.');
    const heading = noTeam ? 'No team in this league' : "You're set";
    return (
      <Frame
        tier="rule"
        labelledBy={headingId}
        data-testid="your-move"
        tabIndex={-1}
        head={(
          <FrameHead>
            <PixelHeading id={headingId} size={16}>Your move</PixelHeading>
            <Box component="span" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>Nothing is due</Box>
          </FrameHead>
        )}
      >
        <Box data-testid="your-move-empty" sx={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box component="h3" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: '12px', ...pixelSx(16) }}>
            {!noTeam && <PixelCheck size={16} />}
            {heading}
          </Box>
          <Box component="p" sx={{ m: 0, fontSize: '15px', color: 'var(--ps-dim)' }}>{note}</Box>
        </Box>
      </Frame>
    );
  }

  return (
    <Frame
      labelledBy={headingId}
      data-testid="your-move"
      tabIndex={-1}
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Your move</PixelHeading>
          <CountBadge n={badge ?? cards.length} />
          {cards.length > 1 && (
            <Box component="span" sx={{ marginLeft: { md: 'auto' }, flexBasis: { xs: '100%', md: 'auto' }, fontSize: '13px', color: 'var(--ps-dim)' }}>
              Earliest lock first
            </Box>
          )}
        </FrameHead>
      )}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: rest.length > 0 ? 'minmax(0, 2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' },
          gap: '8px',
          padding: { xs: '8px', md: '12px' },
          alignItems: 'start',
        }}
      >
        <MoveCard card={lead} lead urgent={urgent} wide now={now} inviteCode={inviteCode} />
        {rest.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            {rest.map((card, index) => (
              <MoveCard key={card.feet?.[0]?.id ?? index} card={card} compact now={now} inviteCode={inviteCode} />
            ))}
          </Box>
        )}
      </Box>
    </Frame>
  );
}
