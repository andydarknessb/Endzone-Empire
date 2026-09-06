import React from 'react';
import { visuallyHidden } from '@mui/utils';
import Badge from './Badge';

/**
 * A player's injury designation beside his name: the wire's code (Q, D, O or
 * IR, the four `players.injury_status` values the server names in
 * irPolicy.service.js) on a Badge, the two "may not play" codes on the
 * `warning` tint and the two "will not play" codes on the `danger` tint. It
 * renders nothing for a healthy player (null, an empty string, or a code the
 * wire does not speak), so a composing row never shows a guessed flag.
 *
 * The visible text is the code alone (the legacy InjuryBadge's label, which
 * the Matchup Detail suite read as the badge); the full designation is the
 * accessible text ("Injury status: Questionable"), so a screen reader hears
 * the word and not a letter, and it is announced ONCE: the tag carries no
 * `title`, since a title doubles as the element's accessible description and
 * would repeat the designation (#903 review). The code is exposed as a stable
 * `data-status` so a test can assert which designation rendered without
 * reading styles.
 *
 * Part of `shared/ui` (ADR 0020): the slot-comparison widget's starter cell,
 * the retro-scoreboard widget's Lineups card and the Matchup page's Bench card
 * all compose it (#903), so it sits where all three can reach it. Colors come
 * only from `--dash-*` tokens through Badge; the danger tint is guarded over a
 * card only (tokens.contrast.test.js), so the tag belongs on `dash-surface`.
 */
const DESIGNATIONS = {
  Q: { name: 'Questionable', variant: 'warning' },
  D: { name: 'Doubtful', variant: 'warning' },
  O: { name: 'Out', variant: 'danger' },
  IR: { name: 'Injured reserve', variant: 'danger' },
};

/**
 * The view of an injury designation: its code, its name and the Badge variant
 * it paints, or null for a healthy player or an unknown code.
 */
export function injuryView(status) {
  const code = String(status || '').trim().toUpperCase();
  const designation = DESIGNATIONS[code];
  return designation ? { code, ...designation } : null;
}

export default function InjuryTag({
  status,
  sx,
  'data-testid': testId = 'injury-tag',
  ...rest
}) {
  const view = injuryView(status);
  if (!view) return null;
  return (
    <Badge
      variant={view.variant}
      data-testid={testId}
      data-status={view.code}
      sx={{
        fontSize: '10px',
        lineHeight: 1.2,
        flex: 'none',
        '& .MuiChip-label': { px: 0.75, py: 0.25 },
        ...sx,
      }}
      {...rest}
    >
      <span aria-hidden="true">{view.code}</span>
      <span style={visuallyHidden}>{`Injury status: ${view.name}`}</span>
    </Badge>
  );
}
