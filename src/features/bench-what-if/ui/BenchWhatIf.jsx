import React, { useId } from 'react';
import { Box } from '@mui/material';
import { PsButton } from '../../../shared/ui/playselect';
import NoteRow, { PixelLock } from './NoteRow';

/**
 * bench-what-if feature (ADR 0031, #900): the Bench what-if on Matchup Detail, drawn as the boards'
 * note row (ADR 0067 wave 2, spec #2334 ruling 4): a lock icon, "Bench what-if." in bold, then the
 * product's sentence for its branch, in a tertiary frame of its own between the NFL strip and
 * Starters. When a swap is on the table, a second line shows it (the benched player struck through,
 * the bench player, the gain as an outlined chip) with "Swap in lineup" as a ghost button, never a
 * filled one. It is a quiet row, not a cursor: Matchup is a watching page.
 *
 * The action is a react-router link to the Lineup page with the swap named in the query
 * (`/league/:leagueId/lineup?swapOut=<id>&swapIn=<id>`). Nothing is swapped here and no request is
 * made: Lineup is the sole team management surface (ADR 0019).
 *
 * Props:
 *   - `whatIf`: `{ delta, swaps: [{ out: { playerId, name, points }, in: { playerId, name, points },
 *     gain }] }`, or null. Only the first swap is shown.
 *   - `hasRoster`: whether the viewer has a roster in this league.
 *   - `leagueId`: the league the Lineup link points into.
 *
 * Renders nothing when there is no what-if or no roster. A delta of zero or less prints "Your best
 * legal lineup is already active." alone: no swap row and no action.
 */

/** The Lineup page href with the swap named in the query (ADR 0019). */
export function swapLineupHref(leagueId, swap) {
  const query = new URLSearchParams({
    swapOut: String(swap.out.playerId),
    swapIn: String(swap.in.playerId),
  });
  return `/league/${leagueId}/lineup?${query.toString()}`;
}

// A points figure to one decimal, or null when there is no figure (null,
// undefined, an empty string) or the value is not a number, so a row never
// prints "NaN" and an absent figure never reads as "0.0".
function points(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : null;
}

// "D. Adams 0.0": the player's name, then the points when there are any.
function playerLabel(player) {
  const pts = points(player.points);
  return pts == null ? String(player.name ?? '') : `${player.name} ${pts}`;
}

// The first swap that names both players; null when there is none.
function firstSwap(swaps) {
  const list = Array.isArray(swaps) ? swaps : [];
  const swap = list.find(
    (s) => s && s.out && s.in && s.out.playerId != null && s.in.playerId != null
  );
  return swap || null;
}

export default function BenchWhatIf({ whatIf, hasRoster, leagueId, ...rest }) {
  const headingId = useId();
  if (!whatIf || !hasRoster) return null;

  const delta = Number(whatIf.delta) || 0;
  const optimal = delta <= 0;
  const swap = optimal ? null : firstSwap(whatIf.swaps);
  const gain = swap ? points(swap.gain) : null;

  return (
    <NoteRow
      data-testid="bench-what-if"
      labelledBy={headingId}
      icon={<PixelLock />}
      {...rest}
    >
      <Box component="b" id={headingId} sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>Bench what-if.</Box>
      {' '}
      {optimal ? (
        <span data-testid="bench-what-if-headline">Your best legal lineup is already active.</span>
      ) : (
        <>
          <span data-testid="bench-what-if-headline">{`+${delta.toFixed(1)} still on your bench.`}</span>
          {' '}
          <span>Locked players cannot be swapped.</span>
        </>
      )}
      {swap && (
        <Box
          data-testid="bench-what-if-swap"
          sx={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', mt: '8px',
          }}
        >
          {/* The benched starter, struck through: `<s>` carries the "no longer relevant" meaning. */}
          <Box component="s" data-testid="bench-what-if-out" style={{ textDecoration: 'line-through' }} sx={{ fontSize: '15px' }}>
            {playerLabel(swap.out)}
          </Box>
          <Box component="span" aria-hidden="true">in for</Box>
          <Box component="span" data-testid="bench-what-if-in" sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--ps-ink)' }}>
            {playerLabel(swap.in)}
          </Box>
          {gain != null && (
            <Box
              component="span"
              data-testid="bench-what-if-gain"
              sx={{
                display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 6px', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              {`+${gain}`}
            </Box>
          )}
          <PsButton variant="ghost" to={swapLineupHref(leagueId, swap)}>Swap in lineup</PsButton>
        </Box>
      )}
    </NoteRow>
  );
}
