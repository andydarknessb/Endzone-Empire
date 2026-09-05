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
 * The live dot is `--danger`, as the canvas paints it (build.mjs, the Games
 * card's `.dot`) and as the slot-comparison widget on the same page paints
 * its own live marker: the dashboard group has no dash-danger, and `danger`
 * is an app token defined in both themes (tokens.js), reached the way
 * `--radius-pill` is here. `data-tone` declares that paint where a test can
 * read it (jsdom drops a var() color from computed style). The state never
 * rides on colour alone: a live row carries a visually-hidden "Live" beside
 * the dot, and the clock cell says FINAL or the kickoff time in plain text
 * otherwise. Composes `shared/ui` (ADR 0020) and paints only registered
 * pairings: ink and faint on the card surface; the dot is a graphic beside
 * text, not a text pairing.
 */
function Glyph({ state }) {
  if (state === 'live') {
    return (
      <>
        <Box
          data-testid="live-dot"
          data-tone="danger"
          aria-hidden="true"
          sx={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', backgroundColor: 'var(--danger)', flex: 'none' }}
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
