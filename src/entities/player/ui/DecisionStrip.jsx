import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatPoints } from '../../../shared/lib';

/**
 * The decision strip (#1307, ADR 0040: "Every context adds the decision
 * strip (Weekly projection for the week, Rest of season, Ownership, depth
 * chart, Upgrade, Usage)"). A CSS grid of small tiles, each reading one
 * field off `decision` (`server/services/playerCard.service.js`
 * `getPlayerCard`); a tile whose source is null or absent renders nothing
 * and the grid reflows around it (ADR 0040's null-hides-the-tile rule) -
 * `ownership` and `depth` ship `null` today (no producer exists yet, ADR
 * 0040's Plan), so only Weekly projection, Rest of season, Upgrade and
 * Usage ever show in this slice.
 *
 * Upgrade is the one tile with a positive-highlight treatment: a beat-the-
 * bench Upgrade renders in a small pill, `success` text on the `accent-soft`
 * tint (tokens.contrast.test.js certifies the pairing). `upgrade: null`
 * (best ball, or the caller's own player, ADR 0040) hides the tile outright
 * rather than showing an empty label (the issue's own acceptance criterion).
 */
export default function DecisionStrip({ decision, usage }) {
  const tiles = [];

  if (decision?.projWeek && decision.projWeek.points != null) {
    tiles.push(
      <Tile key="proj" label={`Week ${decision.projWeek.week} projection`} testId="decision-strip-proj-week">
        {formatPoints(decision.projWeek.points)}
      </Tile>
    );
  }

  if (decision?.ros && decision.ros.points != null) {
    tiles.push(
      <Tile
        key="ros"
        label={decision.ros.throughWeek != null ? `Rest of season (thru Wk ${decision.ros.throughWeek})` : 'Rest of season'}
        testId="decision-strip-ros"
      >
        {formatPoints(decision.ros.points)}
      </Tile>
    );
  }

  if (decision?.upgrade != null && decision.upgrade.points != null) {
    tiles.push(
      <Tile key="upgrade" label="Upgrade" testId="decision-strip-upgrade">
        <Box
          component="span"
          data-testid="decision-strip-upgrade-pill"
          sx={{
            display: 'inline-flex',
            px: 0.75,
            borderRadius: 'var(--radius-pill)',
            bgcolor: 'var(--accent-soft)',
            color: 'var(--success)',
            fontWeight: 700,
          }}
        >
          {decision.upgrade.points >= 0 ? '+' : ''}
          {formatPoints(decision.upgrade.points)}
        </Box>
        {decision.upgrade.slot && (
          <Typography component="span" sx={{ fontSize: 11, color: 'var(--text-muted)', ml: 0.5 }}>
            {`at ${decision.upgrade.slot}`}
          </Typography>
        )}
      </Tile>
    );
  }

  if (usage?.seasonAverage && usage.seasonAverage.fantasyPoints != null) {
    tiles.push(
      <Tile key="usage" label="Usage (season avg)" testId="decision-strip-usage">
        {formatPoints(usage.seasonAverage.fantasyPoints)}
        <Typography component="span" sx={{ fontSize: 11, color: 'var(--text-muted)', ml: 0.5 }}>
          FPTS/gm
        </Typography>
      </Tile>
    );
  }

  if (tiles.length === 0) return null;

  return (
    <Box
      data-testid="decision-strip"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 1,
        px: 2,
        py: 1.5,
      }}
    >
      {tiles}
    </Box>
  );
}

function Tile({ label, testId, children }) {
  return (
    <Box data-testid={testId}>
      <Typography sx={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{children}</Typography>
    </Box>
  );
}
