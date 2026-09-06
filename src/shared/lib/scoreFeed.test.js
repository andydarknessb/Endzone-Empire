import { subscribeToScoreFeed } from './scoreFeed';

// Drive the feed through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, see src/api/socket.js): createDraftSocket
// returns whatever this factory builds, so nothing touches a real connection.
function makeFakeSocket() {
  const handlers = {};
  const ioHandlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: {
      on: jest.fn((event, cb) => { ioHandlers[event] = cb; }),
      off: jest.fn(),
    },
    disconnect: jest.fn(),
    // Test drivers:
    fire: (event, payload) => handlers[event]?.(payload),
    reconnect: () => ioHandlers.reconnect?.(),
  };
}

let socket;

beforeEach(() => {
  socket = makeFakeSocket();
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => socket;
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
  jest.clearAllMocks();
});

test('joins the league room on subscribe', () => {
  subscribeToScoreFeed(7, { onScores: jest.fn(), resync: jest.fn() });
  expect(socket.emit).toHaveBeenCalledWith('league:join', { leagueId: 7 });
});

test('re-joins the room and then resyncs on reconnect', () => {
  const resync = jest.fn();
  subscribeToScoreFeed(7, { onScores: jest.fn(), resync });
  expect(socket.emit).toHaveBeenCalledTimes(1);

  socket.reconnect();

  // A second league:join (the re-join), and the resync callback fired.
  const joins = socket.emit.mock.calls.filter(([event]) => event === 'league:join');
  expect(joins).toHaveLength(2);
  expect(resync).toHaveBeenCalledTimes(1);
});

test('hands the scores:updated event to the subscriber whole', () => {
  const onScores = jest.fn();
  subscribeToScoreFeed(7, { onScores, resync: jest.fn() });

  const event = {
    leagueId: 7,
    season: 2025,
    week: 3,
    scored: [{ matchupId: 5, homeScore: 21, awayScore: 14 }],
    plays: [{ playerId: 99, name: 'Speedy Runner', type: 'rushing', pointsDelta: 6 }],
  };
  socket.fire('scores:updated', event);

  expect(onScores).toHaveBeenCalledTimes(1);
  expect(onScores).toHaveBeenCalledWith(event);
});

test('tears the socket down on unsubscribe', () => {
  const unsubscribe = subscribeToScoreFeed(7, { onScores: jest.fn(), resync: jest.fn() });
  unsubscribe();
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  // The reconnect listener is removed from the manager, which outlives the socket.
  expect(socket.io.off).toHaveBeenCalledWith('reconnect', expect.any(Function));
});
