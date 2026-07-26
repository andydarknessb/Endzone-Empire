import React, { useEffect, useState } from 'react';
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
import apiClient from '../../api/apiClient';
import TeamAvatar from '../common/TeamAvatar';

const errorMessage = (error) =>
  error?.response?.data?.error || error?.message || 'Request failed';

/**
 * Season Pick'em leaderboard, computed on read by the server. Same table
 * treatment as the league dashboard's standings so the two read as one thing.
 * When the page passes the currently-selected `week`, a per-week points column
 * sits beside the season total.
 */
export default function PickemStandings({ leagueId, season, week }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    const query = season ? `?season=${season}` : '';
    apiClient
      .get(`/api/pickem/league/${leagueId}/standings${query}`)
      .then((res) => { if (active) setData(res.data); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)); });
    return () => { active = false; };
  }, [leagueId, season, reload]);

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => setReload((n) => n + 1)}>
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
              <TableCell>Manager</TableCell>
              {week != null && <TableCell align="right">{`Wk ${week}`}</TableCell>}
              <TableCell align="right">Points</TableCell>
              <TableCell align="right">Correct</TableCell>
              <TableCell align="right">Missed</TableCell>
              <TableCell align="right">Pending</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.standings.map((row) => (
              <TableRow key={row.userId}>
                <TableCell>{row.rank}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TeamAvatar
                      name={row.teamName || row.username}
                      avatarUrl={row.avatarUrl}
                      avatarStaticUrl={row.avatarStaticUrl}
                      size={28}
                    />
                    <Box>
                      <Typography variant="body2">{row.teamName || row.username}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.username}
                      </Typography>
                    </Box>
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
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
