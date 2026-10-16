import React from 'react';
import { Box } from '@mui/material';
import { formatInstant, timeUntil, useNow } from '../../../shared/lib';
import { Frame, SR_ONLY_SX, pixelSx } from '../../../shared/ui/playselect';

// The countdown spells its units: Pixel 24 makes "2d 16h" and "40m" ambiguous. The house style text
// ("2d 16h", "14h 05m", "59m", "Under 1m") is turned into "2 days 16 h", "14 h 5 min", "59 min",
// "Under 1 min", set in caps by the pixel face; a screen reader hears the words, not the units.
function spellTime(text) {
  const dh = /^(\d+)d (\d+)h$/.exec(text);
  if (dh) {
    const days = Number(dh[1]);
    const hours = Number(dh[2]);
    return { value: `${days} ${days === 1 ? 'day' : 'days'} ${hours} h`, spoken: `${days} ${days === 1 ? 'day' : 'days'} ${hours} ${hours === 1 ? 'hour' : 'hours'}` };
  }
  const hm = /^(\d+)h (\d+)m$/.exec(text);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = Number(hm[2]);
    return { value: `${hours} h ${minutes} min`, spoken: `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` };
  }
  const m = /^(\d+)m$/.exec(text);
  if (m) return { value: `${m[1]} min`, spoken: `${m[1]} ${Number(m[1]) === 1 ? 'minute' : 'minutes'}` };
  if (text === 'Under 1m') return { value: 'Under 1 min', spoken: 'Under 1 minute' };
  return { value: text, spoken: null };
}

function FullChip() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box', height: '28px', padding: '0 8px', border: '2px solid var(--ps-ink)',
        fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', lineHeight: 1, flex: 'none',
      }}
    >
      Full
    </Box>
  );
}

function Tile({
  label, value, spoken, note, chip, testId, index, count,
}) {
  return (
    <Box
      role="group"
      aria-label={label}
      data-testid={testId}
      sx={{
        minWidth: 0,
        boxSizing: 'border-box',
        padding: { xs: '12px 14px', md: '16px 20px' },
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        borderLeft: { xs: index % 2 ? '2px solid var(--ps-rule)' : 'none', md: index ? '2px solid var(--ps-rule)' : 'none' },
        borderTop: { xs: index >= 2 ? '2px solid var(--ps-rule)' : 'none', md: 'none' },
        gridColumn: { xs: index === count - 1 && count % 2 ? 'span 2' : undefined, md: 'auto' },
      }}
    >
      <Box component="span" sx={{
        fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)',
      }}
      >
        {label}
      </Box>
      <Box component="span" sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px',
      }}
      >
        <Box component="span" sx={{ ...pixelSx(String(value).length > 11 ? 16 : 24), lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
          {spoken ? <span aria-hidden="true">{value}</span> : value}
          {spoken && <Box component="span" sx={SR_ONLY_SX}>{spoken}</Box>}
        </Box>
        {chip}
      </Box>
      {note ? (
        <Box component="span" sx={{ fontSize: { xs: '13px', md: '14px' }, color: 'var(--ps-dim)', textWrap: 'pretty' }}>{note}</Box>
      ) : null}
    </Box>
  );
}

/**
 * The Waivers summary strip (ADR 0049), one tertiary frame of figures in the Play-select look (ADR
 * 0067 wave 3): the next Clear time as a countdown, FAAB left after pending bids (FAAB league),
 * Waiver priority, and the roster count with a "Full" word chip at Roster capacity.
 *
 * Reads only what the page hands it, built from the `waiver-claim` entity and
 * the cards read's context (no import above `shared`, ADR 0020):
 *   nextClear   `{ at, kind: 'player'|'blanket', playerName }` or null
 *   pendingCount, faab `{ committed, left }` or null, waiverPriority
 *   roster      `{ count, capacity, atCapacity }` or null (tile hidden)
 *
 * Claims resolve player by player (ADR 0049), so no copy names one time claims
 * "process at": the tile says when the NEXT one clears, or that waivers clear
 * while the league's blanket clear time runs.
 */
export default function WaiverSummary({
  nextClear, pendingCount = 0, faab, waiverPriority, roster, now: pinnedNow,
}) {
  // The countdown walks down while the page is open, repainting exactly when
  // its text changes; a `now` prop pins the clock for a test.
  const liveNow = useNow((at) => (pinnedNow || !nextClear ? null : timeUntil(nextClear.at, at)?.changesAt ?? null), nextClear?.at);
  const until = nextClear ? timeUntil(nextClear.at, pinnedNow || liveNow) : null;
  let countdown = { value: 'None', spoken: null };
  if (until) countdown = until.passed ? { value: 'Clearing now', spoken: null } : spellTime(until.text);

  const nextNote = !nextClear
    ? 'No pending claims'
    : nextClear.kind === 'blanket'
      ? `Waivers clear ${formatInstant(nextClear.at, 'weekdayTime')}`
      : `${nextClear.playerName || 'Your next claim'} clears ${formatInstant(nextClear.at, 'weekdayTime')}`;

  const tiles = [
    {
      testId: 'waiver-summary-next-clear', label: 'Next claim resolves', ...countdown, note: nextNote,
    },
    faab && {
      testId: 'waiver-summary-faab',
      label: 'FAAB left',
      value: `$${faab.left}`,
      note: `$${faab.committed} bid on ${pendingCount} pending claim${pendingCount === 1 ? '' : 's'}`,
    },
    {
      testId: 'waiver-summary-priority',
      label: 'Waiver priority',
      value: waiverPriority != null ? `#${waiverPriority}` : 'TBD',
      note: faab ? 'Breaks equal bids. A win sends you to the back.' : 'Your place in line.',
    },
    roster && {
      testId: 'waiver-summary-roster',
      label: 'Roster',
      value: `${roster.count}/${roster.capacity ?? '-'}`,
      chip: roster.atCapacity ? <FullChip /> : null,
      note: roster.atCapacity ? 'Every claim needs a drop.' : null,
    },
  ].filter(Boolean);

  return (
    <Frame tier="rule" labelledBy="waiver-summary-heading" data-testid="waiver-summary">
      <Box component="h2" id="waiver-summary-heading" sx={{ m: 0, ...SR_ONLY_SX }}>Waiver summary</Box>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${tiles.length}, minmax(0, 1fr))` },
      }}
      >
        {tiles.map((tile, index) => (
          <Tile key={tile.testId} {...tile} index={index} count={tiles.length} />
        ))}
      </Box>
    </Frame>
  );
}
