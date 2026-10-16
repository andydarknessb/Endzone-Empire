import React from 'react';
import { Box } from '@mui/material';
import { PixelWarn, PsButton } from '../../../shared/ui/playselect';
import NoteRow from './NoteRow';

/**
 * The lineup note (RULINGS Critique 7-11, spec #2334): the quiet row that names an empty or Out
 * starting slot in place of the Bench what-if sentence while the viewer can still fix it. `view` is
 * `lineupNote`'s result (`entities/roster`); this lays it out. A warning pictogram (never the lock, which means
 * Locked), the sentence with its Danger run when under an hour from the lock, the lock on a second
 * line before kickoff, and one ghost link: "Set lineup", or "Free agents" when no bench player can
 * fill the slot. No cursor, no filled action.
 */
export default function LineupNote({ view, leagueId, ...rest }) {
  if (!view) return null;
  const free = view.link === 'free-agents';
  const to = free ? `/league/${leagueId}/waivers` : `/league/${leagueId}/lineup`;
  return (
    <NoteRow
      data-testid="lineup-note"
      data-kind={view.kind}
      ariaLabel={`Lineup note: ${view.plain}`}
      icon={<PixelWarn color={view.danger ? 'var(--ps-danger)' : 'var(--ps-ink)'} />}
      action={<PsButton variant="ghost" to={to}>{free ? 'Free agents' : 'Set lineup'}</PsButton>}
      {...rest}
    >
      {view.segments.map((seg) => (
        <Box
          key={seg.text}
          component={seg.strong ? 'b' : 'span'}
          sx={{
            ...(seg.strong ? { fontWeight: 600, color: 'var(--ps-ink)' } : null),
            ...(seg.danger ? { fontWeight: 700, color: 'var(--ps-danger)', whiteSpace: 'nowrap' } : null),
          }}
        >
          {seg.text}
        </Box>
      ))}
      {view.sub && (
        <>
          <br />
          <Box component="span" data-testid="lineup-note-lock" sx={{ whiteSpace: 'nowrap' }}>{view.sub}</Box>
        </>
      )}
    </NoteRow>
  );
}
