import React from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { gameTileView } from '../model/gameTileView';

/**
 * The NFL games strip (ADR 0031, ticket #901): one tile per real NFL game a
 * Matchup spans, scrolling horizontally. It is a pure render of the
 * `live_game_states` rows the Matchup entity hands down as `model.games`
 * (#885): it reads nothing itself and opens no channel, the entity hook owns
 * the one realtime subscription. Each tile is a live dot (in progress), a
 * clock glyph (scheduled) or nothing (final); then "AWAY score - HOME score",
 * the code before its score on both sides as the canvas prints it
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
 * the kit already uses: SegmentedControl paints the same ring). The ink and
 * faint tiers on `dash-surface2` are registered pairings
 * (tokens.contrast.test.js).
 *
 * The live dot is LIVE_DOT_COLOR, `dash-accent`, and that is a recorded
 * deviation from the canvas, whose `.dot` is the app's danger red (nflStrip(),
 * the Starters legend, the hero's "games in progress" line). The island's
 * other two 8px dots (slot-comparison's LiveDot, retro-scoreboard's Games
 * tile) paint `dash-accent` on the same reasoning, the kit's own live
 * vocabulary being the accent (Badge's `live` variant); the scoring-feed
 * slice's Live PILL is the one danger element, and it brings its own
 * `dash-danger` tokens and Badge variant with it. Whether the dots follow the
 * pill is an island-wide ruling, not this slice's: if it lands on red, the
 * change here is LIVE_DOT_COLOR alone, to `var(--dash-danger)` once that
 * token is on integration, with a `dash-danger` on `dash-surface2` row
 * registered in the guard (a graphical object, so WCAG 1.4.11's 3:1 bar, not
 * the text rows' 4.5). The state never rides on colour alone either way: a
 * live tile carries a visually-hidden "Live", a scheduled one "Scheduled",
 * and a final one shows FINAL in plain text. Copy is house style: middots
 * would separate, hyphens score, no em dashes; the icon is an inline stroke
 * SVG.
 *
 * @typedef {object} GameRow  one live_game_states row, as the entity hands it down
 * @property {string|number} [tank01_game_id]  the tile key (falls back to "AWAY@HOME")
 * @property {'scheduled'|'in_progress'|'final'} [game_status]  anything else reads as scheduled
 * @property {string|null} [quarter]  Tank01's quarter label ("Q3")
 * @property {string|null} [time_remaining]  Tank01's clock ("6:42")
 * @property {string} home_team  team code
 * @property {string} away_team  team code
 * @property {number|string} [current_score_home]  shown unless scheduled
 * @property {number|string} [current_score_away]  shown unless scheduled
 * @property {string|Date|null} [kickoff_at]  preferred over start_time when both are present
 * @property {string|Date|null} [start_time]  the table's own column name
 *
 * @param {object} props
 * @param {GameRow[]} [props.games]  an empty or absent list renders nothing
 * @param {string} [props.data-testid]  defaults to "nfl-game-strip"
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

// The live dot's fill: the one line the island-wide dot ruling changes (see
// the doc block above). Accent today, the kit's live vocabulary; the canvas's
// `.dot` is the danger red.
const LIVE_DOT_COLOR = 'var(--dash-accent)';

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
              backgroundColor: LIVE_DOT_COLOR,
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
