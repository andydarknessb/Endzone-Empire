import { renderHook, act } from '@testing-library/react';
import { createDraftSocket, onReconnect } from '../../api/socket';
import useDraftSocket from './useDraftSocket';

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

/** A controllable fake socket: captures .on() handlers so tests can fire them. */
function makeFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    io: { on: jest.fn() },
    emit: jest.fn(),
    disconnect: jest.fn(),
    trigger(event, payload) {
      handlers[event]?.(payload);
    },
  };
}

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  onReconnect.mockReturnValue(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});

// Team identity on the wire is `teamId` / `teamName` (#113, contract #112);
// `owner_id` is deliberately absent from these fixtures so a test can only
// pass by reading the Team fields.
const teamA = { id: 1, teamId: 1, teamName: 'Team A', name: 'Team A' };
const teamB = { id: 2, teamId: 2, teamName: 'Team B', name: 'Team B' };

/**
 * Answers the `draft:join` acknowledgement the way the server does. `rest`
 * carries the other per-viewer fields on it, `isCommissioner` today (#178).
 */
function ackJoin(viewerTeamId, rest = {}) {
  const call = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => call[2]({ ok: true, viewerTeamId, ...rest }));
}

/**
 * Refuses the LATEST `draft:join` the way the server does (#230): the message,
 * plus the `code` a client discriminates on. Pass no code for the ack a server
 * older than #230 sends - that case is not a curiosity, it is a client and a
 * server that ship separately.
 */
function refuseJoin(error, code) {
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  const [, , ack] = joins[joins.length - 1];
  act(() => ack(code === undefined ? { error } : { error, code }));
}

test('joins the draft room on connect and emits pick over the socket', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:join', { leagueId: 1 }, expect.any(Function));

  act(() => result.current.emitPick(42, jest.fn()));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:pick', { leagueId: 1, playerId: 42 }, expect.any(Function));
});

test('surfaces a draft:join error acknowledgment', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => ack({ error: 'you are not in this league' }));

  expect(result.current.error).toBe('you are not in this league');
  expect(result.current.viewerTeamId).toBe(null);
});

test('takes viewerTeamId from the draft:join acknowledgement, the only per-viewer channel', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  expect(result.current.viewerTeamId).toBe(null);

  ackJoin(2);
  expect(result.current.viewerTeamId).toBe(2);
});

test('a viewer with no team in this league reads back a null viewerTeamId and is never on the clock', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(null);
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });

  expect(result.current.viewerTeamId).toBe(null);
  expect(result.current.isMyTurn).toBe(false);
});

test('calls onPickLanded (fresh callback, no stale closure) whenever a pick lands', () => {
  const onPickLanded = jest.fn();
  const { rerender } = renderHook(({ cb }) => useDraftSocket(1, { onPickLanded: cb }), {
    initialProps: { cb: onPickLanded },
  });

  const laterCallback = jest.fn();
  rerender({ cb: laterCallback });

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: null,
      draftComplete: false,
      auto: false,
    })
  );

  expect(onPickLanded).not.toHaveBeenCalled();
  expect(laterCallback).toHaveBeenCalledTimes(1);
});

test('a landed pick enters history attributed by Team, carrying no account identity', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      auto: true,
    })
  );

  const [pick] = result.current.picks;
  expect(pick).toEqual({
    pick_number: 1,
    teamId: 1,
    teamName: 'Team A',
    player_id: 10,
    name: 'X',
    position: 'QB',
    nfl_team: 'KC',
    auto: true,
  });
  // The broadcast no longer carries an account `by` object (#344); the autopick
  // flag rides at the root as `auto` and is the only thing carried into state.
  expect(pick).not.toHaveProperty('by');
});

