import React from 'react';
import PropTypes from 'prop-types';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { gameTileView } from '../model/gameTileView';

/**
 * The NFL games strip (ADR 0031, ticket #901): one tile per real NFL game a
 * Matchup spans, scrolling horizontally. It is a pure render of the
 * `live_game_states` rows the Matchup entity hands down as `model.games`
 * (#885): it reads nothing itself and opens no channel, the entity hook owns
 * the one realtime subscription. Each tile is a live dot (in progress), a
 * clock glyph (scheduled) or nothing (final); then "AWAY score - score HOME"
 * (scheduled: "AWAY @ HOME", no scores); then the quarter and clock, FINAL,
 * or the kickoff time when known. An empty list renders nothing at all.
 *
 * Transcribed from the design canvas (docs/design/game-center-matchups/
 * build.mjs, `nflStrip`): an 8px-gap row of `.tile`s (dash-surface2, a
 * dash-line hairline, the 10px small radius), each 6px 10px padded at 12px
 * type with an 8px gap between its parts; the two labels are 600-weight
 * tabular figures, the separator and the trailing clock sit in the faint
 * tier. The canvas clips the row; the ticket says it scrolls, so this one is
 * `overflow-x: auto` and, being a scroll container, is keyboard-reachable
 * (tabIndex 0, the kit's focus ring).
 *
 * Paints only `dash-*` tokens (plus the app's radius and focus-ring tokens
 * the kit already uses). The ink, dim and faint tiers on `dash-surface2` are
 * registered pairings (tokens.contrast.test.js). The live dot is
 * `dash-accent`: the canvas paints it in the app's danger red, but the island
 * has no `dash-danger` token and the kit's own live vocabulary (Badge's
 * `live` variant) is the accent, so the dot follows the kit; `dash-accent`
 * was tuned to clear every dashboard surface (tokens.js) and is registered
 * over the accent tint on `dash-surface2`, a stricter composite than the
 * plain tile. The state never rides on colour alone: a live tile carries a
 * visually-hidden "Live", a scheduled one "Scheduled", and a final one shows
 * FINAL in plain text. Copy is house style: middots would separate, hyphens
 * score, no em dashes; the icon is an inline stroke SVG.
 */
export default function NflGameStrip({ games, 'data-testid': testId = 'nfl-game-strip' }) {
  const rows = Array.isArray(games) ? games.filter(Boolean) : [];
  if (rows.length === 0) return null;

  return (
    <Box
      component="ul"
      role="list"
      aria-label="NFL games"
      tabIndex={0}
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        m: 0,
        p: 0,
        listStyle: 'none',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        // The focus ring wants room outside the tiles' hairlines.
        py: '2px',
        '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
      }}
    >
      {rows.map((row, index) => (
        <GameTile key={gameTileView(row).key || index} row={row} />
      ))}
    </Box>
  );
}

NflGameStrip.propTypes = {
  // live_game_states rows: game_status, quarter, time_remaining, the two team
  // codes, the two current scores, and a kickoff (`kickoff_at`, or the
  // table's own `start_time`). An empty or absent list renders nothing.
  games: PropTypes.arrayOf(
    PropTypes.shape({
      tank01_game_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      game_status: PropTypes.string,
      quarter: PropTypes.string,
      time_remaining: PropTypes.string,
      home_team: PropTypes.string,
      away_team: PropTypes.string,
      current_score_home: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      current_score_away: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      kickoff_at: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
      start_time: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    })
  ),
  'data-testid': PropTypes.string,
};

// The canvas's `.num` with the 600 weight: a tabular figure label.
const LABEL_SX = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--dash-ink)',
};

const FAINT_SX = {
  color: 'var(--dash-faint)',
  fontVariantNumeric: 'tabular-nums',
};

function GameTile({ row }) {
  const view = gameTileView(row);
  return (
    <Box
      component="li"
      data-testid="nfl-game-tile"
      data-state={view.state}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: 'none',
        px: '10px',
        py: '6px',
        fontSize: '12px',
        lineHeight: 1.45,
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        color: 'var(--dash-ink)',
      }}
    >
      {view.state === 'live' && (
        <>
          <Box
            component="span"
            aria-hidden="true"
            data-testid="nfl-game-live-dot"
            sx={{
              width: 8,
              height: 8,
              flex: 'none',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--dash-accent)',
            }}
          />
          <Box component="span" sx={visuallyHidden}>Live</Box>
        </>
      )}
      {view.state === 'scheduled' && (
        <>
          <Box
            component="span"
            aria-hidden="true"
            data-testid="nfl-game-clock-icon"
            sx={{ display: 'flex', flex: 'none', color: 'var(--dash-faint)' }}
          >
            <ClockIcon />
          </Box>
          <Box component="span" sx={visuallyHidden}>Scheduled</Box>
        </>
      )}
      <Box component="span" sx={LABEL_SX}>{view.awayLabel}</Box>
      <Box component="span" sx={FAINT_SX}>{view.separator}</Box>
      <Box component="span" sx={LABEL_SX}>{view.homeLabel}</Box>
      {view.trailing != null && (
        <Box component="span" data-testid="nfl-game-trailing" sx={FAINT_SX}>
          {view.trailing}
        </Box>
      )}
    </Box>
  );
}

// The canvas's `clock` icon at 12px: an inline stroke SVG on the 20px grid.
function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}
