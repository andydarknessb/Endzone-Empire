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
import ChatPanel from '../ChatPanel/ChatPanel';

const SEASON_STATUS_CHIP = {
  regular: { label: 'Regular Season', color: 'default' },
  playoffs: { label: 'Playoffs', color: 'warning' },
  complete: { label: 'Season Complete', color: 'success' },
};

function LeagueDashboard() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [standings, setStandings] = useState([]);
  const [standingsLeague, setStandingsLeague] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [joinRequests, setJoinRequests] = useState([]);

  useEffect(() => {
    fetchLeagueAndUser();
  }, [leagueId]);

  // Commissioner-only join-request queue: only relevant for public leagues
  // that require approval, and only once we know the viewer is the owner.
  useEffect(() => {
    if (league && user && league.is_public && league.join_approval && user.id === league.owner_id) {
      fetchJoinRequests();
    }
  }, [league, user]);

  const fetchJoinRequests = async () => {
    try {
      const res = await apiClient.get(`/api/league/${leagueId}/join-requests`);
      setJoinRequests(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      // The queue is supplementary to the main dashboard — fail silently.
      setJoinRequests([]);
    }
  };

  const handleDecideJoinRequest = async (requestId, approve) => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/league/${leagueId}/join-requests/${requestId}/decide`, { approve });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      setSuccessMessage(approve ? 'Join request approved' : 'Join request denied');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const fetchLeagueAndUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const leagueRes = await apiClient.get(`/api/league/${leagueId}`);
      setLeague(leagueRes.data.league);
      setTeams(leagueRes.data.teams);

      const userRes = await apiClient.get('/api/user');
      setUser(userRes.data);

      try {
        const standingsRes = await apiClient.get(`/api/scoring/league/${leagueId}/standings`);
        const standingsData = Array.isArray(standingsRes.data?.standings)
          ? standingsRes.data.standings
          : [];
        setStandings(standingsData);
        setStandingsLeague(standingsRes.data?.league || null);
      } catch (standingsErr) {
        setStandings([]);
        setStandingsLeague(null);
        setError(standingsErr.response?.data?.error || standingsErr.message);
      }
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

  const handleAdvanceWeek = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/advance-week`);
      setSuccessMessage('Week advanced!');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleToggleTransactionsLock = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      const locked = !league.transactions_locked;
      await apiClient.put(`/api/commissioner/league/${leagueId}/transactions-lock`, { locked });
      setSuccessMessage(locked ? 'Transactions locked' : 'Transactions unlocked');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleRemoveTeam = async (teamId) => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.delete(`/api/commissioner/league/${leagueId}/teams/${teamId}`);
      setSuccessMessage('Team removed');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleRollover = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/commissioner/league/${leagueId}/rollover`, {});
      setSuccessMessage('New season started!');
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
        <Alert severity="error">{error || 'League or user data not available'}</Alert>
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
        {league.best_ball && <Chip label="Best Ball" color="secondary" />}
        {league.draft_status === 'complete' && standingsLeague && (
          <>
            <Chip label={`Week ${standingsLeague.current_week}`} />
            <Chip
              label={
                (SEASON_STATUS_CHIP[standingsLeague.season_status] || {}).label ||
                standingsLeague.season_status
              }
              color={(SEASON_STATUS_CHIP[standingsLeague.season_status] || {}).color || 'default'}
            />
          </>
        )}
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
                W-L-T
              </TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                PF
              </TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                PA
              </TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="right">
                Streak
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {standings.map((team) => (
              <TableRow key={team.teamId}>
                <TableCell>{team.rank}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {team.name}
                    {team.playoffSeed != null && (
                      <Chip label={`#${team.playoffSeed}`} size="small" color="success" />
                    )}
                  </Box>
                </TableCell>
                <TableCell>{team.owner}</TableCell>
                <TableCell align="right">{`${team.wins}-${team.losses}-${team.ties}`}</TableCell>
                <TableCell align="right">{team.pf}</TableCell>
                <TableCell align="right">{team.pa}</TableCell>
                <TableCell align="right">{team.streak}</TableCell>
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
        {isOwner &&
          league.draft_status === 'complete' &&
          standingsLeague &&
          standingsLeague.season_status !== 'complete' && (
            <Button variant="contained" color="secondary" onClick={handleAdvanceWeek}>
              Advance Week
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
        <Link to={`/league/${leagueId}/lineup`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Set Lineup
          </Button>
        </Link>
        <Link to={`/league/${leagueId}/waivers`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Waivers
          </Button>
        </Link>
        <Link to={`/league/${leagueId}/trades`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Trades
          </Button>
        </Link>
        <Link to={`/league/${leagueId}/activity`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Activity
          </Button>
        </Link>
        <Link to={`/league/${leagueId}/power-rankings`} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary">
            Power Rankings
          </Button>
        </Link>
      </Box>

      {isOwner && (
        <Paper sx={{ p: 2, mt: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Commissioner Tools
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" color="warning" onClick={handleToggleTransactionsLock}>
              {league.transactions_locked ? 'Unlock Transactions' : 'Lock Transactions'}
            </Button>
            {standingsLeague && standingsLeague.season_status === 'complete' && (
              <Button variant="contained" color="secondary" onClick={handleRollover}>
                Start New Season
              </Button>
            )}
          </Box>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Remove a team
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {teams
              .filter((team) => team.owner !== user.username)
              .map((team) => (
                <Button
                  key={team.id}
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => handleRemoveTeam(team.id)}
                >
                  Remove {team.name}
                </Button>
              ))}
          </Box>

          {league.is_public && league.join_approval && (
            <Box sx={{ mt: 3 }} data-testid="join-requests-section">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2">Join Requests</Typography>
                <Chip size="small" label={joinRequests.length} color={joinRequests.length > 0 ? 'primary' : 'default'} />
              </Box>
              {joinRequests.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No pending join requests
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {joinRequests.map((request) => (
                    <Box
                      key={request.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
                    >
                      <Typography sx={{ flexGrow: 1 }}>
                        {request.username} — {request.team_name} —{' '}
                        {new Date(request.created_at).toLocaleString()}
                      </Typography>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={() => handleDecideJoinRequest(request.id, true)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => handleDecideJoinRequest(request.id, false)}
                      >
                        Deny
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Paper>
      )}

      <ChatPanel leagueId={leagueId} />
    </Container>
  );
}

export default LeagueDashboard;
