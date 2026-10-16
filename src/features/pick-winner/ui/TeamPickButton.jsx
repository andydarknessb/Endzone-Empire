import React from 'react';
import { Box } from '@mui/material';
import { getTeamName } from '../lib/teamNames';
import { PixelCheck, pixelSx } from '../../../shared/ui/playselect';

/**
 * pick-winner feature (ADR 0038, Play-select in ADR 0067 wave 2): one team's button on a Pick'em
 * GameCard, a 44px-plus square button: the abbreviation in Pixel 16 with the FAV tag and a
 * possession dot, the full name, the venue-cut Record, the team's own score once one exists and
 * the pick mark at the right.
 *
 * The pick mark says the state in words, never colour alone. `picked` is a SAVED pick: the Play-blue
 * fill, a pixel check and the word "Pick". `attempt` is a pick that is not saved yet (`state`
 * "saving", "failed", or "draft" while a confidence pick waits for its rank): outlined in Play blue,
 * an empty square and "Pick", no fill and no check, so an unsaved pick never looks saved. A locked
 * game's button is disabled with its name unchanged and no opacity; `won` borders a settled winner
 * in Ink and `lost` dims a settled loser's score, both the caller's facts.
 *
 * The accessible name starts with the visible abbreviation (label in name) and carries every fact
 * the visible subtree does not: "{ABBR}, {Team} over {Opponent}, {day time}{, locks in n min}
 * {, N points}{, has the ball}{, winner}{, saved | saving | not saved, retry}", with `aria-pressed`
 * for a saved pick.
 */
export default function TeamPickButton({
  team,
  opponent = null,
  fullName = null,
  kickoff = null,
  locksIn = null,
  record = null,
  favorite = false,
  picked = false,
  attempt = false,
  state = null,
  won = false,
  lost = false,
  disabled = false,
  score = null,
  possession = false,
  onSelect,
  'data-testid': testId,
}) {
  const name = fullName || getTeamName(team);
  const opponentName = opponent ? getTeamName(opponent) : null;
  const hasScore = score != null;

  const parts = [`${team}, ${name}${opponentName ? ` over ${opponentName}` : ''}`];
  if (kickoff) parts.push(kickoff);
  if (locksIn) parts.push(locksIn);
  if (hasScore) parts.push(`${score} points`);
  if (possession) parts.push('has the ball');
  if (won) parts.push('winner');
  if (picked && state === 'saved') parts.push('saved');
  else if (attempt && state === 'saving') parts.push('saving');
  else if (attempt && state === 'failed') parts.push('not saved, retry');
  const label = parts.join(', ');

  const filled = picked && !attempt;
  const ink = filled ? 'var(--ps-play-ink)' : 'var(--ps-ink)';
  const dim = filled ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  let edge = 'var(--ps-dim)';
  if (won) edge = 'var(--ps-ink)';
  else if (filled || attempt) edge = 'var(--ps-play)';
  else if (disabled) edge = 'var(--ps-rule)';

  let mark = null;
  if (attempt) {
    mark = (
      <>
        <Box component="span" aria-hidden="true" sx={{ width: '16px', height: '16px', boxSizing: 'border-box', border: '2px solid var(--ps-play)', flex: 'none' }} />
        Pick
      </>
    );
  } else if (filled) {
    mark = (
      <>
        <PixelCheck size={16} />
        Pick
      </>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      aria-pressed={filled}
      disabled={disabled}
      data-testid={testId || `team-pick-${team}`}
      data-picked={filled || undefined}
      data-attempt={attempt || undefined}
      data-won={won || undefined}
      onClick={() => onSelect?.(team)}
      sx={{
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        minHeight: { xs: '112px', sm: '76px' },
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: { xs: '4px', sm: '16px' },
        padding: { xs: '10px 12px', sm: '10px 14px' },
        borderRadius: 0,
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: '16px',
        lineHeight: 1.3,
        backgroundColor: filled ? 'var(--ps-play)' : 'var(--ps-panel)',
        color: ink,
        border: `2px solid ${edge}`,
        boxShadow: attempt ? 'inset 0 0 0 2px var(--ps-play)' : 'none',
        cursor: disabled ? 'default' : 'pointer',
        // A disabled button keeps full contrast (no opacity, no UA grey) and no hover lift.
        '&:disabled': { color: ink },
        '&:disabled:hover': { filter: 'none' },
      }}
    >
      <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <Box component="span" sx={{ ...pixelSx(16), lineHeight: 1.2, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          {team}
          {favorite && (
            <Box
              component="span"
              data-testid="fav-tag"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                boxSizing: 'border-box',
                height: '22px',
                padding: '0 6px',
                border: '2px solid currentColor',
                fontFamily: 'Archivo, sans-serif',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '.04em',
                lineHeight: 1,
                flex: 'none',
              }}
            >
              FAV
            </Box>
          )}
          {possession && (
            <Box component="span" aria-hidden="true" data-testid="possession-dot" sx={{ width: '8px', height: '8px', backgroundColor: 'currentColor', flex: 'none' }} />
          )}
        </Box>
        <Box component="span" sx={{ fontSize: '14px', fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Box>
        {record && (
          <Box component="span" sx={{ fontSize: '13px', color: dim, fontVariantNumeric: 'tabular-nums' }}>{record}</Box>
        )}
      </Box>

      <Box
        component="span"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'row', sm: 'row-reverse' },
          alignItems: 'center',
          justifyContent: { xs: 'space-between', sm: 'flex-start' },
          gap: { xs: '8px', sm: '16px' },
          minHeight: { xs: '32px', sm: 0 },
          marginTop: { xs: 'auto', sm: 0 },
          flex: 'none',
        }}
      >
        <Box
          component="span"
          data-testid="team-mark"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: { xs: 'flex-start', sm: 'flex-end' },
            gap: '8px',
            minWidth: { sm: '76px' },
            fontSize: '15px',
            fontWeight: 700,
          }}
        >
          {mark}
          {!mark && !disabled && (
            <Box component="span" aria-hidden="true" sx={{ width: '16px', height: '16px', boxSizing: 'border-box', border: '2px solid var(--ps-dim)', flex: 'none' }} />
          )}
        </Box>
        {hasScore && (
          <Box
            component="span"
            data-testid="team-score"
            sx={{
              ...pixelSx(24),
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
              color: lost ? dim : ink,
            }}
          >
            {score}
          </Box>
        )}
      </Box>
    </Box>
  );
}
