import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
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
  IconButton,
  Alert,
  CircularProgress,
  Box,
  Grid,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Pagination,
  Snackbar,
  Switch,
  FormControlLabel,
  TextField,
  Stack,
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import Countdown from '../Countdown/Countdown';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';

// Subtle pulse for the on-clock timer once time is running low (<=10s).
const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
`;

/** Plays a short (~200ms) beep via WebAudio so no audio asset is needed. */
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      ctx.close();
    }, 200);
  } catch (err) {
    // Autoplay restrictions or lack of WebAudio support shouldn't break the draft.
  }
}

function DraftBoard() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [picks, setPicks] = useState([]);
  const [onTheClock, setOnTheClock] = useState(null);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [queue, setQueue] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const socketRef = useRef(null);
  const teamsRef = useRef([]);
  const leagueRef = useRef(null);
  const deadlineRef = useRef(null);
  const userIdRef = useRef(user?.id);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [positionFilter, setPositionFilter] = useState('All');
  const [onClockAlertOpen, setOnClockAlertOpen] = useState(false);
  const wasMyTurnRef = useRef(false);
  const [pickTimeSeconds, setPickTimeSeconds] = useState('');
  const [autodraftDelaySeconds, setAutodraftDelaySeconds] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  // Player quick-view: only the viewed id is stored. Whether that player has
  // been drafted (and by whom) is derived live from `picks`/`teams` below, so a
  // pick arriving over the socket while the dialog is open surfaces the banner
  // without any extra state — the board keeps updating behind the overlay.
  const [quickViewId, setQuickViewId] = useState(null);

  useEffect(() => {
    // Socket lives for the lifetime of this view; refs avoid stale closures
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    // Shared by the initial connect and every reconnect: re-joins the draft
    // room, which also makes the server push a fresh 'draft:state' snapshot
    // (the resync mechanism for whatever happened while we were offline).
    const joinDraftRoom = () => {
      newSocket.emit('draft:join', { leagueId: Number(leagueId) }, (resp) => {
        if (resp?.error) {
          setError(resp.error);
        }
      });
    };

    newSocket.on('connect', () => {
      setReconnecting(false);
      joinDraftRoom();
    });

    newSocket.on('disconnect', () => {
      setReconnecting(true);
    });

    // Manager-level: fires after socket.io has re-established a dropped
    // connection (e.g. a phone locking mid-draft). Re-join so we don't miss
    // picks that happened while disconnected.
    const offReconnect = onReconnect(newSocket, joinDraftRoom);

    // Fires the "you're on the clock" toast + beep exactly once per turn: only
    // on the false -> true transition, guarded by wasMyTurnRef so repeated
    // draft:state/draft:picked events while it's still your turn don't re-fire.
    const checkOnClockAlert = (team) => {
      const isMyTurn = !!(team && userIdRef.current != null && team.owner_id === userIdRef.current);
      if (isMyTurn && !wasMyTurnRef.current) {
        setOnClockAlertOpen(true);
        playBeep();
      }
      wasMyTurnRef.current = isMyTurn;
    };

    newSocket.on('draft:state', (data) => {
      const lg = data.league;
      setLeague(lg);
      leagueRef.current = lg;
      setTeams(data.teams);
      teamsRef.current = data.teams;
      setPicks([...data.picks].reverse()); // history renders newest first
      setOnTheClock(data.onTheClock);
      checkOnClockAlert(data.onTheClock);

      if (
        lg?.draft_status === 'active' &&
        lg?.pick_time_seconds > 0 &&
        !lg?.draft_paused &&
        lg?.pick_deadline_at
      ) {
        deadlineRef.current = Date.parse(lg.pick_deadline_at);
        setSecondsLeft(Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000)));
      } else {
        deadlineRef.current = null;
        setSecondsLeft(null);
      }
    });

    newSocket.on('draft:picked', (data) => {
      setPicks((prevPicks) => [
        {
          pick_number: data.pickNumber,
          team_id: data.teamId,
          player_id: data.player.id,
          name: data.player.name,
          position: data.player.position,
          nfl_team: data.player.nfl_team,
          by: data.by,
        },
        ...prevPicks,
      ]);

      const nextOnTheClock = data.nextTeamId
        ? teamsRef.current.find((t) => t.id === data.nextTeamId) || null
        : null;
      setOnTheClock(nextOnTheClock);
      checkOnClockAlert(nextOnTheClock);

      // Server sends the new deadline directly; fall back to a client-side
      // estimate (pick_time_seconds from now) if it's ever omitted.
      if (data.pickDeadlineAt) {
        deadlineRef.current = Date.parse(data.pickDeadlineAt);
        setSecondsLeft(Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000)));
      } else if (leagueRef.current?.pick_time_seconds > 0) {
        deadlineRef.current = Date.now() + leagueRef.current.pick_time_seconds * 1000;
        setSecondsLeft(leagueRef.current.pick_time_seconds);
      } else {
        deadlineRef.current = null;
        setSecondsLeft(null);
      }

      if (data.draftComplete) {
        setSuccessMessage('Draft complete!');
        setLeague((prev) => {
          const next = prev ? { ...prev, draft_status: 'complete' } : prev;
          leagueRef.current = next || leagueRef.current;
          return next;
        });
        deadlineRef.current = null;
        setSecondsLeft(null);
      }

      fetchAvailablePlayers(0);
    });

    newSocket.on('draft:complete', () => {
      setSuccessMessage('Draft complete!');
    });

    fetchInitialData();

    return () => {
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  // Ticks the on-the-clock countdown once a second based on deadlineRef,
  // which is kept fresh by draft:state (server) and draft:picked (client-side reset).
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        leagueRef.current?.draft_status === 'active' &&
        leagueRef.current?.pick_time_seconds > 0 &&
        !leagueRef.current?.draft_paused &&
        deadlineRef.current
      ) {
        setSecondsLeft(Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000)));
      } else {
        setSecondsLeft(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Kept in a ref (not just closed over) so the long-lived socket handlers,
  // registered once per leagueId, always compare against the current user.
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // Pre-fills the commissioner's draft-settings form from the league once
  // it's known, without clobbering in-progress edits on later draft:state pushes.
  useEffect(() => {
    if (league?.draft_status === 'pending' && !settingsSaving) {
      setPickTimeSeconds((prev) => (prev === '' ? String(league.pick_time_seconds ?? '') : prev));
      setAutodraftDelaySeconds((prev) =>
        prev === '' ? String(league.autodraft_delay_seconds ?? '') : prev
      );
    }
  }, [league?.draft_status, league?.pick_time_seconds, league?.autodraft_delay_seconds, settingsSaving]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([fetchAvailablePlayers(0), fetchQueue()]);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailablePlayers = async (pageNum, positionOverride = positionFilter) => {
    try {
      const params = {
        page: pageNum + 1,
        leagueId: Number(leagueId),
        available: true,
      };
      if (positionOverride !== 'All') {
        params.position = positionOverride;
      }

      const res = await apiClient.get('/api/players', { params });
      setAvailablePlayers(res.data.players);
      setTotalPages(res.data.totalPages);
      setPage(pageNum);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await apiClient.get('/api/draft/queue', {
        params: { leagueId: Number(leagueId) },
      });
      setQueue(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const persistQueue = async (nextQueue) => {
    setQueue(nextQueue);
    try {
      await apiClient.put('/api/draft/queue', {
        leagueId: Number(leagueId),
        playerIds: nextQueue.map((p) => p.id),
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      fetchQueue();
    }
  };

  const handleQueuePlayer = (player) => {
    if (queue.some((p) => p.id === player.id)) return;
    persistQueue([...queue, player]);
  };

  const handleMoveUp = (index) => {
    if (index <= 0) return;
    const next = [...queue];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    persistQueue(next);
  };

  const handleMoveDown = (index) => {
    if (index >= queue.length - 1) return;
    const next = [...queue];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    persistQueue(next);
  };

  const handleRemoveFromQueue = (index) => {
    const next = queue.filter((_, i) => i !== index);
    persistQueue(next);
  };

  const handleDraftPlayer = (playerId) => {
    if (socketRef.current) {
      setError(null);
      socketRef.current.emit('draft:pick', { leagueId: Number(leagueId), playerId }, (resp) => {
        if (resp?.error) {
          setError(resp.error);
        }
      });
    }
  };

  const handlePositionFilterChange = (e) => {
    const newPosition = e.target.value;
    setPositionFilter(newPosition);
    setPage(0);
    fetchAvailablePlayers(0, newPosition);
  };

  const handleRandomizeOrder = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/draft/league/${leagueId}/order`, { randomize: true });
      setSuccessMessage('Draft order randomized');
      if (socketRef.current) {
        socketRef.current.emit('draft:join', { leagueId: Number(leagueId) }, (resp) => {
          if (resp?.error) {
            setError(resp.error);
          }
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleTogglePause = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/draft/league/${leagueId}/pause`, {
        paused: !league?.draft_paused,
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  // Server broadcasts a fresh draft:state on success, so there's nothing to
  // hand-update here — the AUTO badge / switch reflect the new state once it arrives.
  const handleToggleAutodraft = async (teamId, enabled) => {
    try {
      setError(null);
      await apiClient.post(`/api/draft/league/${leagueId}/teams/${teamId}/autodraft`, {
        enabled,
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleSaveDraftSettings = async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setSettingsSaving(true);
      await apiClient.put(`/api/league/${leagueId}`, {
        pickTimeSeconds: Number(pickTimeSeconds),
        autodraftDelaySeconds: Number(autodraftDelaySeconds),
      });
      setSuccessMessage('Draft settings saved');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCloseOnClockAlert = () => setOnClockAlertOpen(false);

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  const isCommissioner = !!(league && user && league.owner_id === user.id);
  const isMyTurn = !!(
    onTheClock &&
    user?.id != null &&
    onTheClock.owner_id != null &&
    onTheClock.owner_id === user.id
  );

  // Derive the "Drafted by X" banner for the open quick-view from live draft
  // state: if the viewed player already appears in the pick history, name the
  // team that took them. Recomputes as picks stream in, so a player drafted
  // while the dialog is open shows the banner without disrupting the board.
  const quickViewPick =
    quickViewId != null ? picks.find((p) => p.player_id === quickViewId) : null;
  const quickViewDraftedBy = quickViewPick
    ? teams.find((t) => t.id === quickViewPick.team_id)?.name || null
    : null;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {league?.name || 'Draft Board'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {reconnecting && (
            <Chip label="Reconnecting…" color="default" size="small" variant="outlined" />
          )}
          {onTheClock ? (
            <Chip
              label={`On the clock: ${onTheClock.name} (${onTheClock.owner})`}
              color="primary"
              sx={{ fontWeight: 'bold' }}
            />
          ) : (
            <Chip
              label={league?.draft_status || 'Unknown status'}
              color={
                league?.draft_status === 'complete'
                  ? 'success'
                  : league?.draft_status === 'active'
                  ? 'warning'
                  : 'default'
              }
            />
          )}
          {secondsLeft !== null && (
            <Chip
              label={`⏱ ${secondsLeft}s`}
              color={secondsLeft <= 10 ? 'error' : 'default'}
              sx={{ fontWeight: 'bold' }}
            />
          )}
          {league?.draft_paused && <Chip label="Draft Paused" color="warning" />}
          {isCommissioner && league?.draft_status === 'pending' && (
            <Button variant="outlined" size="small" onClick={handleRandomizeOrder}>
              Randomize Draft Order
            </Button>
          )}
          {isCommissioner && league?.draft_status === 'active' && (
            <Button variant="outlined" size="small" onClick={handleTogglePause}>
              {league?.draft_paused ? 'Resume Draft' : 'Pause Draft'}
            </Button>
          )}
        </Box>
        {league?.draft_status === 'active' && (
          <Paper
            variant="outlined"
            sx={{ mt: 2, p: 3, textAlign: 'center', bgcolor: 'action.hover' }}
          >
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: isMyTurn ? 'primary.main' : 'text.primary' }}>
              {isMyTurn
                ? "Your pick!"
                : onTheClock
                ? `${onTheClock.name} is on the clock`
                : 'Waiting…'}
            </Typography>
            {secondsLeft !== null ? (
              <Typography
                variant="h1"
                data-testid="draft-clock"
                sx={{
                  fontWeight: 'bold',
                  lineHeight: 1.1,
                  color: secondsLeft <= 10 ? 'error.main' : 'text.primary',
                  animation: secondsLeft <= 10 ? `${pulse} 1s ease-in-out infinite` : 'none',
                }}
              >
                {secondsLeft}s
              </Typography>
            ) : league?.draft_paused ? (
              <Typography variant="h6" sx={{ color: 'warning.main' }}>
                Draft paused
              </Typography>
            ) : (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>
                No pick clock
              </Typography>
            )}
          </Paper>
        )}
        {league?.draft_status === 'pending' && league?.draft_date && (
          <Box sx={{ mt: 2 }}>
            <Countdown variant="full" date={league.draft_date} />
          </Box>
        )}
        {league?.draft_status === 'pending' && isCommissioner && (
          <Paper variant="outlined" component="form" onSubmit={handleSaveDraftSettings} sx={{ mt: 2, p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
              Draft Settings
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                label="Pick clock (seconds, 0 = untimed)"
                type="number"
                size="small"
                inputProps={{ min: 0, max: 3600 }}
                value={pickTimeSeconds}
                onChange={(e) => setPickTimeSeconds(e.target.value)}
              />
              <TextField
                label="Autodraft delay (seconds)"
                type="number"
                size="small"
                inputProps={{ min: 1, max: 60 }}
                value={autodraftDelaySeconds}
                onChange={(e) => setAutodraftDelaySeconds(e.target.value)}
              />
              <Button type="submit" variant="contained" size="small" disabled={settingsSaving}>
                Save
              </Button>
            </Stack>
          </Paper>
        )}
      </Box>

      <Snackbar
        open={onClockAlertOpen}
        autoHideDuration={6000}
        onClose={handleCloseOnClockAlert}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseOnClockAlert} severity="info" variant="filled" sx={{ fontWeight: 'bold' }}>
          You&apos;re on the clock!
        </Alert>
      </Snackbar>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Typography variant="h6">Available Players</Typography>
              <FormControl sx={{ minWidth: 120 }}>
                <InputLabel id="draft-position-filter-label">Position</InputLabel>
                <Select
                  labelId="draft-position-filter-label"
                  value={positionFilter}
                  label="Position"
                  onChange={handlePositionFilterChange}
                  size="small"
                >
                  <MenuItem value="All">All</MenuItem>
                  <MenuItem value="QB">QB</MenuItem>
                  <MenuItem value="RB">RB</MenuItem>
                  <MenuItem value="WR">WR</MenuItem>
                  <MenuItem value="TE">TE</MenuItem>
                  <MenuItem value="K">K</MenuItem>
                  <MenuItem value="DEF">DEF</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'primary.main' }}>
                    <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>
                      Name
                    </TableCell>
                    <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>
                      Position
                    </TableCell>
                    <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>
                      NFL Team
                    </TableCell>
                    <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                      Proj
                    </TableCell>
                    <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="center">
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {availablePlayers.map((player) => (
                    <TableRow key={player.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PlayerNameLink
                            name={player.name}
                            playerId={player.id}
                            onOpen={setQuickViewId}
                          />
                          <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
                        </Box>
                      </TableCell>
                      <TableCell>{player.position}</TableCell>
                      <TableCell>{player.nfl_team}</TableCell>
                      <TableCell align="right">
                        {player.projected_points != null ? player.projected_points : '—'}
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          variant="contained"
                          size="small"
                          disabled={!!league?.draft_paused}
                          onClick={() => handleDraftPlayer(player.id)}
                        >
                          Draft
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          sx={{ ml: 1 }}
                          disabled={queue.some((p) => p.id === player.id)}
                          onClick={() => handleQueuePlayer(player)}
                        >
                          Queue
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination
                count={totalPages}
                page={page + 1}
                onChange={(event, value) => fetchAvailablePlayers(value - 1)}
              />
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          {teams.length > 0 && (
            <Paper sx={{ p: 2, mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Draft Order
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {teams.map((team) => {
                  const canToggle =
                    (isCommissioner || team.owner_id === user?.id) &&
                    league?.draft_status !== 'complete';
                  const onClock = onTheClock && onTheClock.id === team.id;
                  return (
                    <Box
                      key={team.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2" sx={{ minWidth: 22, color: 'text.secondary' }}>
                        {team.draft_position != null ? `${team.draft_position}.` : '—'}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: onClock ? 'bold' : 'normal', flexGrow: 1 }}
                      >
                        {team.name}
                        {onClock && ' ⏱'}
                      </Typography>
                      {team.autodraft && <Chip size="small" color="warning" label="AUTO" />}
                      {canToggle && (
                        <Switch
                          size="small"
                          checked={!!team.autodraft}
                          onChange={(e) => handleToggleAutodraft(team.id, e.target.checked)}
                          inputProps={{ 'aria-label': `Autodraft for ${team.name}` }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Paper>
          )}
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Pick History
            </Typography>
            <Box sx={{ maxHeight: '600px', overflowY: 'auto' }}>
              {picks.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No picks yet
                </Typography>
              ) : (
                picks.map((pick) => (
                  <Paper
                    key={`${pick.pick_number}-${pick.player_id}`}
                    sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      #{pick.pick_number}
                    </Typography>
                    <Typography variant="body2">
                      <PlayerNameLink
                        name={pick.name}
                        playerId={pick.player_id}
                        onOpen={setQuickViewId}
                      />{' '}
                      ({pick.position})
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {pick.nfl_team}
                    </Typography>
                    {pick.by && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        by {pick.by.auto ? 'AUTO' : pick.by.username}
                      </Typography>
                    )}
                  </Paper>
                ))
              )}
            </Box>
          </Paper>

          <Paper sx={{ p: 2, mt: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              My Queue
            </Typography>
            {queue.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Queue is empty — add players from the list below.
              </Typography>
            ) : (
              queue.map((player, index) => (
                <Box
                  key={player.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                  }}
                >
                  <Typography variant="body2">
                    {index + 1}.{' '}
                    <PlayerNameLink
                      name={player.name}
                      playerId={player.id}
                      onOpen={setQuickViewId}
                    />{' '}
                    ({player.position})
                  </Typography>
                  <Box>
                    <IconButton
                      size="small"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => handleMoveUp(index)}
                    >
                      ▲
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Move down"
                      disabled={index === queue.length - 1}
                      onClick={() => handleMoveDown(index)}
                    >
                      ▼
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Remove from queue"
                      onClick={() => handleRemoveFromQueue(index)}
                    >
                      ✕
                    </IconButton>
                  </Box>
                </Box>
              ))
            )}
          </Paper>
        </Grid>
      </Grid>

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
        draftedBy={quickViewDraftedBy}
      />
    </Container>
  );
}

export default DraftBoard;
