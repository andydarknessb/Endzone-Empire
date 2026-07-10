import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  Button,
  Chip,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material';
import apiClient from '../../api/apiClient';

function LeagueDashboard() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    fetchLeagueAndUser();
  }, [leagueId]);

  const fetchLeagueAndUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const leagueRes = await apiClient.get(`/api/league/${leagueId}`);
      setLeague(leagueRes.data.league);
      setTeams(leagueRes.data.teams);

      const userRes = await apiClient.get('/api/user');
      setUser(userRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartDraft = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/league/${leagueId}/start-draft`);
      setSuccessMessage('Draft started successfully!');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleCopyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(league.invite_code);
      setSuccessMessage('Invite code copied to clipboard!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Failed to copy invite code');
    }
  };

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!league || !user) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">League or user data not available</Alert>
      </Container>
    );
  }

  const isOwner = user.id === league.owner_id;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h4">{league.name}</Typography>
        <Chip
          label={league.draft_status}
          color={
            league.draft_status === 'complete'
              ? 'success'
              : league.draft_status === 'active'
              ? 'warning'
              : 'default'
          }
        />
        <Chip label={`Roster Limit: ${league.roster_limit}`} />
        <Chip label={`Teams: ${teams.length}/${league.max_teams}`} />
      </Box>

      {league.invite_code && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.100' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body1">
              <strong>Invite code:</strong> {league.invite_code}
            </Typography>
            <Button variant="outlined" size="small" onClick={handleCopyInviteCode}>
              Copy
            </Button>
          </Box>
        </Paper>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Standings
      </Typography>
      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Rank</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Team</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Owner</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                Roster
              </TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                Points
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {teams.map((team, index) => (
              <TableRow key={team.id}>
                <TableCell>{index + 1}</TableCell>
                <TableCell>{team.name}</TableCell>
                <TableCell>{team.owner}</TableCell>
                <TableCell align="right">{team.roster_count}</TableCell>
                <TableCell align="right">{team.total_points}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', gap: 2 }}>
        {isOwner && league.draft_status === 'pending' && (
          <Button variant="contained" color="primary" onClick={handleStartDraft}>
            Start Draft
          </Button>
        )}
        <Link to={`/league/${leagueId}/draft`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Draft Room
          </Button>
        </Link>
        <Link to={`/league/${leagueId}/matchups`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Matchups
          </Button>
        </Link>
      </Box>
    </Container>
  );
}

export default LeagueDashboard;
