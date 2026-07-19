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
  Tooltip,
  TextField,
  Card,
  CardActionArea,
  Drawer,
  Fab,
  IconButton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import GroupsIcon from '@mui/icons-material/Groups';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SportsScoreIcon from '@mui/icons-material/SportsScore';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import TimelineIcon from '@mui/icons-material/Timeline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import ChatPanel from '../ChatPanel/ChatPanel';
import RecapCard from '../RecapCard/RecapCard';
import TrophyCase from '../TrophyCase/TrophyCase';
import DraftGradesCard from '../DraftGradesCard/DraftGradesCard';
import Countdown from '../Countdown/Countdown';

const SEASON_STATUS_CHIP = {
  regular: { label: 'Regular Season', color: 'default' },
  playoffs: { label: 'Playoffs', color: 'warning' },
  complete: { label: 'Season Complete', color: 'success' },
};

// League navigation, grouped by intent so the dashboard reads as sections
// rather than a flat wall of buttons. `weight` drives the card's visual
// emphasis: 'primary' cards (the most common day-to-day actions) get a
// tinted, filled treatment; 'default' cards stay outlined.
const NAV_GROUPS = [
  {
    label: 'Play',
    weight: 'primary',
    links: [
      { label: 'Draft Room', slug: 'draft', icon: GroupsIcon },
      { label: 'Set Lineup', slug: 'lineup', icon: AssignmentIcon },
      { label: 'Matchups', slug: 'matchups', icon: SportsScoreIcon },
      { label: 'Game Center', slug: 'game-center', icon: LiveTvIcon },
    ],
  },
  {
    label: 'Moves',
    weight: 'default',
    links: [
      { label: 'Waivers', slug: 'waivers', icon: SwapHorizIcon },
      { label: 'Trades', slug: 'trades', icon: CompareArrowsIcon },
    ],
  },
  {
    label: 'League',
    weight: 'default',
    links: [
      { label: 'Activity', slug: 'activity', icon: TimelineIcon },
      { label: 'Power Rankings', slug: 'power-rankings', icon: TrendingUpIcon },
      { label: 'History', slug: 'history', icon: EmojiEventsIcon },
    ],
  },
];

// Streak chip styling: green for a win streak, red for a loss streak, and a
// flame once a win streak reaches 3+ games.
function streakChipProps(streak) {
  if (!streak || streak === '—') return { color: 'default', icon: undefined };
  const result = streak[0];
  const length = Number(streak.slice(1)) || 0;
  if (result === 'W') {
    return { color: 'success', icon: length >= 3 ? <LocalFireDepartmentIcon /> : undefined };
  }
  if (result === 'L') return { color: 'error', icon: undefined };
  return { color: 'default', icon: undefined };
}

