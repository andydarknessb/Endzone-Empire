import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatPoints } from '../../../shared/lib';

/**
 * The eighteen-week bars (#1307, ADR 0040: "Every context adds ... the
 * eighteen-week bars"). One column per `weeks[]` entry
 * (`server/services/playerCard.service.js` `buildWeeklyBars`, ADR 0040-0042):
 * `actual` and `projected` columns are filled bars in the two hues the app
 * already carries for "happened" vs "estimated" (`success`, `accent`),
 * `bye` is a dashed, unfilled column, and `unavailable` shows its `reason`
 * text instead of a bar - never a fabricated number (ADR 0040: "Unavailable
 * players show the reason, never a number"). `currentWeek`'s column carries
 * the accessible current marker (`aria-current` plus a visible pill, the
 * `success`-on-`accent-soft` pairing tokens.contrast.test.js now certifies);
 * `seasonEnd` (ADR 0042's last playoff week) is marked with a dashed
 * divider rather than folded into the bar itself. Each column also carries
 * an HTML `title` (the issue's "per-bar title") so a mouse hover states the
 * week in full, alongside the same text as its accessible name.
 *
 * `null`/empty `weeks` renders nothing (ADR 0040's null-hides-the-tile
 * rule) rather than eighteen empty columns.
 */
export default function WeeklyPointsBars({ weeks, currentWeek, seasonEnd }) {
  if (!Array.isArray(weeks) || weeks.length === 0) return null;

  const maxPoints = Math.max(
    1,
    ...weeks.map((week) => (typeof week.points === 'number' ? week.points : 0))
  );

  return (
    <Box
      data-testid="weekly-points-bars"
      role="list"
      aria-label="Weekly points, actual and projected"
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 0.75,
        px: 2,
        py: 1.5,
        overflowX: 'auto',
      }}
    >
      {weeks.map((week) => (
        <WeekBar
          key={week.week}
          week={week}
          maxPoints={maxPoints}
          isCurrent={currentWeek != null && week.week === currentWeek}
          isSeasonEnd={seasonEnd != null && week.week === seasonEnd}
        />
      ))}
    </Box>
  );
}

function weekTitle(week) {
  const opponent = week.opponent ? ` vs ${week.opponent}` : '';
  if (week.kind === 'bye') return `Week ${week.week}: bye`;
  if (week.kind === 'unavailable') return `Week ${week.week}${opponent}: ${week.reason}`;
  const points = week.points != null ? formatPoints(week.points) : 'no number';
  const label = week.kind === 'projected' ? `${points} projected` : points;
  return `Week ${week.week}${opponent}: ${label}`;
}

function WeekBar({ week, maxPoints, isCurrent, isSeasonEnd }) {
  const title = weekTitle(week);
  return (
    <Box
      role="listitem"
      title={title}
      aria-label={title}
      aria-current={isCurrent ? 'true' : undefined}
      data-testid={`weekly-bar-${week.week}`}
      data-kind={week.kind}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.375,
        minWidth: 14,
        flex: 'none',
        borderRight: isSeasonEnd ? '2px dashed var(--border-strong)' : 'none',
        pr: isSeasonEnd ? 0.75 : 0,
      }}
    >
      {week.kind === 'bye' && (
        <Box
          data-testid={`weekly-bar-${week.week}-bye`}
          sx={{
            width: 10,
            height: 24,
            border: '1px dashed var(--text-muted)',
            borderRadius: 0.5,
          }}
        />
      )}
      {week.kind === 'unavailable' && (
        <Typography
          data-testid={`weekly-bar-${week.week}-reason`}
          sx={{ fontSize: 9, fontWeight: 700, color: 'var(--warning)', textAlign: 'center', lineHeight: 1.1 }}
        >
          {week.reason}
        </Typography>
      )}
      {(week.kind === 'actual' || week.kind === 'projected') && (
        <Box
          data-testid={`weekly-bar-${week.week}-fill`}
          sx={{
            width: 10,
            height: Math.max(2, Math.round(((Number(week.points) || 0) / maxPoints) * 40)),
            bgcolor: week.kind === 'actual' ? 'var(--success)' : 'var(--accent)',
            opacity: week.kind === 'projected' ? 0.55 : 1,
            borderRadius: 0.5,
          }}
        />
      )}
      {isCurrent && (
        <Box
          data-testid={`weekly-bar-${week.week}-current`}
          sx={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            color: 'var(--success)',
            bgcolor: 'var(--accent-soft)',
            borderRadius: 'var(--radius-pill)',
            px: 0.5,
          }}
        >
          Current
        </Box>
      )}
      <Typography sx={{ fontSize: 9, color: 'var(--text-muted)' }}>{week.week}</Typography>
    </Box>
  );
}
