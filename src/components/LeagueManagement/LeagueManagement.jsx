import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Typography, TextField, Button, Paper, Stack, Chip, Alert, Divider,
  Switch, FormControlLabel, Select, MenuItem, InputLabel, FormControl,
  Tabs, Tab, Accordion, AccordionSummary, AccordionDetails, Box,
  Card, CardContent, CardActions, IconButton, Menu,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import apiClient from '../../api/apiClient';
import Countdown from '../Countdown/Countdown';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import './LeagueManagement.css';

function LeagueCard({ league, isOwner, onDelete }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const confirmDelete = () => {
    setConfirmOpen(false);
    onDelete(league.id);
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box>
            <Typography variant="h6">{league.name}</Typography>
            <Typography variant="body2" color="text.secondary">{league.my_team_name}</Typography>
            <Stack direction="row" spacing={1} rowGap={1} flexWrap="wrap" sx={{ mt: 1 }}>
              <Chip
                size="small"
                label={`Draft: ${league.draft_status}`}
                color={league.draft_status === 'active' ? 'warning' : league.draft_status === 'complete' ? 'success' : 'default'}
              />
              {league.team_count != null && (
                <Chip size="small" label={`Teams: ${league.team_count}/${league.max_teams}`} />
              )}
              {league.draft_status === 'pending' && league.draft_date && (
                <Countdown variant="chip" date={league.draft_date} />
              )}
            </Stack>
          </Box>

          {isOwner && (
            <>
              <IconButton
                aria-label="League actions"
                size="small"
                onClick={(event) => setAnchorEl(event.currentTarget)}
              >
                <MoreVertIcon />
              </IconButton>
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
                <MenuItem
                  sx={{ color: 'error.main' }}
                  onClick={() => {
                    setAnchorEl(null);
                    setConfirmOpen(true);
                  }}
                >
                  Delete
                </MenuItem>
              </Menu>
              <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                <DialogTitle>Delete {league.name}?</DialogTitle>
                <DialogContent>
                  <DialogContentText>
                    This permanently removes the league, its roster, and its history for every
                    member. This can&apos;t be undone.
                  </DialogContentText>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
                  <Button color="error" variant="contained" onClick={confirmDelete}>
                    Delete League
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, pt: 0, flexWrap: 'wrap', gap: 1 }}>
        <Button component={Link} to={`/league/${league.id}`} variant="contained">Dashboard</Button>
        <Button component={Link} to={`/league/${league.id}/draft`} variant="outlined">Draft Room</Button>
        <Button component={Link} to={`/league/${league.id}/matchups`} variant="outlined">Matchups</Button>
      </CardActions>
    </Card>
  );
}

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
    }
  }, [searchParams]);

  // The Join button only exists in the DOM once the Join tab is active, so
  // the focus has to wait for that switch to actually render before firing.
  useEffect(() => {
    if (activeTab === 'join' && searchParams.get('code')) {
      joinButtonRef.current?.focus();
    }
  }, [activeTab, searchParams]);

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
      <Typography variant="h4" gutterBottom>My Leagues</Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {leagues.length === 0 ? (
        <Typography color="text.secondary" sx={{ my: 2 }}>
          You aren&apos;t in any leagues yet — create one or join with an invite code.
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

      <Divider sx={{ my: 3 }} />

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
                      Best ball: an optimal lineup is set automatically each week — no manual lineup edits.
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
    </div>
  );
}

export default LeagueManagement;
