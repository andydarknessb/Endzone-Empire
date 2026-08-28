import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { MEMBERSHIP_UNKNOWN, MEMBERSHIP_NON_MEMBER, membershipAfterJoinAck } from './draftMembership';

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
      // A Pick is attributed by Team (#113, contract #112): `teamId` and
      // `teamName` come straight off the broadcast. The account `by` object
      // (the picking manager's id and username) is gone from the wire (#344,
      // #115 child C); the one non-account fact it used to carry, the autopick
      // flag, now rides at the root of the broadcast as `auto`.
      const pick = {
        pick_number: data.pickNumber,
        teamId: data.teamId,
        teamName: data.teamName ?? null,
        player_id: data.player.id,
        name: data.player.name,
        position: data.player.position,
        nfl_team: data.player.nfl_team,
        auto: !!data.auto,
      };
      const nextOnTheClock = data.nextTeamId
        ? state.teams.find((t) => t.teamId === data.nextTeamId) || null
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
 *
 * It also owns the viewer-relative half of the Team identity contract (#113,
 * contract #112): `viewerTeamId` is the viewer's own Team on this league, and
 * it can only come from the `draft:join` acknowledgement, which is answered to
 * one socket. It deliberately never rides on `draft:state`, `draft:picked` or
 * `draft:presence`, because one of those payloads is broadcast to the whole
 * league room and no viewer-relative field on it could be true for every
 * recipient. The server answers the ack BEFORE the first snapshot, so this
 * hook knows its own Team before it holds any Team identity to compare it
 * against, and "which one of these is me" is `entry.teamId === viewerTeamId`
 * rather than any comparison of account ids.
 *
 * `isCommissioner` is the room's other per-viewer fact and travels the same
 * way, on the same ack, for the same reason (#178): the server decides it
 * with the predicate every commissioner-gated route authorizes with, so the
 * owner and a co-commissioner answer alike. It could never have come off
 * `draft:state`, whose league is a bare `SELECT *` on `leagues` - the room
 * used to ask that row for an `is_commissioner` it has no column for, and
 * silently fell through to an owner-only account comparison.
 *
 * The room reads this and nothing else - there is no client-side fallback to
 * fall back to - which makes re-reading it on EVERY join, not just the
 * first, the load-bearing part: a dropped socket mid-draft must not quietly
 * take a commissioner's controls away.
 *
 * A REFUSED join is read the same way, off its `code` and never its message:
 * only `NOT_A_MEMBER` clears these two, and every other refusal - unknown
 * codes and no code included - leaves them standing (#230, the codes renamed
 * to SCREAMING_SNAKE in #265, and the join handler below for why).
 */
export default function useDraftSocket(leagueId, { onPickLanded } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [error, setError] = useState(null);
  const [viewerTeamId, setViewerTeamId] = useState(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  // Whether GIF messages are enabled in this league room (#516), decided by the
  // server on the SAME per-viewer draft:join ack that carries isCommissioner
  // (#446, AC7) - the composer's sole authority, never inferred client-side, so
  // the picker stays absent in production until external approval turns the
  // capability on (enabling it in production is out of scope for #516). Off by
  // default and read strictly === true below.
  const [gifMessagesEnabled, setGifMessagesEnabled] = useState(false);
  // The viewer-relative membership tri-state that gates league chat in the room
  // (#534): UNKNOWN before the first join ack, MEMBER on a success ack,
  // NON_MEMBER only on the authoritative NOT_A_MEMBER refusal. It is a state of
  // its own, not derived from viewerTeamId, precisely so "not yet known" and
  // "known non-member" are told apart - both would read as a null Team. The
  // chat subtree (and so its combined-feed request) mounts only for MEMBER, so
  // UNKNOWN issues nothing (#534 AC1). Driven by the code, never the message.
  const [membership, setMembership] = useState(MEMBERSHIP_UNKNOWN);
  const [reconnecting, setReconnecting] = useState(false);
  const [onClockAlertOpen, setOnClockAlertOpen] = useState(false);
  // The live session, exposed so another concern in the room can ride it. The
  // room's draft:join already puts this socket in the `league:${id}` room that
  // carries league chat, so chat rides this one authenticated connection
  // rather than mounting a second (#433). Kept in state, not just the ref
  // below, so a consumer re-renders onto the new socket when the league (and
  // so the socket) changes. The ref stays for the socket-effect internals and
  // emitPick, which must read the current socket without re-subscribing.
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  // The socket effect below is registered once per leagueId; this ref keeps
  // its 'draft:picked' handler calling the current callback instead of a
  // stale one closed over at mount.
  const onPickLandedRef = useRef(onPickLanded);

  useEffect(() => {
    onPickLandedRef.current = onPickLanded;
  }, [onPickLanded]);

  useEffect(() => {
    // Which Team the viewer holds is a fact about THIS league, so it is torn
    // down with the socket that answered it. Nothing can match a stale one
    // (a Team ID is unique across leagues), but leaving it standing would
    // mean the hook briefly reported a Team for a league it had left.
    setViewerTeamId(null);
    // Same reasoning, and the same tear-down: holding a commissioner's role
    // over from the league just left would offer this viewer controls on a
    // league where they may hold none.
    setIsCommissioner(false);
    // Same tear-down: the GIF capability is a fact about the league config just
    // left, so the picker must not linger into a room that has not answered yet.
    setGifMessagesEnabled(false);
    // Membership is a fact about THIS league; a new room is UNKNOWN until its own
    // join acknowledgement lands. Resetting here is also what keeps a member's
    // chat from flashing over during a league switch before the new ack decides.
    setMembership(MEMBERSHIP_UNKNOWN);
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;
    setSocket(newSocket);

    // Shared by the initial connect and every reconnect: re-joins the draft
    // room, which also makes the server push a fresh 'draft:state' snapshot
    // (the resync mechanism for whatever happened while we were offline).
    const joinDraftRoom = () => {
      newSocket.emit('draft:join', { leagueId: Number(leagueId) }, (resp) => {
        // Membership follows the same code-authoritative rule as the two values
        // below, decided in one place (draftMembership): a success confirms a
        // member, NOT_A_MEMBER is the only refusal that moves to non-member, and
        // every other refusal preserves what we last knew (#534 AC5). This runs
        // on every reconnect, so the preserve branch is what stops a blip from
        // flickering a member's chat away.
        setMembership((prev) => membershipAfterJoinAck(prev, resp));
        if (resp?.error) {
          setError(resp.error);
          // The refusal's CODE decides whether the two viewer-relative values
          // survive it, and nothing else does - never the message, which is
          // copy and differs per room on the generic failure (#230).
          //
          // 'NOT_A_MEMBER' is the one refusal that is a statement about this
          // viewer: they hold no Team in this league, so the Team and the
          // commissioner flag they were shown are now false and go. Every
          // other refusal - and an ack whose code this client does not
          // recognise, or carries none at all, which is what a server older
          // than #230 sends - says the ATTEMPT failed, not that the viewer
          // lost anything, and the room keeps what it last knew. This runs on
          // every reconnect, so clearing on a transient failure would flicker
          // a manager's own controls off and back on a blip.
          //
          // That unrecognised-code branch is also what made #265's rename of
          // these codes affordable; ADR 0008 carries the reasoning and the
          // convention, and useDraftSocket.test.js pins both halves.
          if (resp.code === 'NOT_A_MEMBER') {
            setViewerTeamId(null);
            setIsCommissioner(false);
            // A viewer with no Team here has no composer to gate; clear the
            // capability alongside the other viewer-relative values so a picker
            // cannot outlive the membership it was answered for.
            setGifMessagesEnabled(false);
          }
          return;
        }
        // Re-read on every join, not just the first: a reconnect re-runs this
        // and the answer is the authority on which Team the viewer is and on
        // whether they may act as commissioner here. Strictly `=== true`: an
        // ack that says nothing about the role is not a grant of it.
        setViewerTeamId(resp?.viewerTeamId ?? null);
        setIsCommissioner(resp?.isCommissioner === true);
        // Re-read on every join, the same as isCommissioner: the ack is the sole
        // authority on the GIF picker (#516). Strictly `=== true` - an ack that
        // says nothing about the capability, or a truthy-but-not-true value from
        // a skewed server, is not a grant of it.
        setGifMessagesEnabled(resp?.gifMessagesEnabled === true);
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
      // Passes the raw payload (notably `teamId`) through so a caller can
      // tell whether THIS pick is relevant to it, rather than treating every
      // pick in the draft as equally actionable.
      onPickLandedRef.current?.(data);
    });

    newSocket.on('draft:complete', () => {
      dispatch({ type: 'complete' });
    });

    return () => {
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      newSocket.disconnect();
      socketRef.current = null;
      // Re-run on a league change (this cleanup, then a fresh effect) swaps the
      // exposed socket to the new one; on unmount React drops the value with
      // the component, so there is no stale session to hand back either way.
      setSocket(null);
    };
  }, [leagueId]);

  // Ticks the on-the-clock countdown once a second off the reducer's deadline.
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(interval);
  }, []);

  const isMyTurn = !!(
    state.onTheClock &&
    viewerTeamId != null &&
    state.onTheClock.teamId != null &&
    state.onTheClock.teamId === viewerTeamId
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

  // The two OTHER channels that revoke a confirmed member mid-draft (#534 AC4):
  // a NOT_A_MEMBER acknowledgement from chat:send, and a 403 from the member-only
  // combined feed. The feed hook classifies each authoritatively (draftMembership)
  // and calls this; here it just records the non-member result, which unmounts the
  // chat subtree without a reload. Stable identity so the feed hook's listeners
  // never re-subscribe on it.
  const revokeMembership = useCallback(() => setMembership(MEMBERSHIP_NON_MEMBER), []);

  return {
    socket,
    league: state.league,
    teams: state.teams,
    picks: state.picks,
    onTheClock: state.onTheClock,
    viewerTeamId,
    isCommissioner,
    gifMessagesEnabled,
    membership,
    revokeMembership,
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
