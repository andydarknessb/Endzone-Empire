import React from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card } from '../../../shared/ui';
import { gameState, gameLine, gameClock, liveCount } from '../model/scoreboardModel';
import Icon from './icons';

/**
 * The Games tile from the Scoreboard view (design canvas, the card beside the
 * roster preview in matchupScoreboardDesktop()): every real NFL game this
 * Matchup spans, one row each, with a live dot while in progress or a clock
 * glyph otherwise, the score line and the clock cell (scoreboardModel.js:
 * quarter and time, FINAL, or the kickoff time). It is a pure render of the
 * rows the entity hands down as `model.games` (#885); it opens no channel of
 * its own.
 *
 * The live dot is `dash-accent`: the canvas paints it in the app's danger
 * red, but the island has no `dash-danger` token and the kit's own live
 * vocabulary (Badge's `live` variant, the sibling strip's dot) is the accent.
 * The state never rides on colour alone: a live row carries a visually-hidden
 * "Live" beside the dot, and the clock cell says FINAL or the kickoff time in
 * plain text otherwise. Composes `shared/ui` (ADR 0020) and paints only
 * registered pairings: ink and faint on the card surface.
 */
function Glyph({ state }) {
  if (state === 'live') {
    return (
      <>
        <Box
          data-testid="live-dot"
          aria-hidden="true"
          sx={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', backgroundColor: 'var(--dash-accent)', flex: 'none' }}
        />
        <Box component="span" sx={visuallyHidden}>Live</Box>
      </>
    );
  }
  return (
    <Box data-testid="clock-glyph" sx={{ display: 'flex', color: 'var(--dash-faint)', flex: 'none' }}>
      <Icon name="clock" size={12} />
    </Box>
  );
}

export default function GamesTile({ games, headingLevel = 2, mobile }) {
  const rows = games || [];
  const live = liveCount(rows);
  return (
    <Card
      data-testid="games-tile"
      title="Games"
      count={`${live} live`}
      headingLevel={headingLevel}
    >
      <Box sx={{ p: mobile ? '10px 12px' : '10px 18px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.length === 0 && (
          <Box sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}>No games listed.</Box>
        )}
        {rows.map((game, i) => {
          const state = gameState(game);
          return (
            <Box
              key={game.tank01_game_id ?? i}
              data-testid="game-row"
              data-state={state}
              sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--dash-ink)' }}
            >
              <Glyph state={state} />
              <Box
                component="span"
                sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 92, flex: 'none', whiteSpace: 'nowrap' }}
              >
                {gameLine(game)}
              </Box>
              <Box
                component="span"
                sx={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--dash-faint)', whiteSpace: 'nowrap' }}
              >
                {gameClock(game)}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}
