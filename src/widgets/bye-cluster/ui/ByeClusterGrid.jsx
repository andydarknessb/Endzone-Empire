import React from 'react';
import { Box } from '@mui/material';
import { Frame, FrameHead, PixelHeading } from '../../../shared/ui/playselect';
import { SrOnly } from '../../../shared/ui/playselect/LineupParts';
import { positionLabel } from '../../../shared/ui/PosChip';
import { computeByeClusters, worstByeCluster } from '../../../shared/lib';
import { worstClusterLine } from '../lib/byeClusterCopy';
import { useWaiversClearAt } from '../model/useWaiversClearAt';

// The tile per severity (RULINGS "Wave 3 boards"): a warning is the filled Ink tile, a notable cluster a 2px
// Ink edge, a quiet week a Rule edge in Dim. Never red or amber.
const SEVERITY_SX = {
  quiet: { border: '2px solid var(--ps-rule)', color: 'var(--ps-dim)' },
  notable: { border: '2px solid var(--ps-ink)' },
  warning: { border: '2px solid var(--ps-ink)', backgroundColor: 'var(--ps-ink)', color: 'var(--ps-panel)' },
};
const SEVERITY_WORD = { notable: 'notable', warning: 'warning' };

/**
 * The Lineup rail's Bye cluster grid (#1239, ADR 0037, CONTEXT.md's Bye
 * cluster): one tile per week for the seven weeks after the page's own
 * selected week, each showing the count of rostered players (IR excluded)
 * on bye that week and their positions - two tiles styled notable, three or
 * more a warning - and a line under the grid naming the players in the
 * worst cluster and when waivers clear, absent when no week reaches two.
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
 *
 * Waivers clear time (spec #2347 ruling 4): given a `leagueId`, the naming line reads the league's
 * `waivers_clear_at` from `GET /api/waivers` (the Waivers page's own read) and, when a blanket clear is
 * still to come, says "Waivers clear {weekday time}." That read is made only while a naming line renders,
 * so a week with no cluster of two, a past week and a caller that passes no `leagueId` (the Waivers page)
 * make none.
 */
export default function ByeClusterGrid({ entries, fromWeek, isPastWeek, waiverPeriodHours, leagueId = null }) {
  if (isPastWeek || fromWeek == null) return null;

  const clusters = computeByeClusters({ entries, fromWeek });
  const worst = worstByeCluster(clusters);

  return (
    <Frame
      tier="rule"
      labelledBy="bye-cluster-h"
      data-testid="bye-cluster-grid"
      head={(
        <FrameHead>
          <PixelHeading id="bye-cluster-h" size={16}>Bye clusters</PixelHeading>
          <Box component="span" sx={{ ml: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>
            {`Wk ${clusters[0].week} to ${clusters[clusters.length - 1].week}`}
          </Box>
        </FrameHead>
      )}
    >
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: { xs: '12px 14px 8px', md: '14px 16px 8px' },
          display: 'grid',
          gridTemplateColumns: `repeat(${clusters.length}, minmax(0, 1fr))`,
          gap: '4px',
        }}
      >
        {clusters.map((cluster) => (
          <Box
            component="li"
            key={cluster.week}
            data-testid="bye-cluster-tile"
            data-week={cluster.week}
            data-severity={cluster.severity}
            sx={{
              ...SEVERITY_SX[cluster.severity],
              boxSizing: 'border-box',
              minHeight: '72px',
              p: '8px 2px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              minWidth: 0,
            }}
          >
            <Box component="span" sx={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{`Wk ${cluster.week}`}</Box>
            <Box component="span" sx={{ fontSize: '18px', fontWeight: 700, lineHeight: 1 }}>
              {cluster.count}
              <SrOnly>{` on bye${SEVERITY_WORD[cluster.severity] ? `, ${SEVERITY_WORD[cluster.severity]}` : ''}`}</SrOnly>
            </Box>
            {cluster.players.length > 0 && (
              <Box component="span" aria-hidden="true" sx={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>
                {cluster.players.map((player) => positionLabel(player.position)).join(' ')}
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {worst && <ClusterLine worst={worst} waiverPeriodHours={waiverPeriodHours} leagueId={leagueId} />}
    </Frame>
  );
}

// The naming line, its own component so the waivers read it needs mounts only when the line does.
function ClusterLine({ worst, waiverPeriodHours, leagueId }) {
  const waiversClearAt = useWaiversClearAt(leagueId);
  const line = worstClusterLine({ worst, waiverPeriodHours, waiversClearAt });
  return (
    <Box component="p" data-testid="bye-cluster-line" sx={{ m: 0, p: { xs: '4px 14px 14px', md: '4px 16px 14px' }, fontSize: '14px', textWrap: 'pretty' }}>
      {line}
    </Box>
  );
}
