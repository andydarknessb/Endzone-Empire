import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Typography, TextField, Button, Paper, Stack, Alert,
  Switch, FormControlLabel, Select, MenuItem, InputLabel, FormControl,
  Tabs, Tab, Accordion, AccordionSummary, AccordionDetails, Box,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import apiClient from '../../api/apiClient';
import DraftCentralCard from '../DraftCentral/DraftCentralCard';
import LeagueCard from '../common/LeagueCard';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import './LeagueManagement.css';

function LeagueManagement() {
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  const [leagues, setLeagues] = useState([]);
  const [activeTab, setActiveTab] = useState('create');
  const [leagueName, setLeagueName] = useState('');
  const [maxTeams, setMaxTeams] = useState(10);
  const [minTeams, setMinTeams] = useState(8);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newLeagueOpen, setNewLeagueOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const joinButtonRef = useRef(null);

  // Deep-link support: /#/league/join?code=XYZ pre-fills the invite field,
  // switches to the Join tab, and focuses the Join button so a shared link is
  // one click from joining.
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      setInviteCode(code);
      setActiveTab('join');
      setNewLeagueOpen(true);
    }
  }, [searchParams]);

  // The Join button only exists in the DOM once the Join tab is active, so
  // the focus has to wait for that switch to actually render before firing.
  useEffect(() => {
    if (activeTab !== 'join' || !newLeagueOpen || !searchParams.get('code')) return undefined;
    const handle = setTimeout(() => joinButtonRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [activeTab, newLeagueOpen, searchParams]);

  // New league-creation options — all optional, sent only when the user
  // actually sets them (see createLeague).
  const [isPublic, setIsPublic] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [bestBall, setBestBall] = useState(false);
  const [scoringPreset, setScoringPreset] = useState('');
  const [draftDate, setDraftDate] = useState('');

  useEffect(() => {
    fetchLeagues();
    // League inventory is loaded once when this route mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        maxTeams: Number(maxTeams),
        minTeams: Number(minTeams),
      };
      if (isPublic) payload.isPublic = true;
      if (isPublic && joinApproval) payload.joinApproval = true;
      if (bestBall) payload.bestBall = true;
      if (scoringPreset) payload.scoringPreset = scoringPreset;
      if (draftDate) payload.draftDate = new Date(draftDate).toISOString();

      const response = await apiClient.post('/api/league', payload);
      setNotice(`League created! Invite code: ${response.data.invite_code}`);
      notify('League created!');
      setLeagueName('');
      setIsPublic(false);
      setJoinApproval(false);
      setBestBall(false);
      setScoringPreset('');
      setDraftDate('');
      setNewLeagueOpen(false);
      fetchLeagues();
    } catch (err) {
      report(err);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const joinLeague = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await apiClient.post('/api/league/join', { inviteCode: inviteCode.trim() });
      setNotice('Joined league!');
      notify('Joined league!');
      setInviteCode('');
      setNewLeagueOpen(false);
      fetchLeagues();
    } catch (err) {
      report(err);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h4">My Leagues</Typography>
        <Button variant="contained" onClick={() => setNewLeagueOpen(true)}>New league</Button>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      <DraftCentralCard />

      {leagues.length === 0 ? (
        <Typography color="text.secondary" sx={{ my: 2 }}>
          You aren&apos;t in any leagues yet. Create one or join with an invite code.
        </Typography>
      ) : (
        <Stack spacing={2} sx={{ my: 2 }}>
          {leagues.map((league) => (
            <LeagueCard
              key={league.id}
              league={league}
              isOwner={user.id === league.owner_id}
              onDelete={deleteLeague}
            />
          ))}
        </Stack>
      )}

      <Dialog open={newLeagueOpen} onClose={() => setNewLeagueOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New league</DialogTitle>
        <DialogContent dividers>
          <Tabs value={activeTab} onChange={(event, value) => setActiveTab(value)} sx={{ mb: 2 }}>
            <Tab label="Create League" value="create" />
            <Tab label="Join League" value="join" />
          </Tabs>

          {activeTab === 'create' ? (
        <Paper component="form" onSubmit={createLeague} sx={{ p: 2, bgcolor: 'background.paper' }}>
          <Stack spacing={2}>
            <TextField label="League name" size="small" required
              value={leagueName} onChange={(e) => setLeagueName(e.target.value)} />

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
              sx={(theme) => ({ colorScheme: theme.palette.mode })}
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />

            <Accordion sx={{ bgcolor: 'background.paper' }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Advanced Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Typography variant="caption" color="text.secondary">
                    Roster size (starting slots, bench, and IR) is configured after creating the
                    league, via Commissioner Tools → Roster Settings.
                  </Typography>
                  <TextField label="Min teams (draft won't start below this)" size="small" type="number"
                    inputProps={{ min: 2, max: 20 }}
                    value={minTeams} onChange={(e) => setMinTeams(e.target.value)} />
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
                      Best ball: an optimal lineup is set automatically each week, with no manual lineup edits.
                    </Typography>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>

            <Button type="submit" variant="contained">Create League</Button>
          </Stack>
        </Paper>
          ) : (
        <Paper component="form" onSubmit={joinLeague} sx={{ p: 2, bgcolor: 'background.paper' }}>
          <Stack spacing={2}>
            <TextField label="Invite code" size="small" required
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <Button ref={joinButtonRef} type="submit" variant="contained">Join League</Button>
          </Stack>
        </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewLeagueOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default LeagueManagement;
