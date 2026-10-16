import React from 'react';
import { Box } from '@mui/material';
import { SR_ONLY_SX } from '../../../shared/ui/playselect';
import { gameTileView } from '../model/gameTileView';

/**
 * The NFL games strip (ADR 0031, ticket #901), drawn the one way on every wave 2 page (ADR 0067,
 * spec #2334 ruling 4): Board black with no visible heading (it keeps `aria-label="NFL games"`), a
 * list that scrolls horizontally inside its own box. A live or final tile prints each score next to
 * its team ("JAX 20 - LAR 24") over the clock (live clocks in Board ink, after a square marker) or
 * "FINAL"; a scheduled tile prints "ARI @ SF" over the kickoff. A tile is 1/6.5 of the box wide on
 * desktop and 1/1.5 on a phone, so the next game is always cut at the right edge and the scroll
 * reads (Critique 9).
 *
 * It is a pure render of the `live_game_states` rows the Matchup entity hands down as `model.games`
 * (#885): it reads nothing itself and opens no channel. The per-tile read lives in
 * `model/gameTileView`. An empty list renders nothing at all. The list is a scroll container, so it is
 * keyboard-reachable (tabIndex 0). State never rides on colour: a live tile carries a visually hidden
 * "Live", a scheduled one "Scheduled", a final one prints FINAL.
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
      sx={{
        backgroundColor: 'var(--ps-board)',
        color: 'var(--ps-board-ink)',
        border: '6px double var(--ps-board-dim)',
        minWidth: 0,
      }}
    >
      <Box
        component="ul"
        role="list"
        aria-label="NFL games"
        tabIndex={0}
        data-testid={testId}
        sx={{
          display: 'flex',
          m: 0,
          p: 0,
          listStyle: 'none',
          overflowX: 'auto',
          minWidth: 0,
          '&:focus-visible': { outline: '3px solid var(--ps-focus)', outlineOffset: '-3px' },
        }}
      >
        {rows.map((row, index) => (
          <GameTile key={gameTileView(row).key || index} row={row} first={index === 0} />
        ))}
      </Box>
    </Box>
  );
}

function GameTile({ row, first }) {
  const view = gameTileView(row);
  const live = view.state === 'live';
  return (
    <Box
      component="li"
      data-testid="nfl-game-tile"
      data-state={view.state}
      sx={{
        flex: 'none',
        width: { xs: 'calc(100% / 1.5)', md: 'calc(100% / 6.5)' },
        boxSizing: 'border-box',
        minHeight: '64px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '2px',
        padding: '8px 16px',
        borderLeft: first ? 0 : '2px solid var(--ps-board-rule)',
      }}
    >
      <Box component="span" sx={{ fontSize: '15px', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {`${view.awayLabel} ${view.separator} ${view.homeLabel}`}
      </Box>
      {view.trailing != null && (
        <Box
          component="span"
          data-testid="nfl-game-trailing"
          sx={{
            fontSize: '14px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', fontVariantNumeric: 'tabular-nums', color: live ? 'var(--ps-board-ink)' : 'var(--ps-board-dim)',
          }}
        >
          {live && (
            <Box
              component="span"
              aria-hidden="true"
              data-testid="nfl-game-live-dot"
              sx={{ display: 'inline-block', width: '8px', height: '8px', mr: '6px', backgroundColor: 'var(--ps-board-ink)' }}
            />
          )}
          <Box component="span" sx={{ fontWeight: live ? 600 : undefined }}>{view.trailing}</Box>
        </Box>
      )}
      <Box component="span" sx={SR_ONLY_SX}>{live ? 'Live' : view.state === 'scheduled' ? 'Scheduled' : ''}</Box>
    </Box>
  );
}
