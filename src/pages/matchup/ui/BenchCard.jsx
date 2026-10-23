import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, InjuryTag, PixelHeading, PosTag, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import { unavailableLabel } from '../../../entities/roster';

/**
 * The Bench frame of the Matchup page (ADR 0031, #903), drawn as the board's primary frame (ADR 0067
 * wave 2, spec #2334 ruling 4): a pixel h2 "Bench" with the two bench counts ("7 players each", or
 * "6 · 7 players" when they differ, #2009) and a Show / Hide ghost button (44px, never filled),
 * collapsed by default. Open, it lists both benches, the board's first side on the left and second on the right (stacked
 * below sm): each row is the player's position tag, his name (a button that opens the player) with
 * his injury designation beside it when flagged and his NFL team, and his figure on the right.
 *
 * The figure follows the starters (RULINGS Critique 8 and 11): a player whose game has started shows
 * his points with "proj {x}" as line two ("13.4 pts" over "proj 12.9", "8.6 pts · final" over "proj
 * 8.1" once his game is final); a player whose game has not started shows "proj {x}" alone; an
 * Unavailable player shows the reason ("on bye", "out", "on IR") in place of the figure. A row whose
 * game state the wire did not say reads like a started one.
 *
 * Once a Matchup is final in a league that sets a lineup, the points each side left on its bench (the
 * page's hindsight read) print under the header whether the card is open or not: "Left 12.4 on the
 * bench" per side. Under the benches, each team's called shot once the server shows it (#1857):
 * "Called shot: {starter} over {benched} · 11.4 to 6.2", moving with the live points, and "Hit" or
 * "Miss" once judged. The page model builds the text; this card only lays it out.
 *
 * The Show / Hide control's accessible name says what it shows ("Show benches" / "Hide benches", #903
 * review). Paints only `ps-*` tokens.
 */
const players = (n) => `${n} player${n === 1 ? '' : 's'}`;
// Equal counts read once and two empty benches print nothing; unequal ones show
// both, the visible text hidden from assistive tech in favour of a line naming
// each team (#2009).
function benchCount(first, second, firstName, secondName) {
  if (first === second) return first === 0 ? undefined : `${players(first)} each`;
  return (
    <>
      <span aria-hidden="true">{`${first} · ${second} players`}</span>
      <Box component="span" sx={SR_ONLY_SX}>{`${firstName} ${players(first)}, ${secondName} ${players(second)}`}</Box>
    </>
  );
}

const META = { fontSize: '13px', color: 'var(--ps-dim)' };
const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export default function BenchCard({
  firstName,
  secondName,
  firstBench,
  secondBench,
  open,
  onToggle,
  onOpenPlayer,
  benchLeft,
  showBenchLeft,
  calledShots,
}) {
  const panelId = useId();
  const headingId = useId();
  const first = firstBench || [];
  const second = secondBench || [];
  const count = benchCount(first.length, second.length, firstName, secondName);
  const leftFirst = showBenchLeft && benchLeft?.first != null ? benchLeft.first : null;
  const leftSecond = showBenchLeft && benchLeft?.second != null ? benchLeft.second : null;
  const shotFirst = calledShots?.first || null;
  const shotSecond = calledShots?.second || null;

  return (
    <Frame
      labelledBy={headingId}
      data-testid="bench-card"
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Bench</PixelHeading>
          {count != null && <Box component="span" sx={{ ...META, ml: 'auto' }}>{count}</Box>}
          <Box
            component="button"
            type="button"
            aria-label={open ? 'Hide benches' : 'Show benches'}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={onToggle}
            sx={{
              ml: count == null ? 'auto' : 0,
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 16px',
              boxSizing: 'border-box',
              border: '2px solid var(--ps-ink)',
              borderRadius: 0,
              backgroundColor: 'transparent',
              color: 'var(--ps-ink)',
              fontFamily: 'inherit',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {open ? 'Hide' : 'Show'}
          </Box>
        </FrameHead>
      )}
    >
      {(leftFirst != null || leftSecond != null) && (
        <Box
          data-testid="bench-left"
          sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px', px: { xs: '14px', md: '20px' }, py: '10px', fontSize: '14px', color: 'var(--ps-dim)', borderBottom: open ? '2px solid var(--ps-rule)' : 0,
          }}
        >
          <BenchLeft name={firstName} value={leftFirst} side="home" />
          <BenchLeft name={secondName} value={leftSecond} side="away" align="right" />
        </Box>
      )}

      {open && (
        <Box
          id={panelId}
          data-testid="bench-panel"
          sx={{
            display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: { xs: '20px', md: '24px 40px' }, padding: { xs: '14px 14px 16px', md: '16px 20px 20px' },
          }}
        >
          <BenchColumn name={firstName} players={first} side="home" onOpenPlayer={onOpenPlayer} />
          <BenchColumn name={secondName} players={second} side="away" onOpenPlayer={onOpenPlayer} />
        </Box>
      )}

      {(shotFirst || shotSecond) && (
        <Box
          sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px 20px', px: { xs: '14px', md: '20px' }, py: '10px', fontSize: '14px', color: 'var(--ps-dim)', borderTop: open ? '2px solid var(--ps-rule)' : 0,
          }}
        >
          <CalledShot shot={shotFirst} side="home" />
          <CalledShot shot={shotSecond} side="away" align="right" />
        </Box>
      )}
    </Frame>
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
      <Box component="span" sx={ELLIPSIS}>{name}</Box>
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ps-ink)' }}>
        {`Left ${Number(value).toFixed(1)} on the bench`}
      </Box>
    </Box>
  );
}

