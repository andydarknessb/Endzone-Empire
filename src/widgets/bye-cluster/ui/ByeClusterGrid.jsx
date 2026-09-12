import React from 'react';
import { Box, Typography } from '@mui/material';
import { Card, PosChip } from '../../../shared/ui';
import { computeByeClusters, worstByeCluster } from '../../../lib/byeClusters';
import { worstClusterLine } from '../lib/byeClusterCopy';

// The tile's border/fill/text tokens per severity - the exact `dash-warning`/
// `dash-danger` on `-soft` pairings Badge's own `warning`/`danger` variants
// already use (tokens.contrast.test.js), reused rather than inventing an
// unguarded pairing. `quiet` matches StatTile's own resting look.
const SEVERITY_SX = {
  quiet: { borderColor: 'var(--dash-line)', backgroundColor: 'var(--dash-surface2)' },
  notable: { borderColor: 'var(--dash-warning)', backgroundColor: 'var(--dash-warning-soft)' },
  warning: { borderColor: 'var(--dash-danger)', backgroundColor: 'var(--dash-danger-soft)' },
};
const SEVERITY_COUNT_COLOR = {
  quiet: 'var(--dash-ink)',
  notable: 'var(--dash-warning)',
  warning: 'var(--dash-danger)',
};

/**
 * The Lineup rail's Bye cluster grid (#1239, ADR 0037, CONTEXT.md's Bye
 * cluster): one tile per week for the seven weeks after the page's own
 * selected week, each showing the count of rostered players (IR excluded)
 * on bye that week and their positions - two tiles styled notable, three or
 * more a warning - and a line under the grid naming the players in the
 * worst cluster and the league's waiver clear period, absent when no week
 * reaches two.
 *
 * Reads only `entities`-shaped props and `shared/ui` (ADR 0020/0029): the
 * page passes down `entries` (`lineup.entries`, already the roster entity's
 * modeled shape - the same "value the page already fetched" rule the other
 * Lineup rail widgets follow) and `fromWeek` (the page's own selected week).
 * The cluster computation itself lives in `src/lib/byeClusters.js`, not
 * here, because the team-summary-strip widget's attention chip needs the
 * SAME worst-cluster answer and a widget may not import another widget's
 * internals - so this widget calls the shared pure computation "client-side
 * from the lineup payload" exactly as the ticket asks, and the page calls
 * the same function again for the chip rather than the two ever disagreeing.
 *
 * Hidden entirely on a past week (AC5: "the week as played has no
 * outlook") - `isPastWeek` is the page's own fact (`lineup.week` against
 * `lineup.currentWeek`), read the same way `StartSitPanel` decides its own
 * `bestBall` visibility rather than the page omitting the widget outright.
 */
export default function ByeClusterGrid({ entries, fromWeek, isPastWeek, waiverPeriodHours }) {
  if (isPastWeek || fromWeek == null) return null;

  const clusters = computeByeClusters({ entries, fromWeek });
  const worst = worstByeCluster(clusters);
  const line = worstClusterLine({ worst, waiverPeriodHours });

  return (
    <Card
      title="Bye clusters"
      tail={`Wk ${clusters[0].week} to ${clusters[clusters.length - 1].week}`}
      data-testid="bye-cluster-grid"
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${clusters.length}, minmax(0, 1fr))`,
          gap: '6px',
          p: '14px 18px 8px',
        }}
      >
        {clusters.map((cluster) => (
          <Box
            key={cluster.week}
            data-testid="bye-cluster-tile"
            data-week={cluster.week}
            data-severity={cluster.severity}
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: '4px',
              p: '8px 4px',
              border: '1px solid',
              borderRadius: 'var(--dash-radius-sm)',
              minHeight: 64,
              ...SEVERITY_SX[cluster.severity],
            }}
          >
            <Typography sx={{ fontSize: '10px', color: 'var(--dash-faint)', whiteSpace: 'nowrap' }}>
              {`Wk ${cluster.week}`}
            </Typography>
            <Typography
              sx={{ fontSize: '20px', fontWeight: 700, lineHeight: 1, color: SEVERITY_COUNT_COLOR[cluster.severity] }}
            >
              {cluster.count}
            </Typography>
            {cluster.players.length > 0 && (
              <Box sx={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {cluster.players.map((player) => (
                  <PosChip
                    key={player.playerId}
                    position={player.position}
                    sx={{ minWidth: 26, height: 16, fontSize: '9px', px: '3px' }}
                  />
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {line && (
        <Typography data-testid="bye-cluster-line" sx={{ px: '18px', pb: '14px', pt: '4px', fontSize: '12px', color: 'var(--dash-faint)' }}>
          {line}
        </Typography>
      )}
    </Card>
  );
}
