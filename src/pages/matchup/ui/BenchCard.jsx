import React, { useId } from 'react';
import { Box } from '@mui/material';
import { Card, PosChip } from '../../../shared/ui';
import { unavailableLabel } from '../../../widgets/slot-comparison';

/**
 * The Bench card of the Matchup page (ADR 0031, #903), transcribed from the
 * canvas's `benchSection()` (docs/design/game-center-matchups/build.mjs): a
 * card header reading "Bench" with the two bench counts ("6 · 7 players")
 * and a Show / Hide action with the chevron, collapsed by default. Open, it
 * lists both benches side by side, home on the left and away on the right:
 * each row is the player's position chip, his name (a button that opens the
 * player quick view), the points, and beneath the name either his projection
 * or, for an Unavailable player, the reason in place of it ("on bye", "out",
 * "on IR"), the one rule the slot-comparison widget exports.
 *
 * Once a Matchup is final in a league that sets a lineup, the points each
 * side left on its bench (the page's hindsight read) print under the header
 * whether the card is open or not: "Left 12.4 on the bench" per side, the
 * legacy page's exact line.
 *
 * Composes `shared/ui` (Card, PosChip) and paints only `dash-*` tokens plus
 * the app's radius and focus-ring tokens; ink, dim and faint on the card
 * surface are registered pairings. The count and the Show / Hide control sit
 * in the card header's `tail` slot, as the Lineups card's action does.
 */
export default function BenchCard({
  homeName,
  awayName,
  homeBench,
  awayBench,
  open,
  onToggle,
  onOpenPlayer,
  benchLeft,
  showBenchLeft,
  mobile = false,
}) {
  const panelId = useId();
  const home = homeBench || [];
  const away = awayBench || [];
  const count = `${home.length} · ${away.length} players`;
  const leftHome = showBenchLeft && benchLeft?.home != null ? benchLeft.home : null;
  const leftAway = showBenchLeft && benchLeft?.away != null ? benchLeft.away : null;

  return (
    <Card
      data-testid="bench-card"
      title="Bench"
      count={count}
      tail={(
        <Box
          component="button"
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={onToggle}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minHeight: mobile ? 44 : 30,
            px: '6px',
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: '13px',
            color: 'var(--dash-dim)',
            borderRadius: 'var(--radius-sm)',
            '&:hover': { color: 'var(--dash-ink)' },
            '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
          }}
        >
          {open ? 'Hide' : 'Show'}
          <Chevron up={open} />
        </Box>
      )}
    >
      {(leftHome != null || leftAway != null) && (
        <Box
          data-testid="bench-left"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '10px',
            px: mobile ? '14px' : '18px',
            py: '10px',
            fontSize: '12px',
            color: 'var(--dash-dim)',
            borderBottom: open ? '1px solid var(--dash-line)' : 0,
          }}
        >
          <BenchLeft name={homeName} value={leftHome} side="home" />
          <BenchLeft name={awayName} value={leftAway} side="away" align="right" />
        </Box>
      )}

      {open && (
        <Box
          id={panelId}
          data-testid="bench-panel"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: mobile ? '10px' : '18px',
            px: mobile ? '14px' : '18px',
            py: '12px',
          }}
        >
          <BenchColumn name={homeName} players={home} side="home" onOpenPlayer={onOpenPlayer} mobile={mobile} />
          <BenchColumn name={awayName} players={away} side="away" onOpenPlayer={onOpenPlayer} mobile={mobile} />
        </Box>
      )}
    </Card>
  );
}

function BenchLeft({ name, value, side, align = 'left' }) {
  if (value == null) return <span />;
  return (
    <Box
      component="span"
      data-testid={`bench-left-${side}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: align, minWidth: 0 }}
    >
      <Box component="span" sx={{ ...ELLIPSIS, color: 'var(--dash-faint)' }}>{name}</Box>
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {`Left ${Number(value).toFixed(1)} on the bench`}
      </Box>
    </Box>
  );
}

function BenchColumn({ name, players, side, onOpenPlayer, mobile }) {
  const mirrored = side === 'away';
  return (
    <Box
      component="section"
      aria-label={`${name || side} bench`}
      data-testid={`bench-${side}`}
      sx={{ minWidth: 0, textAlign: mirrored ? 'right' : 'left' }}
    >
      <Box component="span" sx={{ ...LABEL, ...ELLIPSIS, display: 'block', pb: '6px' }}>
        {name}
      </Box>
      {players.length === 0 ? (
        <Box sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}>No bench players.</Box>
      ) : (
        <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {players.map((player, i) => (
            <BenchRow
              key={player.id ?? i}
              player={player}
              mirrored={mirrored}
              first={i === 0}
              onOpenPlayer={onOpenPlayer}
              mobile={mobile}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

function BenchRow({ player, mirrored, first, onOpenPlayer, mobile }) {
  const reason = unavailableLabel(player.availability);
  const projected = player.projected != null && Number.isFinite(Number(player.projected))
    ? Number(player.projected).toFixed(1)
    : null;
  return (
    <Box
      component="li"
      data-testid="bench-row"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexDirection: mirrored ? 'row-reverse' : 'row',
        py: '6px',
        borderTop: first ? 0 : '1px solid var(--dash-line)',
      }}
    >
      <PosChip position={player.position} sx={{ flex: 'none' }} />
      <Box
        sx={{
          flex: '1 1 0',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: mirrored ? 'flex-end' : 'flex-start',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => onOpenPlayer?.(player.id)}
          sx={{
            minWidth: 0,
            maxWidth: '100%',
            minHeight: mobile ? 44 : undefined,
            border: 0,
            p: 0,
            m: 0,
            background: 'transparent',
            font: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.45,
            textAlign: 'inherit',
            color: 'var(--dash-ink)',
            cursor: 'pointer',
            ...ELLIPSIS,
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2, borderRadius: '4px' },
          }}
        >
          {player.name}
        </Box>
        {reason ? (
          <Box component="span" data-testid="unavailable-reason" sx={NOTE}>{reason}</Box>
        ) : projected != null ? (
          <Box component="span" sx={{ ...NOTE, fontVariantNumeric: 'tabular-nums' }}>{`proj ${projected}`}</Box>
        ) : null}
      </Box>
      <Box
        component="span"
        data-testid="bench-points"
        sx={{
          flex: 'none',
          fontFamily: 'var(--dash-font-display)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '18px',
          fontWeight: 700,
          lineHeight: 1,
          color: 'var(--dash-ink)',
        }}
      >
        {(Number(player.points) || 0).toFixed(1)}
      </Box>
    </Box>
  );
}

// The canvas's `chevD` on the 20px grid, flipped once the panel is open.
function Chevron({ up }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none', transform: up ? 'rotate(180deg)' : undefined }}
    >
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  );
}

const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NOTE = { fontSize: '12px', color: 'var(--dash-faint)' };
const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};
