import React from 'react';
import { Box } from '@mui/material';
import { ledFigure, ledPercents, ledStatus } from '../model/scoreboardModel';

/**
 * The LED board from the Scoreboard view (design canvas ledBoard()): amber
 * digits on the board token in Press Start 2P (self-hosted, base.css), the
 * league, week and status across the top, each side's name over its
 * one-decimal score, both win percentages in the middle, a hairline in the
 * LED's dim tint, and a second row of EXP FINAL and TO PLAY per side. The
 * board stays dark in both themes (tokens.js: a scoreboard is black); the one
 * ink-on-surface pairing it paints, `dash-led` on `dash-board`, is registered
 * in tokens.contrast.test.js (ADR 0031).
 *
 * Every figure but the names, the week and the status chip is the entity
 * board's (#2142): the score text, Players remaining, Win probability and
 * result line. The WIN row (#903 review): rendered only while the board says
 * the Matchup has started and states no result (so a scheduled Matchup prints
 * no WIN digits at all), and
 * aria-hidden when it is: it is the visible, decorative duplicate of the
 * field image's accessible name, which already states the home side's win
 * probability, so the page announces the probability once. An unknown
 * probability under a started Matchup still prints the hyphens, visibly.
 *
 * A settled (played or final) Matchup states its result instead (#2007): one
 * result line ("You won by 6.2", the board's `resultLine`, written from the
 * viewer's side) replaces the WIN
 * row and the EXP FINAL / TO PLAY row. It is real text, never aria-hidden, set
 * in capitals on the LED face by CSS so the DOM keeps the sentence as written.
 */
export const LED_FONT = '"Press Start 2P", "Courier New", monospace';

function Digit({ children, size, testId }) {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        fontFamily: LED_FONT,
        fontSize: `${size}px`,
        lineHeight: 1.2,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dash-led)',
        textShadow: '0 0 10px var(--dash-led-dim)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function Small({ children, mobile, align, sx }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: LED_FONT,
        fontSize: mobile ? '8px' : '10px',
        lineHeight: 1.4,
        letterSpacing: '0.04em',
        color: 'var(--dash-led)',
        opacity: 0.85,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: align,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

// The "-" between the two win percentages: a visual separator only, so it is
// hidden from the accessibility tree and the two figures read back to back.
function Separator({ mobile }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{ fontFamily: LED_FONT, fontSize: mobile ? '8px' : '10px', color: 'var(--dash-led)', opacity: 0.5 }}
    >
      -
    </Box>
  );
}

function WinRow({ percents, mobile }) {
  const size = mobile ? 12 : 20;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: mobile ? '10px' : '8px' }}>
      <Digit size={size} testId="led-win-home">{percents.home}</Digit>
      <Separator mobile={mobile} />
      <Digit size={size} testId="led-win-away">{percents.away}</Digit>
    </Box>
  );
}

export default function LedBoard({ matchup, board, leagueName, mobile }) {
  const home = matchup.home || {};
  const away = matchup.away || {};
  const percents = ledPercents(board.winProbability?.home);
  const result = board.resultLine;
  const showWin = board.hasStarted === true && result == null;
  const status = ledStatus(matchup.status);
  const scoreSize = mobile ? 26 : 56;
  const figureSize = mobile ? 12 : 16;
  const vGap = mobile ? '10px' : '16px';

  const figures = [
    { key: 'home-ef', label: 'EXP FINAL', value: ledFigure(home.expectedFinal, 1), align: 'flex-start' },
    { key: 'home-pmr', label: 'TO PLAY', value: board.home.playersRemainingLabel ?? '-', align: 'flex-start' },
    { key: 'away-pmr', label: 'TO PLAY', value: board.away.playersRemainingLabel ?? '-', align: 'flex-end' },
    { key: 'away-ef', label: 'EXP FINAL', value: ledFigure(away.expectedFinal, 1), align: 'flex-end' },
  ];

  return (
    <Box
      data-testid="led-board"
      sx={{
        backgroundColor: 'var(--dash-board)',
        border: '1px solid var(--dash-line-strong)',
        borderRadius: 'var(--dash-radius)',
        p: mobile ? '14px' : '22px 28px',
        boxShadow: 'var(--shadow-2)',
        color: 'var(--dash-led)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', mb: vGap }}>
        <Small mobile={mobile}>{(leagueName || '').toUpperCase()}</Small>
        <Small mobile={mobile} sx={{ flex: 'none' }}>{matchup.week != null ? `WEEK ${matchup.week}` : ''}</Small>
        <Small mobile={mobile} align="right" sx={{ flex: 'none' }}>{status}</Small>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: mobile ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr) auto minmax(0, 1fr)',
          gap: mobile ? '8px' : '24px',
          alignItems: 'end',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <Small mobile={mobile}>{(home.name || '').toUpperCase()}</Small>
          <Digit size={scoreSize} testId="led-score-home">{board.home.scoreLabel}</Digit>
        </Box>
        {!mobile && (
          // The middle column stays so the grid keeps its three tracks; the
          // WIN row inside it renders only once the Matchup has started.
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pb: '4px' }}>
            {showWin && (
              <Box
                aria-hidden="true"
                data-testid="led-win"
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}
              >
                <Small mobile={mobile}>WIN</Small>
                <WinRow percents={percents} mobile={mobile} />
              </Box>
            )}
          </Box>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, alignItems: 'flex-end', textAlign: 'right' }}>
          <Small mobile={mobile} align="right">{(away.name || '').toUpperCase()}</Small>
          <Digit size={scoreSize} testId="led-score-away">{board.away.scoreLabel}</Digit>
        </Box>
      </Box>

      {mobile && showWin && (
        <Box
          aria-hidden="true"
          data-testid="led-win"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', mt: '10px' }}
        >
          <Small mobile={mobile}>WIN</Small>
          <WinRow percents={percents} mobile={mobile} />
        </Box>
      )}

      {result ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: vGap }}>
          <Small
            mobile={mobile}
            align="center"
            sx={{ textTransform: 'uppercase', whiteSpace: 'normal', fontSize: mobile ? '10px' : '14px', opacity: 1 }}
          >
            <span data-testid="led-result">{result}</span>
          </Small>
        </Box>
      ) : (
        <>
          <Box aria-hidden="true" sx={{ height: '1px', backgroundColor: 'var(--dash-led-dim)', my: vGap }} />

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
            {figures.map((f) => (
              <Box key={f.key} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: f.align, minWidth: 0 }}>
                <Small mobile={mobile}>{f.label}</Small>
                <Digit size={figureSize} testId={`led-${f.key}`}>{f.value}</Digit>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
