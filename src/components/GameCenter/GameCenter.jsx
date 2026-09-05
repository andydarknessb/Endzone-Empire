import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Chip,
  IconButton,
  Skeleton,
  Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { visuallyHidden } from '@mui/utils';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { matchupWinProbability } from '../../lib/winProbability';
import { computeDefaultWeek } from '../../lib/matchupWeek';
import { playLabel } from '../../lib/scoringEvents';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import { useLeagueMatchups, matchupStatusView } from '../../entities/matchup';
import TeamAvatar from '../common/TeamAvatar';
import AbbreviationTooltip, { STAT_DEFINITIONS } from '../common/AbbreviationTooltip';

/**
 * The Matchup status chip, read from the entity's one status predicate (ADR
 * 0030). The four server values map to a chip; a status the server could not
 * compute (null) renders NO chip, never a guessed "Scheduled" beside a live
 * score - the timer that used to light every card for ten seconds is gone.
 */
function StatusChip({ status }) {
  const { chipLabel } = matchupStatusView(status);
  if (!chipLabel) return null;
  const color = status === 'final' ? 'success' : status === 'live' ? 'error' : 'default';
  const variant = status === 'live' || status === 'final' ? 'filled' : 'outlined';
  return <Chip size="small" label={chipLabel} color={color} variant={variant} />;
}

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
 * League-wide scoring ticker. Fed by the same `scores:updated` score feed the
 * Matchup hook holds (its `onScores`) — `items` are real typed TD plays (see
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

/**
 * One team's expected final as the model reports it (`expectedFinal`, number or
 * null): its projection until its starters kick off, then points so far plus
 * what each starter still in play is expected to add, until it is the score. The
 * label stays "Proj" throughout, the way every fantasy app labels the moving
 * number; the tooltip term carries the definition. A number shows to one
 * decimal, matching Matchup Detail; null keeps a muted dash, since "no
 * lineup yet" is a real state and not a zero. Callers hide it once the
 * matchup is final: a settled game has a score, not a forecast.
 */
/** Players remaining as the model reports it (integer or null): the count, or a dash. */
function playersRemainingLabel(value) {
  return value != null && Number.isFinite(Number(value)) ? String(Number(value)) : '-';
}

function ProjectedCaption({ value, align = 'left' }) {
  const known = value != null && Number.isFinite(Number(value));
  return (
    <Tooltip title={STAT_DEFINITIONS['Expected final']} enterTouchDelay={0}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          textAlign: align,
          color: known ? 'text.secondary' : 'text.disabled',
          fontStyle: known ? 'normal' : 'italic',
        }}
      >
        {known ? `Proj: ${Number(value).toFixed(1)}` : 'Proj: -'}
        {/* The tooltip needs a pointer; this carries the same definition to a
            screen reader without adding a Tab stop inside the card link,
            the way AbbreviationTooltip does with its label (#212). */}
        <Box component="span" sx={visuallyHidden}>. {STAT_DEFINITIONS['Expected final']}</Box>
      </Typography>
    </Tooltip>
  );
}