test('fires the on-clock alert exactly once per turn, and again once the turn comes back around', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);

  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  expect(result.current.isMyTurn).toBe(true);
  expect(result.current.onClockAlertOpen).toBe(true);

  act(() => result.current.dismissOnClockAlert());
  expect(result.current.onClockAlertOpen).toBe(false);

  // Another state push while it's still my turn must not reopen the alert.
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  expect(result.current.onClockAlertOpen).toBe(false);

  // Turn passes to the other team.
  act(() => {
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      auto: false,
    });
  });
  expect(result.current.isMyTurn).toBe(false);
  expect(result.current.onClockAlertOpen).toBe(false);

  // ...and comes back to me: a new false -> true edge should re-fire the alert.
  act(() => {
    fakeSocket.trigger('draft:picked', {
      pickNumber: 2,
      teamId: 2,
      teamName: 'Team B',
      player: { id: 11, name: 'Y', position: 'RB', nfl_team: 'SF' },
      nextTeamId: 1,
      draftComplete: false,
      auto: false,
    });
  });
  expect(result.current.isMyTurn).toBe(true);
  expect(result.current.onClockAlertOpen).toBe(true);
});

test('re-joining after a reconnect refreshes viewerTeamId from the new acknowledgement', () => {
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);
  expect(result.current.viewerTeamId).toBe(1);

  act(() => reconnectHandler());
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  expect(joins).toHaveLength(2);
  act(() => joins[1][2]({ ok: true, viewerTeamId: 7 }));
  expect(result.current.viewerTeamId).toBe(7);
});

test('drops the viewer Team when the league changes, rather than carrying it across', () => {
  const { result, rerender } = renderHook(({ leagueId }) => useDraftSocket(leagueId), {
    initialProps: { leagueId: 1 },
  });

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);
  expect(result.current.viewerTeamId).toBe(1);

  // A new league gets a new socket, and the Team the viewer holds is a fact
  // about the league they left, not the one they are joining.
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  rerender({ leagueId: 2 });

  expect(result.current.viewerTeamId).toBe(null);
});

// --- the viewer's commissioner role (#178) ---
//
// The ack is the ONLY source of this flag: the Draft room no longer falls
// back to comparing the snapshot's owner_id against the signed-in account,
// so anything that loses the flag takes a commissioner's controls away mid
// draft. These tests pin the two directions that matters in.

test('surfaces the commissioner flag the acknowledgement carries', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });

  expect(result.current.isCommissioner).toBe(true);
});

test('an ordinary manager is not a commissioner', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: false });

  expect(result.current.isCommissioner).toBe(false);
});

test('an acknowledgement with no commissioner flag reads as false, never as undefined', () => {
  // Only the server may say yes. A missing field is an older or a partial
  // ack, and the safe reading of it is "no", not a value that renders a
  // control by being truthy somewhere downstream.
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);

  expect(result.current.isCommissioner).toBe(false);
});

test('a reconnect re-asks for the commissioner flag and takes the new answer', () => {
  // Every join re-reads it, exactly as viewerTeamId does, so a socket drop
  // mid-draft cannot silently strip a commissioner of their controls - and a
  // grant revoked while they were offline is honoured on the way back in.
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.isCommissioner).toBe(true);

  act(() => fakeSocket.trigger('disconnect'));
  expect(result.current.isCommissioner).toBe(true); // a blip is not a demotion

  act(() => reconnectHandler());
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  expect(joins).toHaveLength(2);
  act(() => joins[1][2]({ ok: true, viewerTeamId: 1, isCommissioner: false }));
  expect(result.current.isCommissioner).toBe(false);
});

test('drops the commissioner flag when the league changes, rather than carrying it across', () => {
  const { result, rerender } = renderHook(({ leagueId }) => useDraftSocket(leagueId), {
    initialProps: { leagueId: 1 },
  });

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.isCommissioner).toBe(true);

  // Commissioner of one league says nothing about the next one.
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  rerender({ leagueId: 2 });

  expect(result.current.isCommissioner).toBe(false);
});

