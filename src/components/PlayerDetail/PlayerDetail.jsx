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
  Chip,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import InjuryBadge from '../InjuryBadge/InjuryBadge';

const STAT_LABELS = {
  passingYards: 'Pass Yds',
  passingTDs: 'Pass TD',
  interceptions: 'INT',
  rushingYards: 'Rush Yds',
  rushingTDs: 'Rush TD',
  receivingYards: 'Rec Yds',
  receivingTDs: 'Rec TD',
  receptions: 'Rec',
  fumbles: 'Fum',
};

function statLine(stats) {
  const parts = Object.entries(stats || {})
    .filter(([key, value]) => STAT_LABELS[key] && Number(value) !== 0)
    .map(([key, value]) => `${value} ${STAT_LABELS[key]}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function PlayerDetail() {
  const { playerId } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiClient.get(`/api/players/${playerId}`);
        setDetail(res.data);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [playerId]);

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !detail) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">{error || 'Player not available'}</Alert>
      </Container>
    );
  }

  const { player, weekly, seasonTotals } = detail;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h4">{player.name}</Typography>
        <Chip label={player.position} color="primary" />
        <Chip label={player.nfl_team || 'Free Agent'} />
        <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
      </Box>
      {player.news && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {player.news}
        </Alert>
      )}

      {seasonTotals ? (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {seasonTotals.season} Season
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Chip label={`Games: ${seasonTotals.games}`} />
            <Chip label={`Fantasy Points: ${seasonTotals.points}`} color="success" />
            {seasonTotals.projectedPoints !== null && (
              <Chip label={`Projected: ${seasonTotals.projectedPoints}/wk`} color="info" />
            )}
          </Box>
        </Paper>
      ) : (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography sx={{ color: 'text.secondary' }}>No stats synced yet</Typography>
        </Paper>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Weekly Stats
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Season</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Week</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Stat Line</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                Fantasy Pts
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {weekly.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>
                  No weekly stats yet
                </TableCell>
              </TableRow>
            ) : (
              weekly.map((row) => (
                <TableRow key={`${row.season}-${row.week}`}>
                  <TableCell>{row.season}</TableCell>
                  <TableCell>{row.week}</TableCell>
                  <TableCell>{statLine(row.stats)}</TableCell>
                  <TableCell align="right">{row.fantasy_points}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}

export default PlayerDetail;