function GameCenter() {
  const { leagueId } = useParams();
  // viewerTeamId is the per-viewer answer to "which of these Teams is me",
  // delivered on league detail's own response (#112, contract in
  // src/lib/teamIdentity.js). It replaces a lookup through the league-shared
  // rosters payload's `ownerId`: that rebuilt viewer identity out of an
  // account field, and #115 took account fields off league-shared payloads,
  // at which point the old comparison would have matched nothing and every
  // viewer would have lost their hero card with nothing failing to say so.
  const { league, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(leagueId);
  const [rosters, setRosters] = useState([]);
  const [weekFilter, setWeekFilter] = useState(null);
  const [ticker, setTicker] = useState([]);
  const weekFilterInitialized = useRef(false);
  // Refs (not state) so the score feed's onScores callback — one per leagueId —
  // always sees the latest roster map and week filter without re-subscribing.
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

  // The league's Matchups as read models, with the score feed and the Team
  // identity feed composed over the pure module (entities/matchup). The whole
  // score event is handed here so the ticker can keep its own week filter;
  // the models themselves are refreshed inside the hook, never per card.
  const handleScores = useCallback((data) => {
    const wf = weekFilterRef.current;
    const matchesWeek = wf === 'All' || wf == null || Number(wf) === Number(data?.week);
    if (!matchesWeek) return;
    const adds = (data?.plays || [])
      .filter((p) => p && p.playerId != null && playerTeamMapRef.current.has(p.playerId))
      .map((p) => ({ ...p, teamName: playerTeamMapRef.current.get(p.playerId) }));
    if (adds.length) {
      setTicker((prev) => [...adds, ...prev].slice(0, TICKER_LIMIT));
    }
  }, []);

  const { matchups, loading, error } = useLeagueMatchups(leagueId, { onScores: handleScores });

  // Best-effort roster load: only needed to attribute ticker plays to a team,
  // so a failure here never takes down the rest of the screen.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/api/league/${leagueId}/rosters`)
      .then((res) => { if (!cancelled) setRosters(res.data || []); })
      .catch(() => { if (!cancelled) setRosters([]); });
    return () => { cancelled = true; };
  }, [leagueId]);

  // Keep the roster attribution map's team names fresh when a Team renames,
  // so the ticker never shows a stale name. The matchup cards get their own
  // identity patch inside the hook (entities/matchup).
  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setRosters((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, { name: 'teamName' })));
  }), [leagueId]);

  const weeks = Array.from(new Set(matchups.map((m) => m.week))).sort((a, b) => a - b);

  // Picks the default week once both the matchups fetch and the shared
  // league fetch have settled, whichever order they resolve in.
  useEffect(() => {
    if (weekFilterInitialized.current || loading || leagueLoading) return;
    weekFilterInitialized.current = true;
    setWeekFilter(computeDefaultWeek(league, matchups, weeks));
    // weeks/matchups are derived from the same settled fetch; leaving them off
    // avoids re-picking the week on every later live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, leagueLoading, league]);

  const filteredMatchups =
    weekFilter === 'All' || weekFilter == null
      ? matchups
      : matchups.filter((m) => m.week === parseInt(weekFilter, 10));

  const heroMatchup = viewerTeamId
    ? filteredMatchups.find(
        (m) => m.home.teamId === viewerTeamId || m.away.teamId === viewerTeamId
      )
    : null;
  const restMatchups = heroMatchup
    ? filteredMatchups.filter((m) => m.id !== heroMatchup.id)
    : filteredMatchups;

  const heroHomeScore = heroMatchup ? Number(heroMatchup.home.score) : 0;
  const heroAwayScore = heroMatchup ? Number(heroMatchup.away.score) : 0;
  const heroHomeWins = heroHomeScore > heroAwayScore;
  const heroAwayWins = heroAwayScore > heroHomeScore;
  const heroWinProb = heroMatchup
    ? matchupWinProbability({
        homeScore: heroHomeScore,
        awayScore: heroAwayScore,
        homeExpectedFinal: heroMatchup.home.expectedFinal,
        awayExpectedFinal: heroMatchup.away.expectedFinal,
      })
    : null;
  // Whether the hero matchup has started is the server's status fact, never a
  // score-arrived timer (ADR 0030). `true` shows the win-probability bar,
  // `false` shows the pre-kickoff panel, and `null` (the server could not say)
  // asserts neither.
  const heroStarted = heroMatchup ? matchupStatusView(heroMatchup.status).hasStarted : null;

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
                  <StatusChip status={heroMatchup.status} />
                </Box>

                {heroStarted === true ? (
                  <WinProbabilitySplitBar
                    homeName={heroMatchup.home.name}
                    awayName={heroMatchup.away.name}
                    homeProb={heroWinProb.home}
                  />
                ) : heroStarted === false ? (
                  <Paper variant="outlined" sx={{ mt: 2, py: 1, px: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                    <Typography variant="body2" color="text.secondary">
                      Not started · Week {heroMatchup.week}
                    </Typography>
                  </Paper>
                ) : null}

                <Grid container spacing={2} alignItems="center" sx={{ mt: 0.5 }}>
                  <Grid xs={5}>
                    <Typography variant="h6" sx={{ fontWeight: heroHomeWins ? 700 : 400 }} noWrap>
                      {heroMatchup.home.name}
                    </Typography>
                    <Typography
                      variant="stat"
                      sx={{ fontSize: '1.25rem', fontWeight: heroHomeWins ? 700 : 400, mt: 0.5 }}
                    >
                      {heroHomeScore}
                    </Typography>
                    {!heroMatchup.final && <ProjectedCaption value={heroMatchup.home.expectedFinal} />}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <AbbreviationTooltip term="PMR" />: {playersRemainingLabel(heroMatchup.home.playersRemaining)}
                    </Typography>
                  </Grid>
                  <Grid xs={2} sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      vs
                    </Typography>
                  </Grid>
                  <Grid xs={5} sx={{ textAlign: 'right' }}>
                    <Typography variant="h6" sx={{ fontWeight: heroAwayWins ? 700 : 400 }} noWrap>
                      {heroMatchup.away.name}
                    </Typography>
                    <Typography
                      variant="stat"
                      sx={{ fontSize: '1.25rem', fontWeight: heroAwayWins ? 700 : 400, mt: 0.5 }}
                    >
                      {heroAwayScore}
                    </Typography>
                    {!heroMatchup.final && <ProjectedCaption value={heroMatchup.away.expectedFinal} align="right" />}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <AbbreviationTooltip term="PMR" />: {playersRemainingLabel(heroMatchup.away.playersRemaining)}
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
          // pg returns DECIMAL scores as strings — compare numerically
          const homeScore = Number(matchup.home.score);
          const awayScore = Number(matchup.away.score);
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
                      <StatusChip status={matchup.status} />
                    </Box>
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamAvatar
                          name={matchup.home.name}
                          avatarUrl={matchup.home.avatarUrl}
                          avatarStaticUrl={matchup.home.avatarStaticUrl}
                          size={28}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: homeWins ? 'bold' : 'normal' }}
                          >
                            {matchup.home.name} ({homeScore})
                          </Typography>
                          {!matchup.final && <ProjectedCaption value={matchup.home.expectedFinal} />}
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                        vs
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamAvatar
                          name={matchup.away.name}
                          avatarUrl={matchup.away.avatarUrl}
                          avatarStaticUrl={matchup.away.avatarStaticUrl}
                          size={28}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: awayWins ? 'bold' : 'normal' }}
                          >
                            {matchup.away.name} ({awayScore})
                          </Typography>
                          {!matchup.final && <ProjectedCaption value={matchup.away.expectedFinal} />}
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