// --- the room's GIF-message capability (#516, from the #446 contract) ---
//
// gifMessagesEnabled rides the SAME per-viewer draft:join ack as isCommissioner
// and viewerTeamId (draftSocket.joinAck), and is read the same way: the ack is
// the sole authority, a missing flag is "off", every join re-reads it, and it is
// torn down with the league. The composer only appears when it is true (AC7), so
// anything that reads it truthy on a partial ack would surface a picker the
// server has not enabled.

test('surfaces the gif-message capability the acknowledgement carries', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { gifMessagesEnabled: true });

  expect(result.current.gifMessagesEnabled).toBe(true);
});

test('an acknowledgement with no gif capability flag reads as false, never as undefined', () => {
  // Only the server may turn the picker on. A missing field is an older or a
  // partial ack, and the safe reading of it is "off" - not a value that could
  // render the composer by being truthy downstream (AC1/AC2, and the AC7 fence).
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);

  expect(result.current.gifMessagesEnabled).toBe(false);
});

test('a non-boolean-true gif flag is not a grant of the capability', () => {
  // Strictly === true, as isCommissioner is: a truthy-but-not-true value (a
  // string, a 1) from a skewed server must not open the picker.
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { gifMessagesEnabled: 'yes' });

  expect(result.current.gifMessagesEnabled).toBe(false);
});

test('a reconnect re-asks for the gif capability and takes the new answer', () => {
  // Every join re-reads it, exactly as isCommissioner does, so the capability
  // being turned on (or off) while offline is honoured on the way back in.
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { gifMessagesEnabled: true });
  expect(result.current.gifMessagesEnabled).toBe(true);

  act(() => reconnectHandler());
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  expect(joins).toHaveLength(2);
  act(() => joins[1][2]({ ok: true, viewerTeamId: 1, gifMessagesEnabled: false }));
  expect(result.current.gifMessagesEnabled).toBe(false);
});

test('drops the gif capability when the league changes, rather than carrying it across', () => {
  const { result, rerender } = renderHook(({ leagueId }) => useDraftSocket(leagueId), {
    initialProps: { leagueId: 1 },
  });

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { gifMessagesEnabled: true });
  expect(result.current.gifMessagesEnabled).toBe(true);

  // The capability is a fact about the league config just left; a new league
  // room answers its own ack before the picker may reappear.
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  rerender({ leagueId: 2 });

  expect(result.current.gifMessagesEnabled).toBe(false);
});

// --- a refused re-join, and what it is allowed to take away (#230) ---
//
// The room re-joins on every reconnect, so a refusal is the only news it
// ever gets that the viewer no longer holds a Team here. Exactly one refusal
// means that - NOT_A_MEMBER - and it is the only one that may clear the two
// viewer-relative values. A transient failure must not: it arrives on a
// reconnect blip, and clearing on it flickers a manager's own controls off
// and back on. Triage rejected that as worse than a stale display.
//
// EVERY TEST HERE JOINS SUCCESSFULLY FIRST, which is the whole ticket. The
// older 'surfaces a draft:join error acknowledgment' test reads back a null
// viewerTeamId after an error too, but only because it never held one - it is
// evidence about this behaviour in neither direction, and its green must not
// be mistaken for cover.

test('a NOT_A_MEMBER refusal clears the viewer’s Team and their commissioner flag', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.viewerTeamId).toBe(1);
  expect(result.current.isCommissioner).toBe(true);

  refuseJoin('you are not in this league', 'NOT_A_MEMBER');

  expect(result.current.viewerTeamId).toBe(null);
  expect(result.current.isCommissioner).toBe(false);
  expect(result.current.error).toBe('you are not in this league');
});

test('a JOIN_FAILED refusal surfaces the error and leaves both values standing', () => {
  // The server threw. That says nothing about whether this viewer is still a
  // manager here, so the room keeps showing what it last knew.
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });

  refuseJoin('failed to join draft room', 'JOIN_FAILED');

  expect(result.current.viewerTeamId).toBe(1);
  expect(result.current.isCommissioner).toBe(true);
  expect(result.current.error).toBe('failed to join draft room');
});

