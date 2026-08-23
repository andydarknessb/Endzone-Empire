import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import TeamAvatar from '../common/TeamAvatar';
import { usePickemStandings } from '../../hooks/usePickemStandings';
import { teamNameLabel, teamRowKey } from '../../lib/teamIdentity';

/**
 * Season Pick'em leaderboard, computed on read by the server. Same table
 * treatment as the league dashboard's standings so the two read as one thing.
 * When the page passes the currently-selected `week`, a per-week points column
 * sits beside the season total. The rows come through the shared
 * usePickemStandings cache, so the dashboard and the Pick'em page one click
 * later cost the server one computation, not two.
 *
 * Participants are Teams here, not accounts (#114, parent #108): the table
 * shows `teamName` and marks the viewer's own row by comparing `teamId`
 * against the `viewerTeamId` at the root of the response. A REST response is
 * a per-viewer channel, so that field can be trusted to be about this reader;
 * without it nobody is marked, rather than guessing from an account.
 */
export default function PickemStandings({ leagueId, season, week }) {
  const { data, error, refetch } = usePickemStandings(leagueId, season);

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={refetch}>
            Retry standings
          </Button>
        }
      >
        Unable to load Pick&apos;em standings: {error}
      </Alert>
    );
  }
  if (!data) return <Skeleton variant="rounded" height={280} />;

  const confidence = data.mode === 'confidence';
  const viewerTeamId = data.viewerTeamId ?? null;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {`${data.season} season · `}
        {confidence ? 'confidence points' : 'one point per correct pick'}
        {'. A tied game credits nobody.'}
      </Typography>
      <TableContainer component={Paper} sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow
              sx={{
                bgcolor: 'background.default',
                '& .MuiTableCell-root': {
                  color: 'text.primary',
                  fontWeight: 700,
                  borderBottom: '2px solid',
                  borderBottomColor: 'divider',
                },
              }}
            >
              <TableCell>Rank</TableCell>
              <TableCell>Team</TableCell>
              {week != null && <TableCell align="right">{`Wk ${week}`}</TableCell>}
              <TableCell align="right">Points</TableCell>
              <TableCell align="right">Correct</TableCell>
              <TableCell align="right">Missed</TableCell>
              <TableCell align="right">Pending</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.standings.map((row, index) => {
              const isViewer = viewerTeamId != null && row.teamId === viewerTeamId;
              const name = teamNameLabel(row.teamName);
              // One value keys the row and addresses it, so a departed
              // manager's row is not `former-0` in one place and `null` in
              // the other.
              const rowKey = teamRowKey(row.teamId, index);
              return (
                <TableRow
                  key={rowKey}
                  data-testid={`pickem-standings-row-${rowKey}`}
                  data-viewer-team={isViewer || undefined}
                  sx={{
                    ...(isViewer && {
                      bgcolor: 'var(--accent-soft)',
                      borderLeft: '3px solid',
                      borderLeftColor: 'primary.main',
                    }),
                  }}
                >
                  <TableCell>{row.rank}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TeamAvatar
                        name={name}
                        avatarUrl={row.avatarUrl}
                        avatarStaticUrl={row.avatarStaticUrl}
                        size={28}
                      />
                      <Typography variant="body2">{name}</Typography>
                      {isViewer && <Chip size="small" label="You" />}
                    </Box>
                  </TableCell>
                  {week != null && (
                    <TableCell align="right">{(row.weekly && row.weekly[week]) || 0}</TableCell>
                  )}
                  <TableCell align="right">
                    <Chip size="small" label={row.points} />
                  </TableCell>
                  <TableCell align="right">{row.correct}</TableCell>
                  <TableCell align="right">{row.incorrect}</TableCell>
                  <TableCell align="right">{row.pending}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
