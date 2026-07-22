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
  Skeleton,
  Box,
  Tooltip,
  Card,
  CardActionArea,
  Drawer,
  Fab,
  IconButton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import GroupsIcon from '@mui/icons-material/Groups';
import AssignmentIcon from '@mui/icons-material/Assignment';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import TimelineIcon from '@mui/icons-material/Timeline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import apiClient from '../../api/apiClient';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import TeamAvatar from '../common/TeamAvatar';
import ChatPanel from '../ChatPanel/ChatPanel';
import RecapCard from '../RecapCard/RecapCard';
import TrophyCase from '../TrophyCase/TrophyCase';
import DraftGradesCard from '../DraftGradesCard/DraftGradesCard';
import Countdown from '../Countdown/Countdown';
import CommissionerTools from './CommissionerTools';

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
      { label: 'Draft Settings', slug: 'draft-settings', icon: SettingsIcon, ownerOnly: true },
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
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    fetchLeagueAndUser();
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setTeams((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, {
      id: 'id', avatarUrl: 'avatar_url', avatarStaticUrl: 'avatar_static_url',
    })));
    setStandings((prev) => prev.map((team) => applyTeamProfileUpdate(team, update)));
  }), [leagueId]);

  const fetchLeagueAndUser = async () => {
    try {
      // Only show the full-page spinner on the first load — a background
      // refresh (e.g. after a Commissioner Tools action) shouldn't unmount
      // the dashboard and lose the selected tab / in-progress form state.
      if (!league) setLoading(true);
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
      await apiClient.post(`/api/league/${leagueId}/start-draft`);
      notify('Draft started successfully!');
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
    // Layout-shaped skeleton that mirrors the real dashboard: title + status
    // chips, then the Standings heading and table.
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Skeleton variant="text" width={220} height={48} />
          <Skeleton variant="rounded" width={90} height={32} />
          <Skeleton variant="rounded" width={120} height={32} />
        </Box>
        <Skeleton variant="text" width={140} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 1 }} />
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
  const auctionUnsupported = league.draft_type === 'auction';

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
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TeamAvatar
                        name={team.name}
                        avatarUrl={team.avatarUrl}
                        avatarStaticUrl={team.avatarStaticUrl}
                        size={28}
                      />
                      {team.name}
                    </Box>
                  </TableCell>
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
                    : auctionUnsupported
                    ? 'Salary-cap auctions are not supported yet'
                    : ''
                }
              >
                <span>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleStartDraft}
                    disabled={belowMin || auctionUnsupported}
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
              {auctionUnsupported && !belowMin && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                  Live salary-cap auctions are not supported yet.
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
              {group.links.filter((l) => !l.ownerOnly || isOwner).map((l) => {
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
        <CommissionerTools
          leagueId={leagueId}
          league={league}
          teams={teams}
          user={user}
          standingsLeague={standingsLeague}
          onRefresh={fetchLeagueAndUser}
        />
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