test('a refusal carrying NO code leaves both values standing, as an older server’s does', () => {
  // A client and a server ship separately, so an ack with no code is a real
  // payload and not a hypothetical. The safe reading of it is the same as any
  // other non-membership failure: surface the error, take nothing away. This
  // is the case a later refactor is most likely to break, by treating "not a
  // success" as "not a member".
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });

  refuseJoin('you are not in this league');

  expect(result.current.viewerTeamId).toBe(1);
  expect(result.current.isCommissioner).toBe(true);
  expect(result.current.error).toBe('you are not in this league');
});

test('a refusal carrying an UNRECOGNISED code surfaces the error and leaves both values standing', () => {
  // #265. The rename is only affordable because of this branch, so it is
  // proven here rather than merely preserved. A code this client has never
  // heard of is read exactly like a missing one: the error surfaces, and
  // nothing that says who this viewer is goes away. Anything else, and a code
  // added on the server alone would strip a manager's own controls off the
  // screen on every reconnect until the client caught up.
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });

  refuseJoin('the draft room is closed for maintenance', 'ROOM_CLOSED');

  expect(result.current.viewerTeamId).toBe(1);
  expect(result.current.isCommissioner).toBe(true);
  expect(result.current.error).toBe('the draft room is closed for maintenance');
});

test('a refusal carrying the pre-#265 lowercase not_a_member leaves both values standing', () => {
  // The deploy skew #265 accepts, written down rather than assumed. A client
  // and a server ship separately, so for one window this client meets a server
  // still emitting the lowercase spelling. That refusal is now unrecognised,
  // which lands it in the branch above: the room keeps showing a Team it has
  // no fresh news about for that window, instead of clearing an identity on a
  // code it cannot read. Stale beats wrongly cleared, and that trade is the
  // whole reason renaming a shipped wire contract was affordable.
  //
  // This one has an expiry the test above does not: once both sides are past
  // the rename, no server emits this string, and it becomes an ordinary
  // unrecognised code. Delete it then, and keep the ROOM_CLOSED test, which
  // is the branch itself rather than one window's instance of it.
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });

  refuseJoin('you are not in this league', 'not_a_member');

  expect(result.current.viewerTeamId).toBe(1);
  expect(result.current.isCommissioner).toBe(true);
  expect(result.current.error).toBe('you are not in this league');
});

test('a reconnect refused with NOT_A_MEMBER clears what the first join granted', () => {
  // The shape the bug actually takes: the viewer was removed from the league
  // while sitting in the room, and finds out on the re-join a dropped socket
  // forces. Nothing else in the room ever revisits either value.
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  act(() => fakeSocket.trigger('disconnect'));
  expect(result.current.isCommissioner).toBe(true); // a blip is not a removal

  act(() => reconnectHandler());
  refuseJoin('you are not in this league', 'NOT_A_MEMBER');

  expect(result.current.viewerTeamId).toBe(null);
  expect(result.current.isCommissioner).toBe(false);
});

test('disconnects the socket on unmount', () => {
  const { unmount } = renderHook(() => useDraftSocket(1));
  unmount();
  expect(fakeSocket.disconnect).toHaveBeenCalled();
});

// --- the room's one connection, exposed so chat can ride it (#433) ---
//
// The Draft room is already in the `league:${id}` room its draft:join put it
// in, which is exactly the room league chat broadcasts to. Exposing this one
// authenticated session lets the room carry chat over it rather than mounting
// a second connection (#433 acceptance criterion 3).

test('exposes the live draft session so another concern can share it', () => {
  const { result } = renderHook(() => useDraftSocket(1));
  // The socket is created on mount, before the first connect, so a consumer
  // can attach to it as soon as the room renders.
  expect(result.current.socket).toBe(fakeSocket);
});

test('swaps the exposed socket when the league changes, never handing back the old one', () => {
  const { result, rerender } = renderHook(({ leagueId }) => useDraftSocket(leagueId), {
    initialProps: { leagueId: 1 },
  });
  expect(result.current.socket).toBe(fakeSocket);

  // A new league gets a new session, and the old socket is torn down.
  const nextSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(nextSocket);
  rerender({ leagueId: 2 });

  expect(fakeSocket.disconnect).toHaveBeenCalled();
  expect(result.current.socket).toBe(nextSocket);
});

