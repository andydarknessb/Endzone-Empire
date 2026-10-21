import React from 'react';
import { Box } from '@mui/material';

// The base column count every consumer's desktop table shares: Player, Proj
// Wk, ROS, Ownership, Weeks, Status, Action - Upgrade adds one more, hidden
// outright in a best ball league rather than shown null (#1310, ADR 0040
// Lead correction item 5). One place derives this rather than a hand-copied
// literal at each consumer's empty-state colSpan (#1310 formal review f2:
// WaiverWire's own table adopting this same column set is exactly the
// second consumer this shared header and column count exist for).
export function playerRowColumnCount(bestBall, hideOwnership = false) {
  return (bestBall ? 7 : 8) - (hideOwnership ? 1 : 0);
}

/**
 * The desktop table header row every `player-row` `variant="row"` consumer shares (#1310):
 * PlayerManagement and WaiverWire's on-waivers table both render this instead of a hand-copied
 * header, so the two tables' columns cannot drift out of step with what PlayerRow itself renders
 * per row. `hideOwnership` drops the Ownership column while no row carries a share yet (#1308).
 *
 * Play-select: fixed column widths (the table is `table-layout: fixed`), the Player column sticky,
 * labels in 13px Dim caps. A column the row omits (Ownership, Upgrade) is omitted here too, so the
 * two cannot drift.
 */
export default function PlayerRowTableHead({ bestBall = false, currentWeek, hideOwnership = false }) {
  const columns = [
    ['Player', 'left', 198],
    [currentWeek != null ? `Proj Wk ${currentWeek}` : 'Proj Wk', 'right', 88],
    ['ROS', 'right', 58],
    ...(hideOwnership ? [] : [['Ownership', 'right', 96]]),
    ...(bestBall ? [] : [['Upgrade', 'right', 96]]),
    [currentWeek != null ? `Weeks ${currentWeek} to 18` : 'Weeks', 'left', 118],
    ['Status', 'left', 122],
    ['Action', 'right', 172],
  ];
  return (
    <tr>
      {columns.map(([label, align, width], i) => (
        <Box
          key={label}
          component="th"
          scope="col"
          sx={{
            ...(i === 0 ? { position: 'sticky', left: 0, zIndex: 1 } : null),
            boxSizing: 'border-box',
            width: `${width}px`,
            height: '40px',
            padding: '0 8px',
            textAlign: align,
            backgroundColor: 'var(--ps-panel)',
            borderBottom: '2px solid var(--ps-rule)',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '.02em',
            textTransform: 'uppercase',
            color: 'var(--ps-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
      ))}
    </tr>
  );
}
