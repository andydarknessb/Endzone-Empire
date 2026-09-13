import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { statLine } from '../../../shared/ui';
import { formatPoints } from '../../../shared/lib';

/**
 * The Decision card's game log (`log.current`,
 * `server/services/playerCard.service.js`: this season's played weeks,
 * restated from `buildPlayerSummary`, the same producer `PlayerQuickView`'s
 * current-season table already reads). `statLine` on each row is the raw
 * `player_stats` object; `shared/ui`'s `statLine()` formatter turns it into
 * the same comma-joined text PlayerQuickView shows. Hidden entirely when
 * there is no current-season game to show (ADR 0040's null-hides-the-tile
 * rule).
 */
export default function GameLogTable({ log }) {
  const rows = Array.isArray(log?.current) ? log.current : [];
  if (rows.length === 0) return null;
  return (
    <Table size="small" aria-label="Game log" data-testid="decision-card-game-log">
      <TableHead>
        <TableRow>
          <TableCell>Week</TableCell>
          <TableCell>Opponent</TableCell>
          <TableCell>Stat line</TableCell>
          <TableCell align="right">FPTS</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.week}>
            <TableCell>{`Wk ${row.week}`}</TableCell>
            <TableCell>{row.opponent || '-'}</TableCell>
            <TableCell>{statLine(row.statLine)}</TableCell>
            <TableCell align="right">{formatPoints(row.points)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