// --- the viewer-relative membership tri-state that gates league chat (#534) ---
//
// Chat mounts (and issues its combined-feed request) only for a CONFIRMED
// member. The three states exist so "not yet known" is told apart from "known
// non-member": before the join ack both would read as a null Team, and mounting
// on the first is the whole bug. The authority rule is the join handler's, read
// off the code and never the message: only NOT_A_MEMBER is a non-member.

test('membership is UNKNOWN before any join acknowledgement, so nothing mounts yet', () => {
  const { result } = renderHook(() => useDraftSocket(1));
  act(() => fakeSocket.trigger('connect'));
  // The socket exists and the join is in flight, but membership is undecided.
  expect(result.current.socket).toBe(fakeSocket);
  expect(result.current.membership).toBe('unknown');
});

test('a successful join acknowledgement confirms membership', () => {
  const { result } = renderHook(() => useDraftSocket(1));
  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: false });
  expect(result.current.membership).toBe('member');
});

test('a NOT_A_MEMBER refusal makes the viewer an authoritative non-member', () => {
  const { result } = renderHook(() => useDraftSocket(1));
  act(() => fakeSocket.trigger('connect'));
  refuseJoin('you are not in this league', 'NOT_A_MEMBER');
  expect(result.current.membership).toBe('non_member');
});

test.each([
  ['JOIN_FAILED', 'failed to join draft room', 'JOIN_FAILED'],
  ['an unknown code', 'closed for maintenance', 'ROOM_CLOSED'],
  ['no code (older server)', 'you are not in this league', undefined],
  ['the pre-#265 lowercase spelling', 'you are not in this league', 'not_a_member'],
])('a refusal with %s preserves a confirmed member and still surfaces the error (#534 AC5)', (_label, message, code) => {
  const { result } = renderHook(() => useDraftSocket(1));
  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.membership).toBe('member');

  refuseJoin(message, code);

  // The direction a careless implementation breaks: a blip must not strip a
  // genuine member of chat. The error still surfaces.
  expect(result.current.membership).toBe('member');
  expect(result.current.error).toBe(message);
});

test('a reconnect refused with NOT_A_MEMBER revokes a member confirmed on the first join', () => {
  // The removed-mid-draft case learned on the re-join a dropped socket forces.
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.membership).toBe('member');

  act(() => fakeSocket.trigger('disconnect'));
  expect(result.current.membership).toBe('member'); // a blip is not a removal

  act(() => reconnectHandler());
  refuseJoin('you are not in this league', 'NOT_A_MEMBER');
  expect(result.current.membership).toBe('non_member');
});

test('revokeMembership records a mid-session non-member result without a reload (#534 AC4)', () => {
  // The seam chat:send and the member-only feed call when the server tells a
  // confirmed member their Team is gone. Stable identity so feed listeners never
  // re-subscribe on it.
  const { result, rerender } = renderHook(() => useDraftSocket(1));
  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: true });
  expect(result.current.membership).toBe('member');

  const firstRevoke = result.current.revokeMembership;
  act(() => result.current.revokeMembership());
  expect(result.current.membership).toBe('non_member');

  rerender();
  expect(result.current.revokeMembership).toBe(firstRevoke);
});

test('membership resets to UNKNOWN when the league changes', () => {
  const { result, rerender } = renderHook(({ leagueId }) => useDraftSocket(leagueId), {
    initialProps: { leagueId: 1 },
  });
  act(() => fakeSocket.trigger('connect'));
  ackJoin(1, { isCommissioner: false });
  expect(result.current.membership).toBe('member');

  const nextSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(nextSocket);
  rerender({ leagueId: 2 });

  // The new room has answered nothing yet; a member's chat must not carry over.
  expect(result.current.membership).toBe('unknown');
});
