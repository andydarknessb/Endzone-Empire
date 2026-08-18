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
import LeagueTypeFields from '../common/LeagueTypeFields';
import LeagueTypeChips from '../common/LeagueTypeChips';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import {
  LEAGUE_TYPE, MIN_TEAMS, capForType, clampTeamCount, includesFantasy, isPickemOnlyType, isValidTeamCount,
  leagueTypePayload,
} from '../../lib/leagueType';
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
  // What the invite code in the field points at, fetched read-only so the
  // joiner sees the league's name and type before committing. `null` while
  // the field holds nothing plausible or the lookup found nothing; a failed
  // preview never blocks the Join button.
  const [preview, setPreview] = useState(null);

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

  const trimmedInviteCode = inviteCode.trim();
  useEffect(() => {
    if (trimmedInviteCode.length < 6) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await apiClient.get(`/api/league/preview?code=${encodeURIComponent(trimmedInviteCode)}`);
        const league = response.data && response.data.id ? response.data : null;
        if (!cancelled) setPreview(league ? { ...league, code: trimmedInviteCode } : null);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmedInviteCode]);

  // The Join button only exists in the DOM once the Join tab is active, so
  // the focus has to wait for that switch to actually render before firing.
  useEffect(() => {
    if (activeTab !== 'join' || !newLeagueOpen || !searchParams.get('code')) return undefined;
    const handle = setTimeout(() => joinButtonRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [activeTab, newLeagueOpen, searchParams]);

  // League type is always sent; the pick'em mode only when the type includes
  // pick'em (see leagueTypePayload).
  const [leagueType, setLeagueType] = useState(LEAGUE_TYPE.FANTASY);
  const [pickemMode, setPickemMode] = useState('straight');

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

  // Switching type re-caps the team count: a 40-manager pick'em pool cannot
  // become a 40-team fantasy league. Min teams is hidden while the type is
  // pick'em, so it is pulled under the new max too rather than surfacing later
  // as a server "minTeams must be ... between 2 and maxTeams" rejection.
  const handleLeagueTypeChange = (nextType) => {
    const cappedMax = clampTeamCount(maxTeams, capForType(nextType));
    setLeagueType(nextType);
    setMaxTeams(cappedMax);
    if (isValidTeamCount(cappedMax, capForType(nextType))) {
      setMinTeams((current) => clampTeamCount(current, cappedMax));
    }
  };

  // Max/Min teams live inside a collapsed-by-default Accordion, so native form
  // validation would block submit on a control the user cannot see: gate the
  // button here and say why. Min only applies when the type has a draft.
  const teamCap = capForType(leagueType);
  const maxTeamsValid = isValidTeamCount(maxTeams, teamCap);
  const minTeamsValid = !includesFantasy(leagueType) || (maxTeamsValid && isValidTeamCount(minTeams, Number(maxTeams)));
  const teamLimitsValid = maxTeamsValid && minTeamsValid;

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
      // maxTeams is always explicit: the server's default is the fantasy 10
      // for every type, so a pick'em pool must never rely on it. A pick'em
      // league has no draft to gate on, so it sends no minTeams (the server
      // defaults it to the floor).
      const payload = {
        name: leagueName,
        maxTeams: Number(maxTeams),
      };
      if (includesFantasy(leagueType)) payload.minTeams = Number(minTeams);
      Object.assign(payload, leagueTypePayload({ leagueType, pickemMode, bestBall, scoringPreset, draftDate }));
      if (isPublic) payload.isPublic = true;
      if (isPublic && joinApproval) payload.joinApproval = true;

      const response = await apiClient.post('/api/league', payload);
      setNotice(`League created! Invite code: ${response.data.invite_code}`);
      notify('League created!');
      setLeagueName('');
      setMaxTeams(10);
      setMinTeams(8);
      setLeagueType(LEAGUE_TYPE.FANTASY);
      setPickemMode('straight');
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

            <LeagueTypeFields
              leagueType={leagueType}
              onLeagueTypeChange={handleLeagueTypeChange}
              pickemMode={pickemMode}
              onPickemModeChange={setPickemMode}
            />

            {/* Fantasy-only settings: a pick'em league has no scoring rules or
                draft, and the server rejects these fields for it. */}
            {includesFantasy(leagueType) && (
              <>
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
              </>
            )}

            <Accordion sx={{ bgcolor: 'background.paper' }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Advanced Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  {includesFantasy(leagueType) ? (
                    <>
                  <Typography variant="caption" color="text.secondary">
                    Roster size (starting slots, bench, and IR) is configured after creating the
                    league, via Commissioner Tools → Roster Settings.
                  </Typography>
                  <TextField label="Min teams (draft won't start below this)" size="small" type="number"
                    inputProps={{ min: MIN_TEAMS, max: capForType(leagueType) }}
                    error={!minTeamsValid}
                    helperText={minTeamsValid ? undefined : `${MIN_TEAMS} up to the max teams`}
                    value={minTeams} onChange={(e) => setMinTeams(e.target.value)} />
                    </>
                  ) : (
                  <Typography variant="caption" color="text.secondary">
                    A pick&apos;em league has no draft to wait for: managers can join all season,
                    up to the cap below.
                  </Typography>
                  )}
                  <TextField label="Max teams" size="small" type="number"
                    inputProps={{ min: MIN_TEAMS, max: capForType(leagueType) }}
                    error={!maxTeamsValid}
                    helperText={isPickemOnlyType(leagueType) || !maxTeamsValid ? `${MIN_TEAMS} to ${capForType(leagueType)} ${isPickemOnlyType(leagueType) ? 'managers' : 'teams'}` : undefined}
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
                  {includesFantasy(leagueType) && (
                    <>
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
                    </>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>

            <Button type="submit" variant="contained" disabled={!teamLimitsValid}>Create League</Button>
            {!teamLimitsValid && (
              <Typography variant="caption" color="error">
                Check the team limits under Advanced Settings.
              </Typography>
            )}
          </Stack>
        </Paper>
          ) : (
        <Paper component="form" onSubmit={joinLeague} sx={{ p: 2, bgcolor: 'background.paper' }}>
          <Stack spacing={2}>
            <TextField label="Invite code" size="small" required
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            {preview && preview.code === trimmedInviteCode && (
              <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="invite-preview">
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{preview.name}</Typography>
                <LeagueTypeChips league={preview} sx={{ my: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  {preview.teamCount}/{preview.maxTeams} teams · run by {preview.ownerUsername}
                </Typography>
                {preview.alreadyMember && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    You are already a member of this league.
                  </Typography>
                )}
                {preview.draftStatus && preview.draftStatus !== 'pending' && (
                  <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                    The draft has already started · joining is closed.
                  </Typography>
                )}
              </Paper>
            )}
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