function CalledShot({ shot, side, align = 'left' }) {
  if (!shot) return <span />;
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: align, minWidth: 0 }}>
      <Box component="span" data-testid={`called-shot-${side}`} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {shot.text}
      </Box>
      {shot.outcome && (
        <Box component="span" data-testid={`called-shot-outcome-${side}`} sx={{ fontWeight: 700, color: 'var(--ps-ink)' }}>
          {shot.outcome}
        </Box>
      )}
    </Box>
  );
}

function BenchColumn({ name, players: list, side, onOpenPlayer }) {
  return (
    <Box
      component="section"
      aria-label={`${name || side} bench`}
      data-testid={`bench-${side}`}
      sx={{ minWidth: 0 }}
    >
      <Box component="h3" sx={{ m: '0 0 4px', ...META, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        {name}
      </Box>
      {list.length === 0 ? (
        <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>No bench players.</Box>
      ) : (
        <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {list.map((player, i) => (
            <BenchRow key={player.id ?? i} player={player} last={i === list.length - 1} onOpenPlayer={onOpenPlayer} />
          ))}
        </Box>
      )}
    </Box>
  );
}

const fixed = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(1) : null);

// The figure on the right of a bench row (see the card's doc block).
function Figure({ player }) {
  const reason = unavailableLabel(player);
  const projected = fixed(player.projected);
  if (reason) {
    return <Box component="span" data-testid="unavailable-reason" sx={{ fontSize: '15px', color: 'var(--ps-dim)', flex: 'none' }}>{reason}</Box>;
  }
  if (player.game_state === 'scheduled') {
    return projected != null
      ? <Box component="span" data-testid="bench-proj" sx={{ fontSize: '15px', color: 'var(--ps-dim)', flex: 'none' }}>{`proj ${projected}`}</Box>
      : null;
  }
  const final = player.game_state === 'final';
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 'none', lineHeight: 1.3, textAlign: 'right' }}>
      <span>
        {player.game_state === 'in_progress' && <Box component="span" sx={SR_ONLY_SX}>In progress, </Box>}
        <Box component="b" data-testid="bench-points" sx={{ fontSize: '16px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {(Number(player.points) || 0).toFixed(1)}
        </Box>
        {' '}
        <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{final ? 'pts · final' : 'pts'}</Box>
      </span>
      {projected != null && <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{`proj ${projected}`}</Box>}
    </Box>
  );
}

function BenchRow({ player, last, onOpenPlayer }) {
  return (
    <Box
      component="li"
      data-testid="bench-row"
      sx={{
        display: 'flex', alignItems: 'center', gap: { xs: '10px', md: '12px' }, minHeight: '48px', py: { xs: '6px', md: 0 }, borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <PosTag position={player.position} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px' }}>
        <Box
          component="button"
          type="button"
          onClick={() => onOpenPlayer?.(player.id)}
          sx={{
            minWidth: 0, minHeight: '44px', border: 0, p: 0, m: 0, background: 'transparent', font: 'inherit', fontSize: '15px', fontWeight: 600, textAlign: 'left', color: 'var(--ps-ink)', cursor: 'pointer', overflowWrap: 'anywhere', '&:hover': { textDecoration: 'underline' },
          }}
        >
          {player.name}
        </Box>
        <InjuryTag status={player.injury_status} data-testid="injury-tag" />
        {player.nfl_team && <Box component="span" sx={META}>{player.nfl_team}</Box>}
      </Box>
      <Figure player={player} />
    </Box>
  );
}
