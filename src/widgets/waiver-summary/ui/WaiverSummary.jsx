import React from 'react';
import { Box, Typography } from '@mui/material';
import { timeUntil, useNow } from '../../../shared/lib/timeUntil';
import { formatInstant } from '../../../shared/lib/instantFormat';

function Tile({ label, value, unit, note, flag, warn, testId }) {
  return (
    <Box
      component="div"
      role="group"
      aria-label={label}
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: 0,
        px: 2,
        py: 1.75,
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid',
        borderColor: warn ? 'var(--dash-warning)' : 'var(--dash-line)',
        borderRadius: 'var(--dash-radius)',
        color: 'var(--dash-ink)',
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography
          component="span"
          sx={{
            fontFamily: 'var(--dash-font-display)',
            fontSize: 30,
            fontWeight: 700,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--dash-ink)',
          }}
        >
          {value}
        </Typography>
        {unit && (
          <Typography component="span" sx={{ fontSize: 13, color: 'var(--dash-dim)' }}>
            {unit}
          </Typography>
        )}
        {flag && (
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-ink)' }}>
            {flag}
          </Typography>
        )}
      </Box>
      {note && (
        <Typography component="span" sx={{ fontSize: 12, color: 'var(--dash-faint)' }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The Waivers summary strip (ADR 0049): the next Clear time as a countdown,
 * FAAB left after pending bids (FAAB league), Waiver priority, and the roster
 * count with a drop-required flag at Roster capacity.
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
export default function WaiverSummary({ nextClear, pendingCount = 0, faab, waiverPriority, roster, now: pinnedNow }) {
  // The countdown walks down while the page is open, repainting exactly when
  // its text changes; a `now` prop pins the clock for a test.
  const liveNow = useNow((at) => (pinnedNow || !nextClear ? null : timeUntil(nextClear.at, at)?.changesAt ?? null), nextClear?.at);
  const until = nextClear ? timeUntil(nextClear.at, pinnedNow || liveNow) : null;
  let countdown = null;
  if (until) countdown = until.passed ? 'Clearing now' : until.text;

  const nextNote = !nextClear
    ? 'No pending claims'
    : nextClear.kind === 'blanket'
      ? `Waivers clear ${formatInstant(nextClear.at, 'kickoff')}`
      : `${nextClear.playerName || 'Your next claim'} clears ${formatInstant(nextClear.at, 'kickoff')}`;

  return (
    <Box
      component="section"
      aria-label="Waiver summary"
      data-testid="waiver-summary"
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
      }}
    >
      <Tile
        testId="waiver-summary-next-clear"
        label="Next claim resolves"
        value={countdown || 'None'}
        note={nextNote}
      />
      {faab && (
        <Tile
          testId="waiver-summary-faab"
          label="FAAB left"
          value={`$${faab.left}`}
          note={`$${faab.committed} bid on ${pendingCount} pending claim${pendingCount === 1 ? '' : 's'}`}
        />
      )}
      <Tile
        testId="waiver-summary-priority"
        label="Waiver priority"
        value={waiverPriority != null ? `#${waiverPriority}` : 'TBD'}
        note={faab ? 'Breaks equal bids. A win sends you to the back.' : 'Your place in line.'}
      />
      {roster && (
        <Tile
          testId="waiver-summary-roster"
          label="Roster"
          value={`${roster.count}/${roster.capacity ?? '-'}`}
          flag={roster.atCapacity ? 'Full' : null}
          warn={roster.atCapacity}
          note={roster.atCapacity ? 'Every claim needs a drop.' : null}
        />
      )}
    </Box>
  );
}
