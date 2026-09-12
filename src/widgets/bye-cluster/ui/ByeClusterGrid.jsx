import React from 'react';
import { Box, Typography } from '@mui/material';
import { Card, PosChip } from '../../../shared/ui';
import { computeByeClusters, worstByeCluster } from '../../../shared/lib';
import { worstClusterLine } from '../lib/byeClusterCopy';

// The tile's border/fill/text tokens per severity. Every color here is a
// pairing tokens.contrast.test.js already guards: the border/fill use the
// exact `dash-warning`/`dash-danger` on `-soft` pairs Badge's own
// `warning`/`danger` variants use; `quiet` matches StatTile's own resting
// look (the big value in `dash-ink`, its label in `dash-faint`, both over
// `dash-surface2`). At `notable`/`warning`, BOTH the label and the count
// switch to the severity's own solid color (`dash-warning`/`dash-danger`,
// still on the matching `-soft` fill) rather than the label staying
// `dash-faint` on a tint it was never guarded over - `dash-faint` is
// registered only over bg/surface/surface2/surface3/accent-soft
// (tokens.contrast.test.js; formal review finding f3: an earlier version
// painted the label `dash-faint` on the warning/danger tints, a pairing no
// component in this repo used anywhere else).
const SEVERITY_SX = {
  quiet: { borderColor: 'var(--dash-line)', backgroundColor: 'var(--dash-surface2)' },
  notable: { borderColor: 'var(--dash-warning)', backgroundColor: 'var(--dash-warning-soft)' },
  warning: { borderColor: 'var(--dash-danger)', backgroundColor: 'var(--dash-danger-soft)' },
};
const SEVERITY_LABEL_COLOR = {
  quiet: 'var(--dash-faint)',
  notable: 'var(--dash-warning)',
  warning: 'var(--dash-danger)',
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
 * Reads only `entities`-shaped props and `shared/ui`/`shared/lib` (ADR
 * 0020/0029/0031 - no below-island edge to name): the page passes down
 * `entries` (`lineup.entries`, already the roster entity's modeled shape -
 * the same "value the page already fetched" rule the other Lineup rail
 * widgets follow) and `fromWeek` (the page's own selected week). The
 * cluster computation itself (`computeByeClusters`/`worstByeCluster`) is
 * `shared/lib`'s, not this widget's own, because the team-summary-strip
 * widget's attention chip needs the SAME worst-cluster answer and a widget
 * may not import another widget's internals: this widget and the page each
 * call the one shared pure function independently - the page hands ITS OWN
 * answer only to the summary strip (which has no other way to reach it),
 * while this widget, already holding the raw entries, computes its own
 * rather than taking a second prop that would just restate what it can
 * derive itself.
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
            <Typography sx={{ fontSize: '10px', color: SEVERITY_LABEL_COLOR[cluster.severity], whiteSpace: 'nowrap' }}>
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
