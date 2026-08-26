import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Box,
  Stack,
  Paper,
  LinearProgress,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Skeleton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { matchupWinProbability } from '../../lib/winProbability';
import { computeDefaultWeek } from '../../lib/matchupWeek';
import { playLabel } from '../../lib/scoringEvents';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import { MatchupStatusChip } from '../MatchupDetail/MatchupExtras';
import TeamAvatar from '../common/TeamAvatar';
import AbbreviationTooltip from '../common/AbbreviationTooltip';

const LIVE_INDICATOR_MS = 10000;

/**
 * Dual-sided win probability bar built from two adjoining determinate
 * LinearProgress tracks (rather than one bar) so each side can carry its
 * own color without fighting MUI's single-color `.MuiLinearProgress-bar`.
 */
function WinProbabilitySplitBar({ homeName, awayName, homeProb }) {
  const home = Math.max(0, Math.min(1, Number(homeProb) || 0));
  const away = 1 - home;
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {Math.round(home * 100)}%
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Win Probability
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {Math.round(away * 100)}%
        </Typography>
      </Box>
      <Stack
        direction="row"
        role="img"
        aria-label={`Win probability: ${homeName} ${Math.round(home * 100)}%, ${awayName} ${Math.round(away * 100)}%`}
        sx={{ height: 8, borderRadius: 999, overflow: 'hidden' }}
      >
        <LinearProgress
          variant="determinate"
          value={100}
          sx={{
            width: `${home * 100}%`,
            height: '100%',
            borderRadius: 0,
            bgcolor: 'transparent',
            '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' },
          }}
        />
        <LinearProgress
          variant="determinate"
          value={100}
          sx={{
            width: `${away * 100}%`,
            height: '100%',
            borderRadius: 0,
            bgcolor: 'transparent',
            '& .MuiLinearProgress-bar': { bgcolor: 'secondary.main' },
          }}
        />
      </Stack>
    </Box>
  );
}

const TICKER_LIMIT = 10;

/** One line of ticker text: "🏈 TD: <player> · <type> TD (+<pts> pts to <team>)". */
function tickerLine(item) {
  return `TD: ${item.name} · ${playLabel(item)} (+${Math.round((Number(item.pointsDelta) || 0) * 10) / 10} pts to ${item.teamName})`;
}

/**
 * League-wide scoring ticker. Fed by the same `scores:updated` socket
 * GameCenter already holds — `items` are real typed TD plays (see
 * scoring.service.js) resolved to a fantasy team name via the roster
 * lookup built in GameCenter. Renders an idle message until the first
 * real play of the week lands.
 */
