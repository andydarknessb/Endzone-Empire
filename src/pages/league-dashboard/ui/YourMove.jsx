import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  CountBadge, Frame, FrameHead, PixelCheck, PixelHeading, PlayCard, pixelSx,
} from '../../../shared/ui/playselect';
import { itemType, playName } from '../../../entities/action-item';
import { formatInstant, timeUntil, useNow } from '../../../shared/lib';

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

function MoveCard({
  card, lead, urgent, wide, compact, now,
}) {
  const feet = card.feet || [];
  const first = feet[0] || {};
  const at = timeMs(first.deadlineAt);
  const lock = lockParts(at, now);
  const isUrgent = lead && urgent && at !== null && at > now;
  const multi = feet.length > 1;
  const name = card.name ?? playName(feet);
  const minutes = at !== null ? Math.max(1, Math.floor((at - now) / MINUTE_MS)) : null;
  const details = feet.map((foot) => foot.detail).filter(Boolean);

  return (
    <PlayCard
      kind={KIND[itemType(first)] || FALLBACK_KIND}
      name={name}
      league=""
      detail={multi ? details.join(' · ') : null}
      {...lock}
      countdown={isUrgent ? `${minutes} min` : undefined}
      lockNote={card.note || (multi ? null : first.detail) || undefined}
      cta={multi ? undefined : { label: first.cta?.label || name, to: first.cta?.to }}
      actions={multi
        ? feet.map((foot) => ({
          key: foot.id,
          label: foot.cta?.label || foot.title,
          to: foot.cta?.to,
          bare: true,
          ariaLabel: `${foot.cta?.label || foot.title}${foot.detail ? `, ${foot.detail}` : ''}${at !== null ? `, locks ${spoken(lock)}` : ''}`,
        }))
        : undefined}
      ariaLabel={`${first.cta?.label || name}${at !== null ? `, locks ${spoken(lock)}` : ''}`}
      state={lead ? (isUrgent ? 'urgent' : 'next') : 'open'}
      lead={lead}
      headingLevel={3}
      wide={wide}
      compact={compact}
    />
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
 *   urgent the lead locks within an hour: its strip and cursor turn Danger
 */
export default function YourMove({
  lead, rest = [], badge, empty = false, urgent = false,
}) {
  const headingId = useId();
  const cards = lead ? [lead, ...rest] : rest;
  const now = useNow((at) => nextChange(cards, at), cards.length);

  if (empty || !lead) {
    const note = (empty && empty.note) || 'Nothing needs you right now.';
    return (
      <Frame
        tier="rule"
        labelledBy={headingId}
        data-testid="your-move"
        head={(
          <FrameHead>
            <PixelHeading id={headingId} size={16}>Your move</PixelHeading>
            <Box component="span" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>Nothing is due</Box>
          </FrameHead>
        )}
      >
        <Box data-testid="your-move-empty" sx={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box component="h3" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: '12px', ...pixelSx(16) }}>
            <PixelCheck size={16} />
            You&apos;re set
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
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Your move</PixelHeading>
          <CountBadge n={badge ?? cards.length} />
          <Box component="span" sx={{ marginLeft: { md: 'auto' }, flexBasis: { xs: '100%', md: 'auto' }, fontSize: '13px', color: 'var(--ps-dim)' }}>
            Earliest lock first
          </Box>
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
        <MoveCard card={lead} lead urgent={urgent} wide now={now} />
        {rest.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            {rest.map((card, index) => (
              <MoveCard key={card.feet?.[0]?.id ?? index} card={card} compact now={now} />
            ))}
          </Box>
        )}
      </Box>
    </Frame>
  );
}
