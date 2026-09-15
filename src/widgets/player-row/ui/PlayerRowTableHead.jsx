import React from 'react';
import { TableCell, TableRow, TableSortLabel } from '@mui/material';

// The base column count every consumer's desktop table shares: Player, Proj
// Wk, ROS, Ownership, Weeks, Status, Action - Upgrade adds one more, hidden
// outright in a best ball league rather than shown null (#1310, ADR 0040
// Lead correction item 5). One place derives this rather than a hand-copied
// literal at each consumer's empty-state colSpan (#1310 formal review f2:
// WaiverWire's own table adopting this same column set is exactly the
// second consumer this shared header and column count exist for).
export function playerRowColumnCount(bestBall) {
  return bestBall ? 7 : 8;
}

/**
 * The desktop table header row every `player-row` `variant="row"` consumer
 * shares (#1310): PlayerManagement and WaiverWire's on-waivers table both
 * render this instead of a hand-copied header, so the two tables' columns
 * cannot drift out of step with what PlayerRow itself renders per row.
 *
 * `upgradeSort` is optional: PlayerManagement has no per-column sort (its
 * Sort dropdown covers it) and omits it, rendering plain text; WaiverWire
 * keeps its own click-to-toggle Upgrade header and passes
 * `{ active, direction, onClick }` to render a `TableSortLabel` instead.
 */
export default function PlayerRowTableHead({ bestBall = false, currentWeek, sx, upgradeSort }) {
  return (
    <TableRow>
      <TableCell sx={sx}>Player</TableCell>
      <TableCell sx={sx} align="right">
        {currentWeek != null ? `Proj Wk ${currentWeek}` : 'Proj Wk'}
      </TableCell>
      <TableCell sx={sx} align="right">
        ROS
      </TableCell>
      <TableCell sx={sx} align="right">
        Ownership
      </TableCell>
      {!bestBall && (
        <TableCell sx={sx} align="right">
          {upgradeSort ? (
            <TableSortLabel
              active={upgradeSort.active}
              direction={upgradeSort.direction}
              onClick={upgradeSort.onClick}
            >
              Upgrade
            </TableSortLabel>
          ) : (
            'Upgrade'
          )}
        </TableCell>
      )}
      <TableCell sx={sx}>{currentWeek != null ? `Weeks ${currentWeek} to 18` : 'Weeks'}</TableCell>
      <TableCell sx={sx}>Status</TableCell>
      <TableCell sx={sx} align="right">
        Action
      </TableCell>
    </TableRow>
  );
}
