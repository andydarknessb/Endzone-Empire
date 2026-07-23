import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { createDraftSocket, onReconnect } from '../../api/socket';

const initialState = {
  league: null,
  teams: [],
  picks: [],
  onTheClock: null,
  deadline: null, // epoch ms the current pick is due, or null (untimed/paused/inactive)
  secondsLeft: null,
  draftComplete: false,
};

/** Deadline + seconds-left pair for a league snapshot, or nulls when there's no live clock. */
function deadlineFromLeague(league, deadlineAtIso) {
  if (
    league?.draft_status === 'active' &&
    league?.pick_time_seconds > 0 &&
    !league?.draft_paused &&
    deadlineAtIso
  ) {
    const deadline = Date.parse(deadlineAtIso);
    return { deadline, secondsLeft: Math.max(0, Math.floor((deadline - Date.now()) / 1000)) };
  }
  return { deadline: null, secondsLeft: null };
}

function reducer(state, action) {
  switch (action.type) {
    case 'state': {
      const { league, teams, picks, onTheClock } = action.data;
      const { deadline, secondsLeft } = deadlineFromLeague(league, league?.pick_deadline_at);
      return {
        ...state,
        league,
        teams,
        picks: [...picks].reverse(), // history renders newest first
        onTheClock,
        deadline,
        secondsLeft,
      };
    }
    case 'picked': {
      const { data } = action;
      const pick = {
        pick_number: data.pickNumber,
        team_id: data.teamId,
        player_id: data.player.id,
        name: data.player.name,
        position: data.player.position,
        nfl_team: data.player.nfl_team,
        by: data.by,
      };
      const nextOnTheClock = data.nextTeamId
        ? state.teams.find((t) => t.id === data.nextTeamId) || null
        : null;

      // Server sends the new deadline directly; fall back to a client-side
      // estimate (pick_time_seconds from now) if it's ever omitted.
      let deadline = null;
      let secondsLeft = null;
      if (data.pickDeadlineAt) {
        deadline = Date.parse(data.pickDeadlineAt);
        secondsLeft = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      } else if (state.league?.pick_time_seconds > 0) {
        deadline = Date.now() + state.league.pick_time_seconds * 1000;
        secondsLeft = state.league.pick_time_seconds;
      }

      const draftComplete = data.draftComplete ? true : state.draftComplete;
      const league =
        data.draftComplete && state.league ? { ...state.league, draft_status: 'complete' } : state.league;

      return {
        ...state,
        picks: [pick, ...state.picks],
        onTheClock: nextOnTheClock,
        deadline: data.draftComplete ? null : deadline,
        secondsLeft: data.draftComplete ? null : secondsLeft,
        draftComplete,
        league,
      };
    }
    case 'complete':
      return { ...state, draftComplete: true };
    case 'tick': {
      if (
        state.league?.draft_status === 'active' &&
        state.league?.pick_time_seconds > 0 &&
        !state.league?.draft_paused &&
        state.deadline
      ) {
        const secondsLeft = Math.max(0, Math.floor((state.deadline - Date.now()) / 1000));
        return secondsLeft === state.secondsLeft ? state : { ...state, secondsLeft };
      }
      return state.secondsLeft === null ? state : { ...state, secondsLeft: null };
    }
    default:
      return state;
  }
}

/**
 * Owns the draft room socket connection: join/reconnect, the live draft
 * state (league/teams/picks/on-the-clock/pick clock), and the on-clock edge
 * (false -> true) that should trigger a "you're on the clock" alert.
 *
 * All server-pushed updates flow through a reducer, so handlers just
 * dispatch and always act on fresh state — no ref-shadowed copies of
 * teams/league/deadline needed. The on-clock edge is detected separately,
 * off the derived `isMyTurn` value, so it doesn't need a stale-closure-prone
 * team lookup inside the long-lived socket handlers either.
 */
export default function useDraftSocket(leagueId, userId, { onPickLanded } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [error, setError] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [onClockAlertOpen, setOnClockAlertOpen] = useState(false);
  const socketRef = useRef(null);
  // The socket effect below is registered once per leagueId; this ref keeps
  // its 'draft:picked' handler calling the current callback instead of a
  // stale one closed over at mount.
  const onPickLandedRef = useRef(onPickLanded);

  useEffect(() => {
    onPickLandedRef.current = onPickLanded;
  }, [onPickLanded]);

  useEffect(() => {
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    // Shared by the initial connect and every reconnect: re-joins the draft
    // room, which also makes the server push a fresh 'draft:state' snapshot
    // (the resync mechanism for whatever happened while we were offline).
    const joinDraftRoom = () => {
      newSocket.emit('draft:join', { leagueId: Number(leagueId) }, (resp) => {
        if (resp?.error) setError(resp.error);
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

    newSocket.on('draft:state', (data) => {
      dispatch({ type: 'state', data });
    });

    newSocket.on('draft:picked', (data) => {
      dispatch({ type: 'picked', data });
      onPickLandedRef.current?.();
    });

    newSocket.on('draft:complete', () => {
      dispatch({ type: 'complete' });
    });

    return () => {
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  // Ticks the on-the-clock countdown once a second off the reducer's deadline.
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(interval);
  }, []);

  const isMyTurn = !!(
    state.onTheClock &&
    userId != null &&
    state.onTheClock.owner_id != null &&
    state.onTheClock.owner_id === userId
  );

  // Fires the "you're on the clock" alert exactly once per turn: only on the
  // false -> true transition of isMyTurn, guarded by prevIsMyTurnRef so
  // repeated renders/events while it's still your turn don't re-fire it.
  const prevIsMyTurnRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      setOnClockAlertOpen(true);
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  const emitPick = useCallback(
    (playerId, ack) => {
      socketRef.current?.emit('draft:pick', { leagueId: Number(leagueId), playerId }, ack);
    },
    [leagueId]
  );

  const dismissOnClockAlert = useCallback(() => setOnClockAlertOpen(false), []);

  return {
    league: state.league,
    teams: state.teams,
    picks: state.picks,
    onTheClock: state.onTheClock,
    secondsLeft: state.secondsLeft,
    reconnecting,
    isMyTurn,
    draftComplete: state.draftComplete,
    onClockAlertOpen,
    dismissOnClockAlert,
    emitPick,
    error,
  };
}
