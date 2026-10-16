import React from 'react';
import { Box } from '@mui/material';
import { PixelWarn, PsButton } from '../../../shared/ui/playselect';
import { formatInstant } from '../../../shared/lib';

const MINUTE_MS = 60 * 1000;

/**
 * The lineup note on Game Center (RULINGS Critique 7 item 5 and Critique 8 items 4 and 5; spec #2334 ruling
 * 4): its own panel row directly under the hero, a warning pictogram (never the lock, which means Locked), the
 * sentence and a ghost "Set lineup". No cursor and no filled action: a watching page.
 *
 * It reads the viewer's `lineup_problem` action item for this league (the dashboard's own lock-aware source,
 * `GET /api/user/action-items`), so the figures are the dashboard's for the same moment. A single empty slot
 * reads "{SLOT} is empty · fill it by Sun 3:25 PM", and under an hour from the lock "{SLOT} is empty · locks
 * in {n} min" in the Danger text (also in the accessible name). Any other problem keeps the server's own
 * title and detail, then "Locks Sun 3:25 PM". Renders nothing without such an item.
 *
 * shortcut: the live "no bench player can fill it · Free agents" variant and the advice copy that names each
 * move (+23.0 pts) need the lineup's bench and advice, which Game Center does not read; upgrade when the
 * Matchup lineup note lands in a shared piece.
 */
export function lineupNoteView(item, now) {
  if (!item) return null;
  const lockAt = item.deadlineAt ? new Date(item.deadlineAt).getTime() : null;
  const lock = lockAt != null && !Number.isNaN(lockAt) ? lockAt : null;
  const empty = /^Fill your empty (.+) slot$/.exec(item.title || '');
  const minutes = lock != null && lock > now ? Math.ceil((lock - now) / MINUTE_MS) : null;
  const urgent = minutes != null && minutes < 60;
  const lockText = lock != null
    ? `${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(lock)} ${formatInstant(lock, 'time')}`
    : null;
  if (empty) {
    const slot = empty[1];
    let tail = null;
    if (urgent) tail = `locks in ${minutes} min`;
    else if (lockText) tail = `fill it by ${lockText}`;
    return { lead: `${slot} is empty`, tail, urgent, plain: [`${slot} is empty`, tail].filter(Boolean).join(' · ') };
  }
  const lead = item.title || 'Fix your lineup';
  const tail = [item.detail, urgent ? `locks in ${minutes} min` : lockText ? `Locks ${lockText}` : null].filter(Boolean).join(' · ');
  return { lead, tail: tail || null, urgent, plain: [lead, tail].filter(Boolean).join(' · ') };
}

export default function LineupNote({ item, now, to }) {
  const note = lineupNoteView(item, now);
  if (!note) return null;
  return (
    <Box
      component="section"
      data-testid="game-center-lineup-note"
      aria-label={`Lineup note: ${note.plain}`}
      sx={{
        border: '2px solid var(--ps-frame-2)',
        backgroundColor: 'var(--ps-panel)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 16px',
        padding: { xs: '10px 14px', md: '10px 20px' },
        boxSizing: 'border-box',
        minHeight: '56px',
        fontSize: '14px',
        color: 'var(--ps-dim)',
      }}
    >
      <Box component="span" sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: { xs: '1 1 100%', md: '1 1 320px' }, minWidth: 0 }}>
        <Box component="span" sx={{ marginTop: '2px', display: 'inline-flex' }}>
          <PixelWarn color={note.urgent ? 'var(--ps-danger)' : 'var(--ps-ink)'} />
        </Box>
        <span>
          <Box component="b" sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>{note.lead}</Box>
          {note.tail && (
            <>
              {' · '}
              {note.urgent ? note.tail.slice(0, note.tail.lastIndexOf('locks in')) : note.tail}
              {note.urgent && <Box component="span" sx={{ fontWeight: 700, color: 'var(--ps-danger)', whiteSpace: 'nowrap' }}>{note.tail.slice(note.tail.lastIndexOf('locks in'))}</Box>}
            </>
          )}
        </span>
      </Box>
      <PsButton variant="ghost" to={to}>Set lineup</PsButton>
    </Box>
  );
}
