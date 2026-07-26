import React from 'react';
import {
  Alert, Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { ROSTER_POSITION_OPTIONS } from '../../lib/leagueRulesFormat';

export default function RosterRulesView({ league }) {
  const slots = league.roster_slots || [];
  const benchSlots = Number(league.bench_slots) || 0;
  const irSlots = Number(league.ir_slots) || 0;
  const starters = slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const totalRosterSize = starters + benchSlots + irSlots;
  const caps = league.position_caps || {};
  const cappedPositions = ROSTER_POSITION_OPTIONS.filter((p) => caps[p] !== undefined && caps[p] !== null);

  return (
    <Stack spacing={4}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${starters} starters`} />
          <Chip size="small" label={`${benchSlots} bench`} />
          <Chip size="small" label={`${irSlots} IR`} />
          <Chip size="small" color="primary" label={`${totalRosterSize} total roster spots`} />
          {league.dp_enabled && <Chip size="small" color="primary" variant="outlined" label="IDP enabled" />}
        </Stack>
        {slots.length === 0 ? (
          <Alert severity="info">No starting lineup slots have been configured yet.</Alert>
        ) : (
          <Table size="small" aria-label="Starting lineup slots" sx={{ maxWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableCell>Slot</TableCell>
                <TableCell align="right">Count</TableCell>
                <TableCell>Eligible positions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {slots.map((slot) => (
                <TableRow key={slot.key}>
                  <TableCell>{slot.label || slot.key}</TableCell>
                  <TableCell align="right">{Number(slot.count) || 0}</TableCell>
                  <TableCell>{(slot.eligiblePositions || []).join(', ') || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Draft position limits</Typography>
        {cappedPositions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No position limits. You can draft any mix of positions.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Limits apply only while drafting; rosters can change freely afterward.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {cappedPositions.map((p) => (
                <Chip key={p} size="small" variant="outlined" label={`${p}: max ${caps[p]}`} />
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Stack>
  );
}