function LiveActionTicker({ items }) {
  if (!items || items.length === 0) {
    return (
      <Paper
        variant="outlined"
        data-testid="live-action-ticker"
        sx={{
          mb: 3,
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderLeft: '4px solid',
          borderLeftColor: 'divider',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          🏈 Live scoring plays will appear here once games kick off.
        </Typography>
      </Paper>
    );
  }

  const loop = items.length > 1 ? [...items, ...items] : items;

  return (
    <Paper
      variant="outlined"
      data-testid="live-action-ticker"
      aria-label="Recent league scoring plays"
      sx={{
        mb: 3,
        overflow: 'hidden',
        position: 'relative',
        borderLeft: '4px solid',
        borderLeftColor: 'error.main',
        bgcolor: 'var(--accent-soft)',
      }}
    >
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, alignItems: 'center', gap: 1, px: 2, py: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          🏈 {tickerLine(items[0])}
        </Typography>
      </Box>
      <Box
        sx={{
          display: { xs: 'none', sm: 'inline-flex' },
          gap: 4,
          px: 2,
          py: 1,
          whiteSpace: 'nowrap',
          animation: items.length > 1 ? 'game-center-ticker-scroll 24s linear infinite' : 'none',
          '&:hover': { animationPlayState: 'paused' },
          '@keyframes game-center-ticker-scroll': {
            from: { transform: 'translateX(0)' },
            to: { transform: 'translateX(-50%)' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        {loop.map((item, i) => (
          <Typography key={`${item.playerId}-${i}`} component="span" variant="body2" sx={{ fontWeight: 600 }}>
            🏈 {tickerLine(item)}
          </Typography>
        ))}
      </Box>
    </Paper>
  );
}

function LiveScoringFeed({ items }) {
  return (
    <Paper component="section" variant="outlined" aria-label="Live scoring feed" sx={{ p: 2, mb: 4 }}>
      <Typography variant="h6">Live scoring feed</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Recent scoring plays remain here while you follow the week.
      </Typography>
      {!items.length ? (
        <Typography variant="body2" color="text.secondary">No scoring plays yet.</Typography>
      ) : (
        <Stack spacing={1} divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
          {items.map((item, index) => (
            <Typography key={`${item.playerId}-${index}`} variant="body2">🏈 {tickerLine(item)}</Typography>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function GameCenter() {
  const { leagueId } = useParams();
  const [matchups, setMatchups] = useState([]);
  // viewerTeamId is the per-viewer answer to "which of these Teams is me",
  // delivered on league detail's own response (#112, contract in
  // src/lib/teamIdentity.js). It replaces a lookup through the league-shared
  // rosters payload's `ownerId`: that rebuilt viewer identity out of an
  // account field, and #115 took account fields off league-shared payloads,
  // at which point the old comparison would have matched nothing and every
  // viewer would have lost their hero card with nothing failing to say so.
  const { league, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(leagueId);
  const [rosters, setRosters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weekFilter, setWeekFilter] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [showLive, setShowLive] = useState(false);
  const [ticker, setTicker] = useState([]);
  const socketRef = useRef(null);
  const liveTimeoutRef = useRef(null);
  const weekFilterInitialized = useRef(false);
  // Refs (not state) so the long-lived socket handler below — subscribed once
  // per leagueId — always sees the latest roster map and week filter without
  // having to tear down and rejoin the league room on every render.
  const playerTeamMapRef = useRef(new Map());
  const weekFilterRef = useRef(weekFilter);
  weekFilterRef.current = weekFilter;

  // Ticker plays are attributed to a fantasy team by cross-referencing each
  // scoring player's id against every team's roster — real ownership, not a
  // guess, using the same /rosters fetch already loaded for the hero card.
  useEffect(() => {
    const map = new Map();
    for (const team of rosters) {
      for (const p of team.players || []) {
        map.set(p.id, team.teamName);
      }
    }
    playerTeamMapRef.current = map;
  }, [rosters]);

  useEffect(() => {
    fetchData();
    // fetchData closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setRosters((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, { name: 'teamName' })));
    setMatchups((prev) => prev.map((matchup) => {
      let next = matchup;
      if (Number(matchup.home_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { home_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { home_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { home_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      if (Number(matchup.away_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { away_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { away_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { away_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      return next;
    }));
  }), [leagueId]);

  // Picks the default week once both the matchups fetch and the shared
  // league fetch have settled, whichever order they resolve in.
  useEffect(() => {
    if (weekFilterInitialized.current || loading || leagueLoading) return;
    weekFilterInitialized.current = true;
    setWeekFilter(computeDefaultWeek(league, matchups, weeks));
  }, [loading, leagueLoading, league, matchups, weeks]);

  useEffect(() => {
    // Socket lives for the lifetime of this view; a ref avoids stale closures
    // in the cleanup function below.
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    const joinLeagueRoom = () => {
      newSocket.emit('league:join', { leagueId: Number(leagueId) });
    };

    joinLeagueRoom();

    // Re-join on reconnect so the server re-adds us to the room — otherwise
    // a dropped connection would silently stop delivering scores:updated.
    const offReconnect = onReconnect(newSocket, joinLeagueRoom);

    newSocket.on('scores:updated', (data) => {
      setMatchups((prevMatchups) =>
        prevMatchups.map((m) => {
          const scored = data.scored.find((s) => s.matchupId === m.id);
          if (!scored) return m;
          return { ...m, home_score: scored.homeScore, away_score: scored.awayScore };
        })
      );

      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
      }
      setShowLive(true);
      liveTimeoutRef.current = setTimeout(() => {
        setShowLive(false);
        liveTimeoutRef.current = null;
      }, LIVE_INDICATOR_MS);

      // Only feed the ticker plays from the week currently on screen — a
      // league-wide "All" view takes everything.
      const wf = weekFilterRef.current;
      const matchesWeek = wf === 'All' || wf == null || Number(wf) === Number(data.week);
      if (matchesWeek) {
        const adds = (data.plays || [])
          .filter((p) => p && p.playerId != null && playerTeamMapRef.current.has(p.playerId))
          .map((p) => ({ ...p, teamName: playerTeamMapRef.current.get(p.playerId) }));
        if (adds.length) {
          setTicker((prev) => [...adds, ...prev].slice(0, TICKER_LIMIT));
        }
      }
    });

    return () => {
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
        liveTimeoutRef.current = null;
      }
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      socketRef.current.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [matchupsRes, rostersRes] = await Promise.all([
        apiClient.get(`/api/league/${leagueId}/matchups`),
        // Best-effort: only needed to spot the viewer's own team for the hero
        // card, so a failure here shouldn't take down the rest of the screen.
        apiClient.get(`/api/league/${leagueId}/rosters`).catch(() => ({ data: [] })),
      ]);

      const matchupsData = matchupsRes.data;
      setMatchups(matchupsData);

      const uniqueWeeks = Array.from(
        new Set(matchupsData.map((m) => m.week))
      ).sort((a, b) => a - b);
      setWeeks(uniqueWeeks);

      setRosters(rostersRes.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredMatchups =
    weekFilter === 'All' || weekFilter == null
      ? matchups
      : matchups.filter((m) => m.week === parseInt(weekFilter, 10));

  const heroMatchup = viewerTeamId
    ? filteredMatchups.find(
        (m) => m.home_team_id === viewerTeamId || m.away_team_id === viewerTeamId
      )
    : null;
  const restMatchups = heroMatchup
    ? filteredMatchups.filter((m) => m.id !== heroMatchup.id)
    : filteredMatchups;

  const heroHomeScore = heroMatchup ? Number(heroMatchup.home_score) : 0;
  const heroAwayScore = heroMatchup ? Number(heroMatchup.away_score) : 0;
  const heroHomeWins = heroHomeScore > heroAwayScore;
  const heroAwayWins = heroAwayScore > heroHomeScore;
  const heroWinProb = heroMatchup
    ? matchupWinProbability({
        homeScore: heroHomeScore,
        awayScore: heroAwayScore,
        homeProjectedTotal: 0,
        awayProjectedTotal: 0,
      })
    : null;
  const heroStarted = !!heroMatchup && (
    heroMatchup.final || showLive || heroHomeScore !== 0 || heroAwayScore !== 0
  );

  const weekIndex = weekFilter === 'All' || weekFilter == null ? -1 : weeks.indexOf(weekFilter);

  // Only a first load without a league row blanks the page: a reload of the
  // shared league entry (a clear from elsewhere, a TTL expiry) keeps the page
  // up with the row it already has.
  if (loading || (!league && leagueLoading)) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={280} height={48} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" width={150} height={56} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={180} sx={{ mb: 3, borderRadius: 1 }} />
        <Grid container spacing={2}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Grid xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
            </Grid>
          ))}
        </Grid>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      {(error || leagueError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || leagueError}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Typography variant="h4">
          Game Center {league && `· ${league.name}`}
        </Typography>

        <Stack direction="row" spacing={0.5} alignItems="center">
          <FormControl sx={{ minWidth: 150 }}>
            <InputLabel id="game-center-week-filter-label">Week</InputLabel>
            <Select
              labelId="game-center-week-filter-label"
              value={weekFilter ?? 'All'}
              label="Week"
              onChange={(e) => setWeekFilter(e.target.value)}
            >
              <MenuItem value="All">All</MenuItem>
              {weeks.map((w) => (
                <MenuItem key={w} value={w}>
                  Week {w}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {weekFilter !== 'All' && weekFilter != null && (
            <>
              <IconButton
                aria-label="Previous week"
                onClick={() => setWeekFilter(weeks[weekIndex - 1])}
                disabled={weekIndex <= 0}
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                aria-label="Next week"
                onClick={() => setWeekFilter(weeks[weekIndex + 1])}
                disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          )}
        </Stack>
      </Stack>

      <LiveActionTicker items={ticker} />

      {heroMatchup && (
        <Container maxWidth="md" disableGutters sx={{ mb: 4 }}>
          <Card>
            <CardActionArea component={Link} to={`/league/${leagueId}/matchups/${heroMatchup.id}`}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                    Your Matchup · Week {heroMatchup.week}
                  </Typography>
                  <MatchupStatusChip matchup={heroMatchup} showLive={showLive} />
                </Box>

                {heroStarted && heroWinProb ? (
                  <WinProbabilitySplitBar
                    homeName={heroMatchup.home_team_name}
                    awayName={heroMatchup.away_team_name}
                    homeProb={heroWinProb.home}
                  />
                ) : (
                  <Paper variant="outlined" sx={{ mt: 2, py: 1, px: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                    <Typography variant="body2" color="text.secondary">
                      Not started · Week {heroMatchup.week}
                    </Typography>
                  </Paper>
                )}

                <Grid container spacing={2} alignItems="center" sx={{ mt: 0.5 }}>
                  <Grid xs={5}>
                    <Typography variant="h6" sx={{ fontWeight: heroHomeWins ? 700 : 400 }} noWrap>
                      {heroMatchup.home_team_name}
                    </Typography>
                    <Typography
                      variant="stat"
                      sx={{ fontSize: '1.25rem', fontWeight: heroHomeWins ? 700 : 400, mt: 0.5 }}
                    >
                      {heroHomeScore}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <AbbreviationTooltip term="PMR" />: -
                    </Typography>
                  </Grid>
                  <Grid xs={2} sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      vs
                    </Typography>
                  </Grid>
                  <Grid xs={5} sx={{ textAlign: 'right' }}>
                    <Typography variant="h6" sx={{ fontWeight: heroAwayWins ? 700 : 400 }} noWrap>
                      {heroMatchup.away_team_name}
                    </Typography>
                    <Typography
                      variant="stat"
                      sx={{ fontSize: '1.25rem', fontWeight: heroAwayWins ? 700 : 400, mt: 0.5 }}
                    >
                      {heroAwayScore}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <AbbreviationTooltip term="PMR" />: -
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </CardActionArea>
          </Card>
        </Container>
      )}

      <Container maxWidth="md" disableGutters>
        <Typography variant="h6" sx={{ mb: 2 }}>
          League Matchups
        </Typography>
        <Grid container spacing={2} sx={{ mb: 4 }}>
        {restMatchups.map((matchup) => {
          // pg returns DECIMAL columns as strings — compare numerically
          const homeScore = Number(matchup.home_score);
          const awayScore = Number(matchup.away_score);
          const homeWins = homeScore > awayScore;
          const awayWins = awayScore > homeScore;

          return (
            <Grid xs={12} sm={6} md={4} key={matchup.id}>
              <Card>
                <CardActionArea component={Link} to={`/league/${leagueId}/matchups/${matchup.id}`}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Week {matchup.week}
                      </Typography>
                      <MatchupStatusChip matchup={matchup} showLive={showLive} />
                    </Box>
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamAvatar
                          name={matchup.home_team_name}
                          avatarUrl={matchup.home_team_avatar_url}
                          avatarStaticUrl={matchup.home_team_avatar_static_url}
                          size={28}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: homeWins ? 'bold' : 'normal' }}
                          >
                            {matchup.home_team_name} ({homeScore})
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                            Proj: -
                          </Typography>
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                        vs
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamAvatar
                          name={matchup.away_team_name}
                          avatarUrl={matchup.away_team_avatar_url}
                          avatarStaticUrl={matchup.away_team_avatar_static_url}
                          size={28}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: awayWins ? 'bold' : 'normal' }}
                          >
                            {matchup.away_team_name} ({awayScore})
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                            Proj: -
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
        </Grid>
        {restMatchups.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3, mb: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No other league matchups this week.</Typography>
          </Paper>
        )}
        <LiveScoringFeed items={ticker} />
      </Container>
    </Container>
  );
}

export default GameCenter;
