import React from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Card, InjuryTag, PosChip, PlayerAvatar, StateMark } from '../../../shared/ui';
import { starterStateView } from '../../../shared/lib';
import { ledFigure, ledScore, lineupNoteParts, positionRingKey } from '../model/scoreboardModel';
import Icon from './icons';

/**
 * The Lineups card from the Scoreboard view (design canvas rosterPreview()):
 * a compact, non-interactive slot-by-slot preview of the paired rows the
 * Matchup page model hands down, home on the left, the PosChip in the
 * middle, away mirrored on the right. Each filled side is a 28px PlayerAvatar
 * headshot (the ESPN photo, position-colored initials when there is none) in
 * a 2px ring of its position's `pos-*` color, as the canvas's headshot() draws it
 * and the slot-comparison widget rings its own (so the two lineup renderings
 * share one avatar treatment), the name with his injury designation beside
 * it when flagged (the kit's InjuryTag, the same tag the Starters table
 * shows, #903), and a note line of points and projection ("18.6 · proj 19.2")
 * or, for an
 * Unavailable starter, the reason ("0.0 · on bye"), the reason carrying the
 * `unavailable-reason` test id the Matchup Detail page tests read. Each name
 * carries the Standard view's state marker (a live dot, a check, a clock,
 * through `starterStateView` from `shared/lib`, #2010: the one `game_state`
 * map both views read) and the note line adds "vs OPP · clock" so game day
 * shows who is playing; the line wraps rather than ellipsizes, so a phone
 * never loses the clock (below md the marker leads that line and the name wraps
 * whole, #2010). The card ends with a Totals row: each side's score
 * and Expected final, read off the Matchup like the LED board's.
 *
 * It renders the rows AS GIVEN: the Matchup page model paired them under the
 * league's slot order (ADR 0029, #1210), so this card neither pairs nor
 * re-sorts, and a slot only one side has filled keeps its row with an empty
 * opposite side. Every row is
 * `data-testid="slot-row"`, the convention the Matchup Detail page tests read
 * to prove the two lineup renderings agree slot for slot.
 *
 * Composes `shared/ui` (ADR 0020) and paints only registered pairings: ink,
 * dim and faint on the card surface, and PosChip's own position fills; the
 * headshot ring is a `pos-*` graphic beside text, not a text pairing, and its
 * key is declared as `data-ring` where a test can read it (jsdom drops a
 * var() color from computed style). The one control, the optional "Full
 * comparison" action the page wires to its view toggle, meets the 44px target
 * on mobile.
 */
const NOTE = { fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--dash-faint)', whiteSpace: 'nowrap' };

// "vs OPP · clock": the schedule's opponent code (no home/away marker rides
// the wire, ADR 0011) and the live clock, each dropped when absent.
function Game({ player }) {
  if (!player.opponent && !player.game_clock) return null;
  return (
    <Box component="span" data-testid="lineup-game" sx={NOTE}>
      {player.opponent ? `vs ${player.opponent}` : null}
      {player.opponent && player.game_clock ? ' · ' : null}
      {player.game_clock ? <span>{player.game_clock}</span> : null}
    </Box>
  );
}

function Note({ player }) {
  const { points, reason, projected } = lineupNoteParts(player);
  return (
    <Box component="span" data-testid="lineup-note" sx={NOTE}>
      {points}
      {reason ? (
        <>
          {' · '}
          <span data-testid="unavailable-reason">{reason}</span>
        </>
      ) : projected != null ? (
        ` · proj ${projected}`
      ) : null}
    </Box>
  );
}

