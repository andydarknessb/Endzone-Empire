import React from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import LedBoard from './LedBoard';
import RetroField from './RetroField';
import LineupsCard from './LineupsCard';
import GamesTile from './GamesTile';

/**
 * The Scoreboard view of a Matchup (ADR 0031, #902): the LED board, the retro
 * field, the Lineups card and the Games tile from the design canvas
 * (docs/design/game-center-matchups, matchupScoreboardDesktop() and its
 * mobile sibling), laid out as the canvas does: board over field, then the
 * Lineups card beside a 340px column that holds the Games tile (and, above
 * it, whatever the page slots in as `aside`: the bench what-if feature lives
 * there on the canvas and is the page's to compose; a widget imports no
 * feature, so it is a slot, not an import). Below the `md` breakpoint the
 * columns stack in the mobile artboard's order (matchupScoreboardMobile()):
 * the Games tile (standing where the artboard's NFL strip sits), then the
 * Lineups card, then the aside, which the artboard puts last. The stacking
 * is CSS only (the right column dissolves into the grid with
 * `display: contents` and the three slots take `order`), so the DOM keeps
 * the desktop reading order and nothing remounts at the breakpoint, which
 * matters for an aside that holds state. Below `sm` the board, field and
 * cards take their mobile geometry.
 *
 * Props:
 *   - `matchup`: the Matchup entity model (entities/matchup): the LED board
 *     reads each side's name, score, Expected final and Players remaining, the
 *     week and the status.
 *   - `leagueName`: the league's name for the board's top line.
 *   - `rows`: the paired starter rows the entity hands down
 *     (`[{ slot, home, away }]`, pairStartersBySlot), rendered as given.
 *   - `games`: the live_game_states rows on `model.games`.
 *   - `activePlay`: `{ side, type, isTouchdown, nflTeam, opponent }` or null;
 *     a touchdown dashes that side's sprite, a moment play flashes the callout.
 *   - `homeProb`: the home win probability, 0..1 (null when unpriced).
 *   - `headingLevel`: the level of the two cards' headings (default 2), so a
 *     page slots the widget under its own heading without skipping a level.
 *   - `onFullComparison`: optional; when given the Lineups card grows a "Full
 *     comparison" action that calls it (the page swaps to the standard view).
 *   - `aside`: optional content for the right column above the Games tile.
 *   - `fieldTail`: optional content for the right of the field's caption row
 *     (the canvas draws the "Celebrations on" affordance there; it is the
 *     celebrate-touchdown feature's, so the page slots it in).
 *
 * The widget renders nothing without a Matchup. It reads no data of its own:
 * the page owns the entity hook, the score feed, the cutscene queue and the
 * toasts, and hands the widget what it shows.
 */
export default function RetroScoreboard({
  matchup,
  leagueName,
  rows,
  games,
  activePlay,
  homeProb,
  headingLevel = 2,
  onFullComparison,
  aside,
  fieldTail,
}) {
  // `useTheme` falls back to the default theme outside a provider (a widget
  // test renders bare), so the breakpoint resolves the same way the sibling
  // slot-comparison widget's does.
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  if (!matchup) return null;

  return (
    <Box
      data-testid="retro-scoreboard"
      sx={{ display: 'flex', flexDirection: 'column', gap: mobile ? '12px' : '16px', fontFamily: 'var(--dash-font-body)' }}
    >
      <LedBoard matchup={matchup} leagueName={leagueName} homeProb={homeProb} mobile={mobile} />
      <RetroField
        homeName={matchup.home?.name}
        awayName={matchup.away?.name}
        homeProb={homeProb}
        activePlay={activePlay}
        mobile={mobile}
        tail={fieldTail}
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
          gap: mobile ? '12px' : '16px',
          alignItems: 'start',
        }}
      >
        <Box data-testid="lineups-slot" sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>
          <LineupsCard rows={rows} headingLevel={headingLevel} onFullComparison={onFullComparison} mobile={mobile} />
        </Box>
        <Box
          data-testid="right-column"
          sx={{
            display: { xs: 'contents', md: 'flex' },
            order: { md: 2 },
            minWidth: 0,
            flexDirection: 'column',
            gap: mobile ? '12px' : '16px',
          }}
        >
          {aside ? (
            <Box data-testid="aside-slot" sx={{ order: { xs: 3, md: 1 }, minWidth: 0 }}>
              {aside}
            </Box>
          ) : null}
          <Box data-testid="games-slot" sx={{ order: { xs: 1, md: 2 }, minWidth: 0 }}>
            <GamesTile games={games} headingLevel={headingLevel} mobile={mobile} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
