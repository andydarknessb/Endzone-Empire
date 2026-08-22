import React, { useCallback, useState, useEffect } from 'react';
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
  Badge,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import GroupsIcon from '@mui/icons-material/Groups';
import AssignmentIcon from '@mui/icons-material/Assignment';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import TimelineIcon from '@mui/icons-material/Timeline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import apiClient from '../../api/apiClient';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import { useLeague } from '../../hooks/useLeague';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import TeamAvatar from '../common/TeamAvatar';
import ChatPanel from '../ChatPanel/ChatPanel';
import RecapCard from '../RecapCard/RecapCard';
import TrophyCase from '../TrophyCase/TrophyCase';
import DraftGradesCard from '../DraftGradesCard/DraftGradesCard';
import PickemStandings from '../LeaguePickem/PickemStandings';
import Countdown from '../Countdown/Countdown';
import CommissionerTools from './CommissionerTools';
import AbbreviationTooltip from '../common/AbbreviationTooltip';
import { deriveLeaguePhase, isSeasonLive, LEAGUE_PHASE, LEAGUE_PHASE_META } from '../../lib/leaguePhase';
import { isPickemOnly } from '../../lib/leagueType';

// The fantasy header's season chip, worded by phase once the draft is done.
// (A pick'em-only header uses LEAGUE_PHASE_META instead: it has no playoffs.)
const SEASON_PHASE_CHIP = {
  [LEAGUE_PHASE.IN_SEASON]: { label: 'Regular Season', color: 'default' },
  [LEAGUE_PHASE.PLAYOFFS]: { label: 'Playoffs', color: 'warning' },
  [LEAGUE_PHASE.COMPLETE]: { label: 'Season Complete', color: 'success' },
};

// The draft-status chip shows the draft's own state, raw: that is Draft
// status, not League phase, and the label is the column value itself.
const DRAFT_STATUS_CHIP_COLOR = { pending: 'default', active: 'warning', complete: 'success' };

// The server's message when the response carried one, else whatever the client
// threw. The page's own requests have always been read this way.
const errorMessage = (err) => err?.response?.data?.error || err?.message;

// The resource cache's last-resort text (ADR 0004: the server's message, else
// the client's, else this) for a rejection that carried neither. The error
// view's own sentence names what is missing, which says more, so this
// placeholder never displaces it there.
const NO_DETAIL_MESSAGE = 'Request failed';

// League navigation, grouped by intent so the dashboard reads as sections
// rather than a flat wall of buttons. `weight` drives the card's visual
// emphasis: 'primary' cards (the most common day-to-day actions) get a
// tinted, filled treatment; 'default' cards stay outlined. `fantasyOnly`
// links have no surface in a pick'em-only league (no draft, rosters or
// matchups) and are trimmed there; a group with nothing left is skipped.
const NAV_GROUPS = [
  {
    label: 'Play',
    links: [
      { label: 'Draft Room', slug: 'draft', icon: GroupsIcon, fantasyOnly: true },
      { label: 'Set Lineup', slug: 'lineup', icon: AssignmentIcon, fantasyOnly: true },
      { label: 'Game Center', slug: 'game-center', icon: LiveTvIcon, fantasyOnly: true },
      { label: "Pick'em", slug: 'pickem', icon: FactCheckIcon },
    ],
  },
  {
    label: 'Moves',
    links: [
      { label: 'Waivers', slug: 'waivers', icon: SwapHorizIcon, fantasyOnly: true },
      { label: 'Trades', slug: 'trades', icon: CompareArrowsIcon, fantasyOnly: true },
    ],
  },
  {
    label: 'League',
    links: [
      { label: 'Activity', slug: 'activity', icon: TimelineIcon },
      { label: 'Power Rankings', slug: 'power-rankings', icon: TrendingUpIcon, fantasyOnly: true },
      { label: 'History', slug: 'history', icon: EmojiEventsIcon },
      { label: 'League Rules', slug: 'rules', icon: MenuBookIcon },
      { label: 'Draft Settings', slug: 'draft-settings', icon: SettingsIcon, commissionerOnly: true, fantasyOnly: true },
    ],
  },
];