function LeagueDashboard() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [standings, setStandings] = useState([]);
  const [standingsLeague, setStandingsLeague] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const notify = useSnackbar();
  const [joinRequests, setJoinRequests] = useState([]);
  const [sizeMin, setSizeMin] = useState('');
  const [sizeMax, setSizeMax] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

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
      await apiClient.post(`/api/league/${leagueId}/join-requests/${requestId}/decide`, { approve });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      notify(approve ? 'Join request approved' : 'Join request denied');
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
      if (leagueRes.data.league.min_teams != null) setSizeMin(leagueRes.data.league.min_teams);
      if (leagueRes.data.league.max_teams != null) setSizeMax(leagueRes.data.league.max_teams);

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
      await apiClient.post(`/api/league/${leagueId}/start-draft`);
      notify('Draft started successfully!');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const handleSaveLimits = async () => {
    try {
      setError(null);
      await apiClient.put(`/api/league/${leagueId}`, {
        minTeams: Number(sizeMin),
        maxTeams: Number(sizeMax),
      });
      notify('Team limits updated');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const handleAdvanceWeek = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/advance-week`);
      notify('Week advanced!');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleToggleTransactionsLock = async () => {
    try {
      setError(null);
      const locked = !league.transactions_locked;
      await apiClient.put(`/api/commissioner/league/${leagueId}/transactions-lock`, { locked });
      notify(locked ? 'Transactions locked' : 'Transactions unlocked');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleRemoveTeam = async (teamId) => {
    try {
      setError(null);
      await apiClient.delete(`/api/commissioner/league/${leagueId}/teams/${teamId}`);
      notify('Team removed');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleRollover = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/commissioner/league/${leagueId}/rollover`, {});
      notify('New season started!');
      fetchLeagueAndUser();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleCopyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(league.invite_code);
      notify('Invite code copied to clipboard!');
    } catch (err) {
      setError('Failed to copy invite code');
      notify('Failed to copy invite code', { severity: 'error' });
    }
  };

  // A full shareable link that drops the recipient on the join form with the
  // code pre-filled. HashRouter keeps the route + query behind the '#'.
  const inviteLink = () =>
    `${window.location.origin}/#/league/join?code=${encodeURIComponent(league.invite_code)}`;

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      notify('Invite link copied');
    } catch (err) {
      notify('Failed to copy invite link', { severity: 'error' });
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
  // Below the configured minimum, the draft can't start yet (min_teams may be
  // absent in older data — treat that as no gate).
  const belowMin = league.min_teams != null && teams.length < league.min_teams;
  // A commissioner can't remove their own team; only surface the section when
  // there is actually someone to remove.
  const removableTeams = teams.filter((team) => team.owner !== user.username);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <RecapCard leagueId={leagueId} />

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
        <Chip
          label={`Teams: ${teams.length}/${league.max_teams}`}
          color={belowMin ? 'warning' : 'default'}
        />
        {league.draft_status === 'pending' && league.min_teams != null && (
          <Chip variant="outlined" label={`Min to start: ${league.min_teams}`} />
        )}
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

      {league.draft_status === 'pending' && league.draft_date && (
        <Box sx={{ mb: 3 }}>
          <Countdown variant="full" date={league.draft_date} />
        </Box>
      )}

      {league.invite_code && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'action.hover' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body1">
              <strong>Invite code:</strong> {league.invite_code}
            </Typography>
            <Button variant="outlined" size="small" onClick={handleCopyInviteCode}>
              Copy code
            </Button>
            <Button variant="contained" size="small" onClick={handleCopyInviteLink}>
              Copy invite link
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
            <TableRow
              sx={{
                bgcolor: 'background.default',
                '& .MuiTableCell-root': {
                  color: 'text.primary',
                  fontWeight: 700,
                  borderBottom: '2px solid',
                  borderBottomColor: 'divider',
                },
              }}
            >
              <TableCell>Rank</TableCell>
              <TableCell>Team</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell align="right">W-L-T</TableCell>
              <TableCell align="right">PF</TableCell>
              <TableCell align="right">PA</TableCell>
              <TableCell align="right">Streak</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {standings.map((team) => {
              const { color: streakColor, icon: streakIcon } = streakChipProps(team.streak);
              return (
                <TableRow key={team.teamId}>
                  <TableCell>{team.rank}</TableCell>
                  <TableCell>{team.name}</TableCell>
                  <TableCell>{team.owner}</TableCell>
                  <TableCell align="right">{`${team.wins}-${team.losses}-${team.ties}`}</TableCell>
                  <TableCell align="right">{team.pf}</TableCell>
                  <TableCell align="right">{team.pa}</TableCell>
                  <TableCell align="right">
                    {team.streak && team.streak !== '—' ? (
                      <Chip label={team.streak} size="small" color={streakColor} icon={streakIcon} />
                    ) : (
                      team.streak
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 300px' }}>
          <TrophyCase leagueId={leagueId} />
        </Box>
        <Box sx={{ flex: '1 1 300px' }}>
          <DraftGradesCard leagueId={leagueId} />
        </Box>
      </Box>

      {/* Contextual actions: only shown when they apply */}
      {((isOwner && league.draft_status === 'pending') ||
        (isOwner &&
          league.draft_status === 'complete' &&
          standingsLeague &&
          standingsLeague.season_status !== 'complete')) && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          {isOwner && league.draft_status === 'pending' && (
            <Box>
              <Tooltip
                title={
                  belowMin
                    ? `Need at least ${league.min_teams} teams to start the draft (currently ${teams.length})`
                    : ''
                }
              >
                <span>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleStartDraft}
                    disabled={belowMin}
                  >
                    Start Draft
                  </Button>
                </span>
              </Tooltip>
              {belowMin && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                  Requires a minimum of {league.min_teams} teams to start the draft.
                </Typography>
              )}
            </Box>
          )}
          {isOwner &&
            league.draft_status === 'complete' &&
            standingsLeague &&
            standingsLeague.season_status !== 'complete' && (
              <Button variant="contained" color="secondary" onClick={handleAdvanceWeek}>
                Advance Week
              </Button>
            )}
        </Box>
      )}

      {/* Grouped league navigation, as rich cards rather than a wall of
          identical outlined buttons. */}
      <Box sx={{ mb: 3 }}>
        {NAV_GROUPS.map((group) => (
          <Box key={group.label} sx={{ mb: 2 }}>
            <Typography
              variant="overline"
              sx={{ color: 'text.secondary', display: 'block', mb: 1 }}
            >
              {group.label}
            </Typography>
            <Grid container spacing={1.5}>
              {group.links.map((l) => {
                const Icon = l.icon;
                const primary = group.weight === 'primary';
                return (
                  <Grid xs={6} sm={3} key={l.slug}>
                    <Card
                      variant={primary ? 'elevation' : 'outlined'}
                      elevation={primary ? 1 : 0}
                      sx={{
                        height: '100%',
                        bgcolor: primary ? 'primary.main' : 'background.paper',
                        color: primary ? 'primary.contrastText' : 'text.primary',
                      }}
                    >
                      <CardActionArea
                        component={Link}
                        to={`/league/${leagueId}/${l.slug}`}
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 1,
                          p: 2,
                        }}
                      >
                        <Icon fontSize="medium" />
                        <Typography variant="subtitle2" sx={{ color: 'inherit' }}>
                          {l.label}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ))}
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

          {league.draft_status === 'pending' && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Team limits (editable until the draft starts)
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label="Min teams"
                  type="number"
                  size="small"
                  inputProps={{ min: 2, max: 20 }}
                  value={sizeMin}
                  onChange={(e) => setSizeMin(e.target.value)}
                  sx={{ width: 130 }}
                />
                <TextField
                  label="Max teams"
                  type="number"
                  size="small"
                  inputProps={{ min: 2, max: 20 }}
                  value={sizeMax}
                  onChange={(e) => setSizeMax(e.target.value)}
                  sx={{ width: 130 }}
                />
                <Button variant="outlined" size="small" onClick={handleSaveLimits}>
                  Save Limits
                </Button>
              </Box>
            </Box>
          )}
          {removableTeams.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Remove a team
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {removableTeams.map((team) => (
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
            </>
          )}

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

      <Fab
        color="primary"
        onClick={() => setChatOpen(true)}
        sx={{ position: 'fixed', bottom: 24, right: 24 }}
        aria-label="Open league chat"
      >
        <ChatBubbleOutlineIcon />
      </Fab>
      <Drawer
        anchor="right"
        variant="persistent"
        open={chatOpen}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100vw', sm: 380 },
            boxSizing: 'border-box',
          },
        }}
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton onClick={() => setChatOpen(false)} aria-label="Close chat">
              <CloseIcon />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1 }}>
            <ChatPanel leagueId={leagueId} />
          </Box>
        </Box>
      </Drawer>
    </Container>
  );
}

export default LeagueDashboard;
