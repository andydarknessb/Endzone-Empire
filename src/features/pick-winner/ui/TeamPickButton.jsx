import React from 'react';
import { Box, Typography } from '@mui/material';
import { getTeamKit } from '../../../lib/nflTeamColors';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { getTeamName } from '../lib/teamNames';

/**
 * pick-winner feature (#1265, ADR 0038 "What to build"): one team's row on a
 * Pick'em GameCard - the monogram, abbreviation, full name, the venue-cut
 * Record (CONTEXT.md: entities/pickem-game's `recordsDisplayModel` already
 * picked the one number that informs this pick), the FAV tag, and the
 * team's own trailing figure, which the caller supplies rather than this
 * component inferring: a radio dot before kickoff, a live/final score once
 * one exists (`score`). `won` borders a settled winner even when it was not
 * the manager's pick; `dim` fades a settled loser regardless of whether it
 * was picked - both are the caller's own settled-game facts, never derived
 * here from `score` or `picked`.
 *
 * A real `<button>` for every state, per the acceptance criteria: its
 * accessible name NAMES the team (the full name, falling back to the Team
 * code when no full name is known), never the bare two-or-three letter code
 * alone, and it never drops below the 44px touch target at `xs`, matching
 * the canvas's 64px-tall team row at every width.
 *
 * `aria-label` makes this button's whole subtree presentational to
 * assistive tech (ARIA's name computation short-circuits on an explicit
 * label), so the record and the live/final score - text that exists
 * NOWHERE else on the card once a game is live or final (accessibility
 * risk review, #1265) - would otherwise be lost to a screen reader
 * entirely. The accessible name is composed instead of a bare team name:
 * the team always leads it (satisfying "an aria-label naming the team"),
 * with the record and the score appended only when each is actually
 * present, so a pre-lock card without either still reads as plain as
 * "Detroit Lions".
 *
 * The monogram fill is this repo's own NFL team color table
 * (`src/lib/nflTeamColors.js`, the color-literals guard's one allowlisted
 * source of real team hex values) rather than a wire field: the week
 * endpoint carries no per-team color (ADR 0038's "Team marks are
 * team-colour monograms, not hotlinked logos" names the mark, not its
 * source), and this table is already the below-island edge three other
 * island widgets (lineup-ledger, player-decision-card, retro-scoreboard)
 * compose directly for the same reason.
 */
export default function TeamPickButton({
  team,
  fullName = null,
  record = null,
  favorite = false,
  picked = false,
  won = false,
  dim = false,
  disabled = false,
  score = null,
  scoreLost = false,
  possession = false,
  onSelect,
  'data-testid': testId,
}) {
  const resolvedFullName = fullName || getTeamName(team);
  const hasScore = score != null;
  const kit = getTeamKit(team);

  // The team always leads (an aria-label naming the team), with the record
  // and the score - each otherwise invisible to assistive tech once this
  // button's own aria-label takes over its subtree - appended only when
  // present.
  const labelParts = [resolvedFullName || team];
  if (record) labelParts.push(record);
  if (hasScore) labelParts.push(`${score} points`);
  const label = labelParts.join(', ');

  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      aria-pressed={picked}
      disabled={disabled}
      data-testid={testId || `team-pick-${team}`}
      data-picked={picked || undefined}
      data-won={won || undefined}
      onClick={() => onSelect?.(team)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        ...MIN_TOUCH_TARGET_SX,
        minHeight: 64,
        width: '100%',
        p: '8px 10px',
        border: '1px solid',
        borderColor: picked ? 'var(--dash-accent)' : won ? 'var(--dash-away)' : 'var(--dash-line-strong)',
        borderRadius: '10px',
        backgroundColor: picked ? 'var(--dash-accent-soft)' : 'var(--dash-surface)',
        boxShadow: picked ? 'inset 0 0 0 1px var(--dash-accent)' : 'none',
        opacity: dim ? 0.7 : 1,
        font: 'inherit',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          flex: 'none',
          width: 36,
          height: 36,
          borderRadius: '999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--dash-font-display)',
          fontWeight: 700,
          fontSize: '14px',
          letterSpacing: '0.04em',
          // 'common.white' is an MUI theme palette reference (the guard's own
          // docblock: "used via the MUI theme... or palette references"),
          // never a raw literal, and unlike a `--dash-*` token it stays fixed
          // regardless of light/dark mode - which is what a monogram needs,
          // since its fill is a real external NFL color (kit.jersey), not a
          // themed one.
          color: 'common.white',
          border: '1px solid var(--dash-line-strong)',
          backgroundColor: kit.jersey,
        }}
      >
        {team}
      </Box>

      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography
          component="span"
          sx={{
            fontFamily: 'var(--dash-font-display)',
            fontWeight: 700,
            fontSize: '18px',
            letterSpacing: '0.06em',
            lineHeight: 1,
            color: 'var(--dash-ink)',
          }}
        >
          {team}
          {favorite && (
            <Box
              component="span"
              data-testid="fav-tag"
              sx={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--dash-home)',
                backgroundColor: 'var(--dash-home-soft)',
                borderRadius: '4px',
                padding: '2px 4px',
                ml: '6px',
                verticalAlign: 'middle',
              }}
            >
              FAV
            </Box>
          )}
          {possession && (
            <Box
              component="span"
              aria-hidden="true"
              data-testid="possession-dot"
              sx={{
                width: 8,
                height: 8,
                borderRadius: '999px',
                backgroundColor: 'var(--dash-warning)',
                display: 'inline-block',
                ml: '6px',
                verticalAlign: 'middle',
              }}
            />
          )}
        </Typography>
        {resolvedFullName && (
          <Typography
            component="span"
            sx={{
              fontSize: '12px',
              color: 'var(--dash-dim)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {resolvedFullName}
          </Typography>
        )}
        {record && (
          <Typography
            component="span"
            sx={{ fontSize: '11px', color: 'var(--dash-faint)', fontVariantNumeric: 'tabular-nums' }}
          >
            {record}
          </Typography>
        )}
      </Box>

      {hasScore ? (
        <Typography
          component="span"
          data-testid="team-score"
          sx={{
            fontFamily: 'var(--dash-font-display)',
            fontWeight: 700,
            fontSize: '26px',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            color: scoreLost ? 'var(--dash-faint)' : 'var(--dash-ink)',
          }}
        >
          {score}
        </Typography>
      ) : (
        <Box
          aria-hidden="true"
          data-testid="team-radio"
          sx={{
            flex: 'none',
            width: 18,
            height: 18,
            borderRadius: '999px',
            border: '2px solid',
            borderColor: picked ? 'var(--dash-accent)' : 'var(--dash-line-strong)',
            backgroundColor: picked ? 'var(--dash-accent)' : 'transparent',
            boxShadow: picked ? 'inset 0 0 0 3px var(--dash-surface)' : 'none',
          }}
        />
      )}
    </Box>
  );
}
