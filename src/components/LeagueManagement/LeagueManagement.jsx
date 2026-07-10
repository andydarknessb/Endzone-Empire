import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Typography, TextField, Button, Paper, Stack, Chip, Alert, Divider,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import './LeagueManagement.css';

function LeagueManagement() {
  const user = useSelector((store) => store.user);
  const [leagues, setLeagues] = useState([]);
  const [leagueName, setLeagueName] = useState('');
  const [rosterLimit, setRosterLimit] = useState(15);
  const [maxTeams, setMaxTeams] = useState(10);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchLeagues();
  }, []);

  const report = (err) => setError(err.response?.data?.error || err.message);

  const fetchLeagues = async () => {
    try {
      const response = await apiClient.get('/api/league');
      setLeagues(response.data);
    } catch (err) {
      report(err);
    }
  };

  const createLeague = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const response = await apiClient.post('/api/league', {
        name: leagueName,
        rosterLimit: Number(rosterLimit),
        maxTeams: Number(maxTeams),
      });
      setNotice(`League created! Invite code: ${response.data.invite_code}`);
      setLeagueName('');
      fetchLeagues();
    } catch (err) {
      report(err);
    }
  };

  const joinLeague = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await apiClient.post('/api/league/join', { inviteCode: inviteCode.trim() });
      setNotice('Joined league!');
      setInviteCode('');
      fetchLeagues();
    } catch (err) {
      report(err);
    }
  };

  const deleteLeague = async (id) => {
    setError(null);
    try {
      await apiClient.delete(`/api/league/${id}`);
      fetchLeagues();
    } catch (err) {
      report(err);
    }
  };

  return (
    <div className="container">
      <Typography variant="h4" gutterBottom>My Leagues</Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
        <Paper component="form" onSubmit={createLeague} sx={{ p: 2, flex: 1 }}>
          <Typography variant="h6">Create a private league</Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="League name" size="small" required
              value={leagueName} onChange={(e) => setLeagueName(e.target.value)} />
            <TextField label="Roster limit" size="small" type="number"
              inputProps={{ min: 1, max: 30 }}
              value={rosterLimit} onChange={(e) => setRosterLimit(e.target.value)} />
            <TextField label="Max teams" size="small" type="number"
              inputProps={{ min: 2, max: 20 }}
              value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} />
            <Button type="submit" variant="contained">Create League</Button>
          </Stack>
        </Paper>

        <Paper component="form" onSubmit={joinLeague} sx={{ p: 2, flex: 1 }}>
          <Typography variant="h6">Join with an invite code</Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Invite code" size="small" required
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <Button type="submit" variant="contained">Join League</Button>
          </Stack>
        </Paper>
      </Stack>

      <Divider sx={{ my: 2 }} />

      {leagues.length === 0 && (
        <Typography color="text.secondary">
          You aren&apos;t in any leagues yet — create one or join with an invite code.
        </Typography>
      )}
      <Stack spacing={1}>
        {leagues.map((league) => (
          <Paper key={league.id} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>{league.name}</Typography>
            <Chip size="small" label={`Draft: ${league.draft_status}`}
              color={league.draft_status === 'active' ? 'warning' : league.draft_status === 'complete' ? 'success' : 'default'} />
            <Chip size="small" label={`Team: ${league.my_team_name}`} />
            <Button component={Link} to={`/league/${league.id}`} variant="outlined">Dashboard</Button>
            <Button component={Link} to={`/league/${league.id}/draft`} variant="outlined">Draft Room</Button>
            <Button component={Link} to={`/league/${league.id}/matchups`} variant="outlined">Matchups</Button>
            {user.id === league.owner_id && (
              <Button color="error" variant="outlined" onClick={() => deleteLeague(league.id)}>Delete</Button>
            )}
          </Paper>
        ))}
      </Stack>
    </div>
  );
}

export default LeagueManagement;
