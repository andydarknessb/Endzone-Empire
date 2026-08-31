import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import apiClient from '../../api/apiClient';
import TeamAvatarUploader from '../common/TeamAvatarUploader';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../lib/leaguePhase';
import { isPickemOnly } from '../../lib/leagueType';
import { LineupEditor } from './LineupScreen';

function TeamSummary({ league, summary }) {
  if (!league || summary.status === 'idle') return null;
  if (summary.status === 'loading') {
    return <Skeleton data-testid="team-summary-skeleton" variant="text" width={220} sx={{ mt: 0.5 }} />;
  }

  const isPreDraft = deriveLeaguePhase(league) === LEAGUE_PHASE.PRE_DRAFT;
  const isFaab = league.waiver_type === 'faab';
  const row = summary.row;
  const gamesPlayed = row ? row.wins + row.losses + row.ties : 0;
  const parts = [];

  if (isPreDraft || (row && gamesPlayed === 0)) {
    parts.push('No record yet');
  } else if (row) {
    parts.push(`Record: ${row.wins}-${row.losses}-${row.ties}`);
    parts.push(`Rank: #${row.rank}`);
  } else {
    parts.push('Record unavailable');
  }

  if (isPreDraft) {
    parts.push('Waiver order not set');
  } else if (isFaab) {
    parts.push(league.my_team_faab_remaining == null
      ? 'FAAB unavailable'
      : `FAAB remaining: $${league.my_team_faab_remaining}`);
  } else {
    parts.push(league.my_team_waiver_priority == null
      ? 'Waiver order not set'
      : `Waiver priority: #${league.my_team_waiver_priority}`);
  }

  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
      {parts.join(' · ')}
    </Typography>
  );
}

function TeamLineup() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ status: 'idle', row: null });
  const activeLeague = leagues.find((league) => league.id === selectedLeague);
  const activeTeamId = activeLeague?.my_team_id;
  const leaguePhase = deriveLeaguePhase(activeLeague);

  const report = (err) => setError(err.response?.data?.error || err.message);

  const fetchRoster = async (leagueId) => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/api/team/roster?leagueId=${leagueId}`);
      const nextRoster = Array.isArray(response.data) ? response.data : [];
      setRoster(nextRoster);
      return nextRoster;
    } catch (err) {
      report(err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchLeagues = async () => {
    try {
      const response = await apiClient.get('/api/league');
      const rosterLeagues = response.data.filter((league) => !isPickemOnly(league));
      setLeagues(rosterLeagues);
      if (rosterLeagues.length > 0) {
        const requestedLeagueId = Number(searchParams.get('leagueId'));
        const selected = rosterLeagues.find((league) => league.id === requestedLeagueId)
          || rosterLeagues[0];
        setSelectedLeague(selected.id);
        if (String(selected.id) !== searchParams.get('leagueId')) {
          setSearchParams({ leagueId: String(selected.id) }, { replace: true });
        }
      } else {
        setLoading(false);
      }
    } catch (err) {
      report(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeagues();
    // League inventory is loaded once when this route mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedLeague) fetchRoster(selectedLeague);
    // selectedLeague is the only roster-fetch trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeague]);

  useEffect(() => {
    let ignore = false;
    if (!selectedLeague || activeTeamId == null) {
      setSummary({ status: 'idle', row: null });
      return () => { ignore = true; };
    }

    setSummary({ status: 'loading', row: null });
    apiClient.get(`/api/scoring/league/${selectedLeague}/standings`)
      .then((response) => {
        if (ignore) return;
        const rows = Array.isArray(response.data?.standings) ? response.data.standings : [];
        setSummary({
          status: 'success',
          row: rows.find((row) => row.teamId === activeTeamId) || null,
        });
      })
      .catch(() => {
        if (!ignore) setSummary({ status: 'error', row: null });
      });

    return () => { ignore = true; };
  }, [selectedLeague, activeTeamId]);

  const handleAvatarUpdated = (team) => {
    setLeagues((previous) => previous.map((league) => (league.id === selectedLeague
      ? { ...league, my_team_avatar_url: team.avatar_url, my_team_avatar_static_url: team.avatar_static_url }
      : league)));
  };

  const handleLeagueChange = (event) => {
    const leagueId = event.target.value;
    setSelectedLeague(leagueId);
    setSearchParams({ leagueId: String(leagueId) }, { replace: true });
  };

  const teamName = activeLeague?.my_team_name || 'My Team';
  const showEmptyState = !loading && roster.length === 0;
  const showLineupEditor = !loading && roster.length > 0;
  const draftInProgress = leaguePhase === LEAGUE_PHASE.PRE_DRAFT || leaguePhase === LEAGUE_PHASE.DRAFTING;

  return (
    <div>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            {activeLeague ? (
              <TeamAvatarUploader
                teamId={activeLeague.my_team_id}
                teamName={teamName}
                avatarUrl={activeLeague.my_team_avatar_url}
                avatarStaticUrl={activeLeague.my_team_avatar_static_url}
                onUpdated={handleAvatarUpdated}
                size={64}
              />
            ) : (
              <Avatar sx={{ width: 64, height: 64 }} />
            )}
            <Box>
              <Typography variant="h4" component="h1">{teamName}</Typography>
              <TeamSummary league={activeLeague} summary={summary} />
            </Box>
          </Stack>

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="league-select-label">League</InputLabel>
            <Select
              labelId="league-select-label"
              label="League"
              value={selectedLeague}
              onChange={handleLeagueChange}
            >
              {leagues.map((league) => (
                <MenuItem key={league.id} value={league.id}>{league.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading && (
        <Stack spacing={1.5} data-testid="team-lineup-skeleton">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} data-testid="roster-skeleton" variant="rounded" height={84} />
          ))}
        </Stack>
      )}

      {showEmptyState && (
        <Paper
          variant="outlined"
          sx={{
            minHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
          }}
        >
          <Stack alignItems="center" spacing={1.5} sx={{ py: 4, px: 3, textAlign: 'center' }}>
            <GroupAddOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            {leagues.length === 0 ? (
              <>
                <Typography color="text.secondary">
                  You&apos;re not in a fantasy league yet. Create or join one to start building your team.
                </Typography>
                <Button component={RouterLink} to="/league" variant="contained">Go to Leagues</Button>
              </>
            ) : (
              <>
                <Typography color="text.secondary">
                  {draftInProgress
                    ? 'Your roster fills during the draft. Head to the Draft Room when it is time to pick.'
                    : 'No players rostered yet. Head to the player pool to add players to your team.'}
                </Typography>
                <Button
                  component={RouterLink}
                  to={draftInProgress ? `/league/${selectedLeague}/draft` : '/player'}
                  variant="contained"
                >
                  {draftInProgress ? 'Draft Room' : 'Browse Players'}
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      )}

      {showLineupEditor && (
        <LineupEditor
          leagueId={selectedLeague}
          showLeagueBreadcrumb={false}
          heading="Lineup"
          embedded
          roster={roster}
          refreshRoster={() => fetchRoster(selectedLeague)}
        />
      )}
    </div>
  );
}

export default TeamLineup;
