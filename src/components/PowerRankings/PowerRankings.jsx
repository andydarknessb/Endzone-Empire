import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Box,
  LinearProgress,
} from '@mui/material';
import apiClient from '../../api/apiClient';

function OddsCell({ value }) {
  const pct = Math.round((value || 0) * 1000) / 10;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
      <Box sx={{ flexGrow: 1 }}>
        <LinearProgress variant="determinate" value={Math.min(100, Math.max(0, pct))} />
      </Box>
      <Typography variant="body2" sx={{ minWidth: 42, textAlign: 'right' }}>
        {pct}%
      </Typography>
    </Box>
  );
}

function PowerRankings() {
  const { leagueId } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notComputed, setNotComputed] = useState(false);

  useEffect(() => {
    fetchRankings();
  }, [leagueId]);

  const fetchRankings = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotComputed(false);
      const res = await apiClient.get(`/api/scoring/league/${leagueId}/power-rankings`);
      setPayload(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setNotComputed(true);
        setPayload(null);
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  const rankings = payload?.data?.rankings || [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h4">Power Rankings</Typography>
        {payload && (
          <Typography variant="subtitle1" sx={{ color: 'text.secondary' }}>
            Season {payload.season} · Week {payload.week}
          </Typography>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {notComputed && (
        <Alert severity="info" data-testid="power-rankings-empty">
          Rankings appear after the first scored week
        </Alert>
      )}

      {payload && (
        <>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', mb: 2, display: 'block' }}
          >
            Computed {new Date(payload.data.computedAt).toLocaleString()} · {payload.data.runs}{' '}
            simulation runs
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Rank</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell align="right">Win %</TableCell>
                  <TableCell align="right">Avg Score</TableCell>
                  <TableCell>Playoff Odds</TableCell>
                  <TableCell>Title Odds</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rankings.map((team) => (
                  <TableRow key={team.teamId} data-testid={`power-ranking-row-${team.teamId}`}>
                    <TableCell>{team.rank}</TableCell>
                    <TableCell>{team.name}</TableCell>
                    <TableCell align="right">
                      {Math.round((team.winPct || 0) * 1000) / 10}%
                    </TableCell>
                    <TableCell align="right">{team.avgScore}</TableCell>
                    <TableCell>
                      <OddsCell value={team.playoffOdds} />
                    </TableCell>
                    <TableCell>
                      <OddsCell value={team.titleOdds} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Container>
  );
}

export default PowerRankings;
