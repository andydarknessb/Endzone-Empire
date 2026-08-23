import React, { useEffect, useId, useMemo } from 'react';
import {
  Box, Chip, List, ListItem, Paper, Typography,
} from '@mui/material';
import PositionChip from '../PlayerQuickView/PositionChip';
import { assignRosterSlots } from '../../lib/rosterAssignment';

/**
 * A team's roster as a slot template: every starting slot, every bench spot,
 * every IR spot, with the drafted player or an obvious placeholder.
 *
 * League-agnostic on purpose. The mock draft passes its template plus a fixed
 * six-man bench; the real draft room passes the league's own roster_slots,
 * bench_slots and ir_slots. Nothing about a league is hardcoded here.
 *
 * Deliberately provider-free (MUI + PositionChip only, no apiClient, redux or
 * router) because the Draft Simulator renders with no providers at all and a
 * guard test asserts it.
 */

const SECTIONS = [
  ['starter', 'Starters'],
  ['bench', 'Bench'],
  ['ir', 'Injured reserve'],
  ['overflow', 'No slot'],
];

/** The row's accessible name: "WR 2 slot, empty" / "FLEX slot, Nico Collins, WR, Houston". */
function accessibleName(row, emptyLabel) {
  const parts = [`${row.slotLabel} slot`];
  if (row.player) {
    parts.push(row.player.name || 'Unknown player');
    if (row.player.position) parts.push(row.player.position);
    if (row.player.nflTeam) parts.push(row.player.nflTeam);
    if (row.player.pickLabel) parts.push(`pick ${row.player.pickLabel}`);
    if (row.player.auto) parts.push('auto-drafted');
    if (row.player.keeper) parts.push('keeper');
  } else {
    parts.push(emptyLabel === 'Open' ? 'empty' : emptyLabel.toLowerCase());
  }
  if (row.section === 'ir') parts.push('injured reserve');
  if (row.section === 'overflow') parts.push('past your roster');
  return parts.join(', ');
}

/**
 * Rounds against the spots a draft can actually fill. Silent truncation would
 * be the worst outcome here, so a mismatch is stated rather than hidden or
 * thrown. Measured against summary.draftable, NOT total roster capacity: a
 * league with an undraftable IR slot deliberately runs one round short of its
 * roster limit, and that is not a shortfall to warn about (#96).
 */
function draftRoundMismatchNote(rounds, summary, irDraftable) {
  const { draftable, starterInstances, benchInstances, irInstances } = summary;
  if (rounds == null || !Number.isFinite(Number(rounds))) return null;
  if (draftable === 0 || Number(rounds) === draftable) return null;
  const n = Number(rounds);
  // With no IR slots at all there is nothing the draft skips, so the league
  // reads exactly what it read before (#96).
  const irCounts = irDraftable || irInstances === 0;
  const shape = irCounts
    ? `${starterInstances} starters, ${benchInstances} bench, ${irInstances} IR`
    : `${starterInstances} starters, ${benchInstances} bench`;
  if (n > draftable) {
    const extra = n - draftable;
    const lead = irCounts
      ? `This draft runs ${n} rounds but your roster holds ${draftable} players `
      : `This draft runs ${n} rounds but only ${draftable} of your spots are drafted `;
    return lead
      + `(${shape}). `
      + `The last ${extra === 1 ? 'pick has' : `${extra} picks have`} nowhere to go.`;
  }
  return `This draft runs ${n} rounds, ${draftable - n} short of your ${draftable} roster `
    + "spots. You'll finish with open spots to fill from waivers.";
}

function SlotRow({ row, emptyLabel, dense }) {
  const { player } = row;
  return (
    <ListItem
      disableGutters
      aria-label={accessibleName(row, emptyLabel)}
      sx={{
        // Equal heights whether filled or open: a landing pick must never
        // reflow the rows below it.
        minHeight: dense ? 34 : 38,
        px: 1,
        py: 0.25,
        mb: 0.5,
        gap: 1,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderStyle: player ? 'solid' : 'dashed',
        borderColor: player ? 'transparent' : 'var(--border-subtle)',
        bgcolor: player ? 'var(--surface-sunken)' : 'transparent',
        opacity: row.draftable ? 1 : 0.65,
        transition: 'background-color var(--transition-base)',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box sx={{ minWidth: dense ? 46 : 56, flexShrink: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
          {row.slotLabel}
        </Typography>
        {row.multi && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2, fontSize: '0.65rem' }}
          >
            {row.eligiblePositions.join('/')}
          </Typography>
        )}
      </Box>

      {player ? (
        <>
          <PositionChip position={player.position} size="small" />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {player.name || 'Unknown player'}
            </Typography>
            {player.nflTeam && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {player.nflTeam}
              </Typography>
            )}
          </Box>
          {player.pickLabel && (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
            >
              {player.pickLabel}
            </Typography>
          )}
          {player.keeper && <Chip size="small" label="Keeper" variant="outlined" />}
          {player.auto && <Chip size="small" label="Auto" variant="outlined" />}
        </>
      ) : (
        // Dashed border AND the word itself: colour is never the only signal.
        <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          {emptyLabel}
        </Typography>
      )}
    </ListItem>
  );
}

function RosterPanel({
  rosterSlots = [],
  benchCount = 0,
  irCount = 0,
  irDraftable = true,
  picks = [],
  rounds = null,
  title = 'My roster',
  dense = false,
  emptyLabel = 'Open',
}) {
  const headingId = useId();
  const assignment = useMemo(
    () => assignRosterSlots({ picks, rosterSlots, benchCount, irCount, irDraftable }),
    [picks, rosterSlots, benchCount, irCount, irDraftable]
  );

  const note = draftRoundMismatchNote(rounds, assignment.summary, irDraftable);
  const { draftable } = assignment.summary;
  useEffect(() => {
    if (note && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn(`[RosterPanel] ${rounds} rounds against ${draftable} draftable spots.`);
    }
  }, [note, rounds, draftable]);

  if (!Array.isArray(rosterSlots) || rosterSlots.length === 0) return null;

  return (
    <Paper component="section" variant="outlined" sx={{ p: 2 }} aria-labelledby={headingId}>
      <Typography id={headingId} variant="h6" component="h2" sx={{ mb: note ? 0.5 : 1 }}>{title}</Typography>
      {note && (
        <Typography variant="caption" sx={{ color: 'warning.main', display: 'block', mb: 1 }}>
          {note}
        </Typography>
      )}

      {SECTIONS.map(([section, label]) => {
        const rows = assignment.rows.filter((row) => row.section === section);
        if (rows.length === 0) return null;
        return (
          <Box key={section} sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary', textTransform: 'uppercase',
                letterSpacing: '0.06em', fontWeight: 700, display: 'block', mb: 0.5,
              }}
            >
              {label}
            </Typography>
            <List dense disablePadding aria-label={label}>
              {rows.map((row) => (
                <SlotRow key={row.id} row={row} emptyLabel={emptyLabel} dense={dense} />
              ))}
            </List>
            {section === 'ir' && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {irDraftable
                  ? 'IR spots fill from the end of the draft. Designate before week 1.'
                  : 'IR spots are not draftable in this draft.'}
              </Typography>
            )}
            {section === 'overflow' && (
              <Typography variant="caption" sx={{ color: 'warning.main' }}>
                Past your roster spots. These need a roster move before week 1.
              </Typography>
            )}
          </Box>
        );
      })}
    </Paper>
  );
}

export default RosterPanel;
