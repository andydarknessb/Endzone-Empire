import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Typography, TextField, Button, Paper, Stack, Chip, Alert, Divider,
  Switch, FormControlLabel, Select, MenuItem, InputLabel, FormControl,
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

  // New league-creation options — all optional, sent only when the user
  // actually sets them (see createLeague).
  const [isPublic, setIsPublic] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [bestBall, setBestBall] = useState(false);
  const [scoringPreset, setScoringPreset] = useState('');
  const [draftDate, setDraftDate] = useState('');

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
      const payload = {
        name: leagueName,
        rosterLimit: Number(rosterLimit),
        maxTeams: Number(maxTeams),
      };
      if (isPublic) payload.isPublic = true;
      if (isPublic && joinApproval) payload.joinApproval = true;
      if (bestBall) payload.bestBall = true;
      if (scoringPreset) payload.scoringPreset = scoringPreset;
      if (draftDate) payload.draftDate = new Date(draftDate).toISOString();

      const response = await apiClient.post('/api/league', payload);
      setNotice(`League created! Invite code: ${response.data.invite_code}`);
      setLeagueName('');
      setIsPublic(false);
      setJoinApproval(false);
      setBestBall(false);
      setScoringPreset('');
      setDraftDate('');
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

            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
              }
              label="Public league"
            />
            {isPublic && (
              <FormControlLabel
                sx={{ ml: 2 }}
                control={
                  <Switch
                    checked={joinApproval}
                    onChange={(e) => setJoinApproval(e.target.checked)}
                  />
                }
                label="Require commissioner approval to join"
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={bestBall}
                  onChange={(e) => setBestBall(e.target.checked)}
                />
              }
              label="Best ball mode"
            />
            {bestBall && (
              <Typography variant="caption" color="text.secondary">
                Best ball: an optimal lineup is set automatically each week — no manual lineup edits.
              </Typography>
            )}

            <FormControl size="small">
              <InputLabel id="scoring-preset-label">Scoring</InputLabel>
              <Select
                labelId="scoring-preset-label"
                id="scoring-preset-select"
                label="Scoring"
                value={scoringPreset}
                onChange={(e) => setScoringPreset(e.target.value)}
              >
                {/* No preset sent = the built-in default rules, which are half-PPR */}
                <MenuItem value="">League default (Half PPR)</MenuItem>
                <MenuItem value="standard">Standard</MenuItem>
                <MenuItem value="half_ppr">Half PPR</MenuItem>
                <MenuItem value="ppr">PPR</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Draft date"
              type="datetime-local"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />

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