function Side({ player, side }) {
  const mirrored = side === 'away';
  // Below md the half-width side cannot hold the name, marker and tag on one
  // line: the marker moves to lead the second line and the name wraps (never
  // an ellipsis), so a phone shows whole names and keeps the clock. `useTheme`
  // falls back to the default theme outside a provider, as the page widget's does.
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const mark = <StateMark view={starterStateView(player?.game_state)} />;
  if (!player) return <Box data-testid={`lineup-side-${side}`} sx={{ flex: '1 1 0', minWidth: 0 }} />;
  return (
    <Box
      data-testid={`lineup-side-${side}`}
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexDirection: mirrored ? 'row-reverse' : 'row',
        textAlign: mirrored ? 'right' : 'left',
      }}
    >
      <Box
        data-testid={`headshot-${side}`}
        data-ring={positionRingKey(player.position)}
        sx={{
          flex: 'none',
          display: 'flex',
          borderRadius: 'var(--radius-pill)',
          boxShadow: `0 0 0 2px var(--pos-${positionRingKey(player.position)})`,
        }}
      >
        <PlayerAvatar name={player.name} position={player.position} photoUrl={player.photo_url} size={28} />
      </Box>
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
          data-testid="lineup-line1"
          sx={{
            maxWidth: '100%',
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexDirection: mirrored ? 'row-reverse' : 'row',
          }}
        >
          <Box
            component="span"
            sx={{
              minWidth: 0,
              ...(compact
                ? { overflowWrap: 'break-word' }
                : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--dash-ink)',
            }}
          >
            {player.name}
          </Box>
          {!compact && mark}
          <InjuryTag status={player.injury_status} />
        </Box>
        <Box
          data-testid="lineup-line2"
          sx={{
            maxWidth: '100%',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: '8px',
            justifyContent: mirrored ? 'flex-end' : 'flex-start',
          }}
        >
          {compact && mark}
          <Note player={player} />
          <Game player={player} />
        </Box>
      </Box>
    </Box>
  );
}

// One side of the Totals row: the score, with its Expected final beside it
// when the server priced one (a settled Matchup has none).
function Total({ team, side }) {
  const ef = team?.expectedFinal;
  const score = <Box component="span" sx={{ ...DISPLAY_NUM, fontSize: '22px' }}>{ledScore(team?.score)}</Box>;
  const note = ef != null && ef !== '' ? <Box component="span" sx={NOTE}>Exp final {ledFigure(ef)}</Box> : null;
  return (
    <Box data-testid={`lineup-total-${side}`} sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      {side === 'home' ? <>{score}{note}</> : <>{note}{score}</>}
    </Box>
  );
}

const DISPLAY_NUM = {
  fontFamily: 'var(--dash-font-display)',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 700,
  lineHeight: 1,
  color: 'var(--dash-ink)',
};

export default function LineupsCard({ rows, matchup, headingLevel = 2, onFullComparison, mobile }) {
  const list = rows || [];
  return (
    <Card
      data-testid="lineups-card"
      title="Lineups"
      count="Slot by slot"
      headingLevel={headingLevel}
      tail={
        onFullComparison ? (
          <Box
            component="button"
            type="button"
            onClick={onFullComparison}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
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
            Full comparison
            <Icon name="chevR" size={14} />
          </Box>
        ) : null
      }
    >
      {list.length === 0 ? (
        <Box sx={{ p: mobile ? '12px' : '14px 18px', fontSize: '13px', color: 'var(--dash-dim)' }}>
          No starters to show yet.
        </Box>
      ) : (
        <>
          {list.map((row, i) => (
          <Box
            data-testid="slot-row"
            key={`${row.slot}-${row.home?.id ?? 'x'}-${row.away?.id ?? 'x'}-${i}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              p: mobile ? '6px 12px' : '6px 18px',
              borderTop: i ? '1px solid var(--dash-line)' : 0,
            }}
          >
            <Side player={row.home} side="home" />
            <PosChip position={row.slot} sx={{ flex: 'none' }} />
            <Side player={row.away} side="away" />
          </Box>
          ))}
          <Box
            data-testid="lineup-totals"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              p: mobile ? '10px 12px' : '12px 18px',
              borderTop: '1px solid var(--dash-line)',
              backgroundColor: 'var(--dash-surface2)',
              borderRadius: '0 0 var(--dash-radius) var(--dash-radius)',
            }}
          >
            <Total team={matchup?.home} side="home" />
            <Box component="span" sx={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dash-faint)' }}>
              Totals
            </Box>
            <Total team={matchup?.away} side="away" />
          </Box>
        </>
      )}
    </Card>
  );
}
