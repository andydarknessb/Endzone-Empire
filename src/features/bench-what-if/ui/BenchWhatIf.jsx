import React, { useId } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Card } from '../../../shared/ui';

/**
 * bench-what-if feature (ADR 0031, #900): the Bench what-if card on Matchup
 * Detail, transcribed from the design canvas (`benchWhatIf` in
 * docs/design/game-center-matchups/build.mjs). A warning-bordered card with
 * the bolt icon, the headline delta, the first swap row (the benched player
 * struck through, a swap icon, the bench player, a warning chip with the gain)
 * and one action, "Swap in lineup".
 *
 * The action is a react-router Link to the Lineup page with the swap named in
 * the query (`/league/:leagueId/lineup?swapOut=<id>&swapIn=<id>`). Nothing is
 * swapped here and no request is made: Lineup is the sole team management
 * surface (ADR 0019), so this card only points at it. The link is a plain
 * anchor in the accessibility tree, never a button.
 *
 * Props:
 *   - `whatIf`: `{ delta, swaps: [{ out: { playerId, name, points },
 *     in: { playerId, name, points }, gain }] }`, or null. Only the first swap
 *     is shown, the way the canvas shows it.
 *   - `hasRoster`: whether the viewer has a roster in this league.
 *   - `leagueId`: the league the Lineup link points into.
 *   - `headingLevel`: the level of the "Bench what-if" heading (default 2,
 *     the same default the kit's Card uses; the page sets it to sit one level
 *     below its own title, ADR 0021).
 *
 * Renders nothing when there is no what-if or no roster. A delta of zero or
 * less renders the "best legal lineup" line alone: no swap row and no action.
 *
 * Colors: `dash-*` tokens only. `dash-warning` paints the border, the bolt and
 * the gain chip's text and border; `dash-warning-soft` is the chip's tint (the
 * canvas's `--warning`/`--warning-soft`, per mode). The pairings this composes
 * (warning on `dash-surface`, warning on `dash-surface2`, warning text on the
 * tint over `dash-surface2`) are registered in tokens.contrast.test.js in both
 * themes. The tinted chip clears AA only over a card or a stat tile, so it
 * lives on the swap row (`dash-surface2`) and nowhere else.
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

export default function BenchWhatIf({ whatIf, hasRoster, leagueId, headingLevel = 2, ...rest }) {
  const headingId = useId();
  if (!whatIf || !hasRoster) return null;

  const delta = Number(whatIf.delta) || 0;
  const optimal = delta <= 0;
  const swap = optimal ? null : firstSwap(whatIf.swaps);
  const gain = swap ? points(swap.gain) : null;

  return (
    <Card
      data-testid="bench-what-if"
      aria-labelledby={headingId}
      sx={{
        p: { xs: '12px 14px', sm: '14px 18px' },
        borderColor: 'var(--dash-warning)',
      }}
      {...rest}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box
          component="span"
          aria-hidden="true"
          sx={{ display: 'flex', flex: 'none', color: 'var(--dash-warning)' }}
        >
          <BoltIcon />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
          <Typography
            id={headingId}
            component={`h${headingLevel}`}
            sx={{
              m: 0,
              fontSize: '14px',
              fontWeight: 600,
              lineHeight: 1.45,
              color: 'var(--dash-ink)',
            }}
          >
            Bench what-if
          </Typography>
          {/* The faint tier clears AA_TEXT on every dash surface (tokens.js). */}
          <Typography
            component="p"
            sx={{ m: 0, fontSize: '12px', lineHeight: 1.45, color: 'var(--dash-faint)' }}
          >
            {optimal ? (
              <span data-testid="bench-what-if-headline">
                Your best legal lineup is already active.
              </span>
            ) : (
              <>
                <span data-testid="bench-what-if-headline">
                  {`+${delta.toFixed(1)} still on your bench.`}
                </span>{' '}
                <span>Locked players cannot be swapped.</span>
              </>
            )}
          </Typography>
        </Box>
      </Box>

      {swap && (
        <Box
          data-testid="bench-what-if-swap"
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            mt: '12px',
            px: '12px',
            py: '10px',
            borderRadius: 'var(--dash-radius-sm)',
            backgroundColor: 'var(--dash-surface2)',
          }}
        >
          {/* The benched starter, struck through. `<s>` carries the "no longer
              relevant" meaning; the inline style is what a test reads. */}
          <Typography
            component="s"
            data-testid="bench-what-if-out"
            style={{ textDecoration: 'line-through' }}
            sx={{ fontSize: '14px', color: 'var(--dash-faint)' }}
          >
            {playerLabel(swap.out)}
          </Typography>
          <Box
            component="span"
            aria-hidden="true"
            sx={{ display: 'flex', flex: 'none', color: 'var(--dash-faint)' }}
          >
            <SwapIcon />
          </Box>
          <Typography
            component="span"
            data-testid="bench-what-if-in"
            sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--dash-ink)' }}
          >
            {playerLabel(swap.in)}
          </Typography>
          {gain != null && <GainChip>{`+${gain}`}</GainChip>}
          <Box sx={{ flex: '1 1 0' }} />
          <Button
            component={RouterLink}
            to={swapLineupHref(leagueId, swap)}
            disableElevation
            sx={PRIMARY_SX}
          >
            Swap in lineup
          </Button>
        </Box>
      )}
    </Card>
  );
}

// The canvas's `.chip.warn`: warning text and border on the warning tint. The
// kit's Badge carries the dashboard mockup's chip type (11.5px/600, no
// uppercase), not this canvas's, so the chip is transcribed here until a
// second warning-chip consumer earns Badge a `warn` variant.
function GainChip({ children }) {
  return (
    <Box
      component="span"
      data-testid="bench-what-if-gain"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: 22,
        px: '9px',
        borderRadius: 'var(--radius-pill)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        border: '1px solid var(--dash-warning)',
        color: 'var(--dash-warning)',
        backgroundColor: 'var(--dash-warning-soft)',
      }}
    >
      {children}
    </Box>
  );
}

// The canvas's `.btn.primary` at the card's 32px height: the `dash-on-accent`
// label on the `dash-accent` fill (the registered "dashboard primary button
// label on accent" pairing). On a phone the target grows to 44px so it is a
// comfortable tap; the row wraps around it.
const PRIMARY_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minHeight: { xs: 44, sm: 32 },
  px: '16px',
  py: 0,
  minWidth: 0,
  borderRadius: '9px',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  border: '1px solid var(--dash-accent)',
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  transition: 'filter var(--transition-fast)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
};

// Inline stroke icons on the canvas's 20px grid, one style, decorative.
const ICON_PROPS = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
  style: { display: 'block' },
};

function BoltIcon() {
  return (
    <svg width={18} height={18} {...ICON_PROPS}>
      <path d="M11 2 4 11h5l-1 7 7-9h-5z" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width={16} height={16} {...ICON_PROPS}>
      <path d="M4 7h11m0 0-3-3m3 3-3 3M16 13H5m0 0 3-3m-3 3 3 3" />
    </svg>
  );
}