// Streak chip styling: green for a win streak, red for a loss streak, and a
// flame once a win streak reaches 3+ games.
function streakChipProps(streak) {
  if (!streak || streak === 'â€”') return { color: 'default', icon: undefined };
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
  // The league row and its teams come from the shared cache, so every subpage
  // reached from here (and the FantasyOnly guard in front of the fantasy ones)
  // reads the same entry rather than fetching the payload again.
  const {
    league,
    teams,
    loading: leagueLoading,
    error: leagueError,
    refetch,
    updateTeams,
  } = useLeague(leagueId);
  const [standings, setStandings] = useState([]);
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [error, setError] = useState(null);
  const notify = useSnackbar();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  // Primitives, not the row itself: the standings follow the league's identity
  // and its pick'em flag, and a refetch that hands back an equal row must not
  // start a second standings request behind refresh()'s own.
  const leagueKnown = !!league;
  const pickemOnly = isPickemOnly(league);

  useEffect(() => {
    let active = true;
    // A new league starts with a clean banner: an error from the league just
    // left must not sit above this one.
    setError(null);
    setUserLoading(true);
    apiClient.get('/api/user').then(
      (res) => { if (active) { setUser(res.data); setUserLoading(false); } },
      (err) => { if (active) { setError(errorMessage(err)); setUserLoading(false); } }
    );
    return () => { active = false; };
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    // The teams live in the shared league entry now, so the avatar patch is a
    // write-through: every mount reading this league gets the new avatar. The
    // standings rows are this page's own, and stay local.
    updateTeams((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, {
      id: 'id', avatarUrl: 'avatar_url', avatarStaticUrl: 'avatar_static_url',
    })));
    setStandings((prev) => prev.map((team) => applyTeamProfileUpdate(team, update)));
  }), [leagueId, updateTeams]);

  // The standings wait for the league row. A pick'em-only league has no
  // matchups: the fantasy standings would come back as an all-zero table (and
  // their failure would set the page error banner), so they are never
  // requested; the pick'em standings component below fetches its own.
  //
  // Only the rows are read from this response. Phase, the week and the season
  // chips all come from the league row, which is the one source for them.
  const loadStandings = useCallback(async () => {
    if (!leagueKnown || pickemOnly) {
      setStandings([]);
      return;
    }
    try {
      const standingsRes = await apiClient.get(`/api/scoring/league/${leagueId}/standings`);
      setStandings(Array.isArray(standingsRes.data?.standings) ? standingsRes.data.standings : []);
    } catch (standingsErr) {
      setStandings([]);
      setError(errorMessage(standingsErr));
    }
  }, [leagueId, leagueKnown, pickemOnly]);

  useEffect(() => { loadStandings(); }, [loadStandings]);

  // One refresh for every path that changes the league server-side (starting
  // the draft, advancing the week, a Commissioner Tools action): refetch()
  // invalidates the shared entry, so sibling mounts reload on the one request
  // it starts, and the standings are reloaded alongside it because they are
  // derived from the same league. No clear first: that would be a second
  // invalidation and a second request.
  const refresh = useCallback(async () => {
    setError(null);
    await Promise.all([refetch(), loadStandings()]);
  }, [refetch, loadStandings]);

  const handleStartDraft = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/league/${leagueId}/start-draft`);
      notify('Draft started successfully!');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
      notify(errorMessage(err), { severity: 'error' });
    }
  };

  const handleAdvanceWeek = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/advance-week`);
      notify('Week advanced!');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
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

  // Only the first load blanks the page: once the league and the user have
  // arrived, a background refresh (a Commissioner Tools action, Advance Week)
  // keeps the dashboard mounted, so the selected tab and any in-progress form
  // survive it, and a failed refetch leaves the stale row on screen under the
  // error banner.
  if ((!league && leagueLoading) || (!user && userLoading)) {
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
    const leagueDetail = leagueError === NO_DETAIL_MESSAGE ? null : leagueError;
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">
          {error || leagueDetail || 'League or user data not available'}
        </Alert>
      </Container>
    );
  }

  // isOwner gates the two powers the owner can't delegate (deleting the league,
  // managing co-commissioners); isCommissioner gates everything else.
  const isOwner = user.id === league.owner_id;
  const isCommissioner = !!league.is_commissioner || isOwner;
  // Below the configured minimum, the draft can't start yet (min_teams may be
  // absent in older data â€” treat that as no gate).
  const belowMin = league.min_teams != null && teams.length < league.min_teams;
  const auctionUnsupported = league.draft_type === 'auction';
  const leaguePhase = deriveLeaguePhase(league);
  const preDraft = leaguePhase === LEAGUE_PHASE.PRE_DRAFT;
  const seasonComplete = leaguePhase === LEAGUE_PHASE.COMPLETE;
  // The season is being played (in season or playoffs): the week can advance.
  const seasonLive = isSeasonLive(league);
  // Draft done: the header shows the week and the season chip, complete included.
  const draftDone = seasonLive || seasonComplete;
  const primarySlugs = new Set(
    pickemOnly
      ? ['pickem']
      : leaguePhase === LEAGUE_PHASE.PRE_DRAFT || leaguePhase === LEAGUE_PHASE.DRAFTING
        ? ['draft']
        : leaguePhase === LEAGUE_PHASE.COMPLETE
          ? ['history']
          : leaguePhase === LEAGUE_PHASE.PLAYOFFS
            ? ['lineup', 'game-center']
            : ['lineup', 'game-center', 'waivers']
  );
  const seasonPhaseChip = SEASON_PHASE_CHIP[leaguePhase];
  // A pick'em-only league has no playoffs: its status IS its phase (in season
  // or complete), worded and coloured the same way LeagueCard words it.
  const phaseMeta = LEAGUE_PHASE_META[leaguePhase];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* A background refetch that failed keeps the league it already has on
          screen and reports the failure here. */}
      {(error || leagueError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || leagueError}
        </Alert>
      )}
      {/* Recaps and draft grades are matchup- and draft-derived; a pick'em
          league never has either, so the two requests are skipped outright. */}
      {!pickemOnly && <RecapCard leagueId={leagueId} />}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h4">{league.name}</Typography>
        {pickemOnly ? (
          <>
            <Chip label={`Teams: ${teams.length}/${league.max_teams}`} />
            <Chip label="Pick'em" color="secondary" />
            {league.current_week != null && <Chip label={`Week ${league.current_week}`} />}
            {phaseMeta && <Chip label={phaseMeta.label} color={phaseMeta.color} />}
          </>
        ) : (
          <>
        <Chip
          label={league.draft_status}
          color={DRAFT_STATUS_CHIP_COLOR[league.draft_status] || 'default'}
        />
        <Chip label={`Roster Limit: ${league.roster_limit}`} />
        <Chip
          label={`Teams: ${teams.length}/${league.max_teams}`}
          color={belowMin ? 'warning' : 'default'}
        />
        {preDraft && league.min_teams != null && (
          <Chip variant="outlined" label={`Min to start: ${league.min_teams}`} />
        )}
        {league.best_ball && <Chip label="Best Ball" color="secondary" />}
        {draftDone && (
          <>
            {league.current_week != null && <Chip label={`Week ${league.current_week}`} />}
            {seasonPhaseChip && <Chip label={seasonPhaseChip.label} color={seasonPhaseChip.color} />}
          </>
        )}
          </>
        )}
      </Box>

      {!pickemOnly && preDraft && league.draft_date && (
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

      {pickemOnly ? (
        <>
          <Paper
            sx={{
              p: { xs: 2, sm: 3 },
              mb: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            {seasonComplete ? (
              <Box>
                <Typography variant="h6" sx={{ color: 'inherit' }}>
                  The pick&apos;em season is over
                </Typography>
                <Typography variant="body2" sx={{ color: 'inherit', opacity: 0.9 }}>
                  Standings are final. Next season opens when the commissioner starts it.
                </Typography>
              </Box>
            ) : (
              <Box>
                <Typography variant="h6" sx={{ color: 'inherit' }}>
                  {league.current_week != null ? `Week ${league.current_week} picks` : 'Weekly picks'}
                </Typography>
                <Typography variant="body2" sx={{ color: 'inherit', opacity: 0.9 }}>
                  Pick the winner of every game before it kicks off.
                </Typography>
              </Box>
            )}
            <Button
              component={Link}
              to={`/league/${leagueId}/pickem`}
              variant="contained"
              color="secondary"
              size="large"
            >
              {seasonComplete ? 'View picks' : 'Make your picks'}
            </Button>
          </Paper>

          <Typography variant="h6" sx={{ mb: 2 }}>
            Standings
          </Typography>
          <Box sx={{ mb: 3 }}>
            <PickemStandings leagueId={leagueId} season={league.current_season} />
          </Box>
        </>
      ) : (
        <>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Standings
      </Typography>
      <TableContainer component={Paper} sx={{ mb: 3, maxWidth: '100%', overflowX: 'auto' }}>
        <Table sx={{ minWidth: 680 }}>
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
              {/* A record like 0-0-0 breaks at every hyphen once the table is
                  squeezed on a phone: keep the header and the records on one line. */}
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>W-L-T</TableCell>
              <TableCell align="right"><AbbreviationTooltip term="PF" /></TableCell>
              <TableCell align="right"><AbbreviationTooltip term="PA" /></TableCell>
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
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{`${team.wins}-${team.losses}-${team.ties}`}</TableCell>
                  <TableCell align="right">{team.pf}</TableCell>
                  <TableCell align="right">{team.pa}</TableCell>
                  <TableCell align="right">
                    {team.streak && team.streak !== 'â€”' ? (
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
        </>
      )}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 300px' }}>
          <TrophyCase leagueId={leagueId} />
        </Box>
        {!pickemOnly && (
          <Box sx={{ flex: '1 1 300px' }}>
            <DraftGradesCard leagueId={leagueId} />
          </Box>
        )}
      </Box>

      {/* Contextual actions: only shown when they apply. A pick'em-only
          league has no draft to start and its week follows the NFL calendar
          on its own, so neither action exists there. */}
      {!pickemOnly && isCommissioner && (preDraft || seasonLive) && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          {preDraft && (
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
          {seasonLive && (
            <Button variant="contained" color="secondary" onClick={handleAdvanceWeek}>
              Advance Week
            </Button>
          )}
        </Box>
      )}

      {/* Grouped league navigation, as rich cards rather than a wall of
          identical outlined buttons. */}
      <Box sx={{ mb: 3 }}>
        {NAV_GROUPS.map((group) => ({
          ...group,
          links: group.links.filter(
            (l) => (!l.commissionerOnly || isCommissioner) && (!l.fantasyOnly || !pickemOnly)
          ),
        })).filter((group) => group.links.length > 0).map((group) => (
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
                const primary = primarySlugs.has(l.slug);
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
                        aria-label={l.label}
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
                        {primary && <Chip label="Recommended" size="small" color="secondary" />}
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ))}
      </Box>

      {isCommissioner && (
        <CommissionerTools
          leagueId={leagueId}
          league={league}
          teams={teams}
          user={user}
          isOwner={isOwner}
          onRefresh={refresh}
        />
      )}

      <Fab
        color="primary"
        onClick={() => setChatOpen(true)}
        sx={{ position: 'fixed', bottom: 24, right: 24 }}
        aria-label={
          chatUnread > 0
            ? `Open league chat, ${chatUnread} unread message${chatUnread === 1 ? '' : 's'}`
            : 'Open league chat'
        }
      >
        <Badge badgeContent={chatUnread} color="error" max={99} overlap="circular">
          <ChatBubbleOutlineIcon />
        </Badge>
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
            <ChatPanel
              leagueId={leagueId}
              open={chatOpen}
              currentUserId={user ? user.id : null}
              onUnreadChange={setChatUnread}
            />
          </Box>
        </Box>
      </Drawer>
    </Container>
  );
}

export default LeagueDashboard;
