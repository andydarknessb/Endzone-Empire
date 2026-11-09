import { EventEmitter } from 'events';
import { openDraftRoomSession } from './useDraftRoomSession';

// A socket is an emitter with a manager emitter beside it, the shape onReconnect
// subscribes through. The room's join is a callback, so the session never emits.
function setup() {
  const socket = new EventEmitter();
  const manager = new EventEmitter();
  socket.io = manager;
  const join = jest.fn();
  const refreshFeed = jest.fn();
  const refreshReads = jest.fn();
  const detach = openDraftRoomSession(socket, { join, refreshFeed, refreshReads });
  return { socket, manager, join, refreshFeed, refreshReads, detach };
}

describe('openDraftRoomSession', () => {
  it('a connect resyncs once: one join, one feed resume, one read refresh', () => {
    const { socket, join, refreshFeed, refreshReads } = setup();

    socket.emit('connect');

    expect(join).toHaveBeenCalledTimes(1);
    expect(refreshFeed).toHaveBeenCalledTimes(1);
    expect(refreshReads).toHaveBeenCalledTimes(1);
  });

  it('a reconnect resyncs once with exactly one join, and the socket connect after it does not join again', () => {
    const { socket, manager, join, refreshFeed, refreshReads } = setup();
    socket.emit('connect');

    manager.emit('reconnect', 1);
    socket.emit('connect');

    expect(join).toHaveBeenCalledTimes(2);
    expect(refreshFeed).toHaveBeenCalledTimes(2);
    expect(refreshReads).toHaveBeenCalledTimes(2);
  });

  it('a revive resyncs once: the revived socket connects, and onReconnect runs the resync', () => {
    const { socket, manager, join } = setup();
    socket.emit('connect');

    // A revived socket connects again (no manager 'reconnect'); socket.js then runs the
    // onReconnect handlers once. The connect itself adds no second join.
    socket.emit('connect');
    manager.emit('reconnect', 0);

    expect(join).toHaveBeenCalledTimes(2);
  });

  it('a draft:state refreshes the reads without rejoining', () => {
    const { socket, join, refreshFeed, refreshReads } = setup();
    socket.emit('connect');

    socket.emit('draft:state', { boardVersion: 3 });

    expect(join).toHaveBeenCalledTimes(1);
    expect(refreshFeed).toHaveBeenCalledTimes(1);
    expect(refreshReads).toHaveBeenCalledTimes(2);
  });

  it('a draft:state whose boardVersion is lower than the held one changes nothing', () => {
    const { socket, refreshReads } = setup();
    socket.emit('draft:state', { boardVersion: 5 });

    socket.emit('draft:state', { boardVersion: 4 });

    expect(refreshReads).toHaveBeenCalledTimes(1);
  });

  it('a draft:state at the held boardVersion refreshes again, as an autodraft toggle does', () => {
    const { socket, refreshReads } = setup();
    socket.emit('draft:state', { boardVersion: 5 });

    socket.emit('draft:state', { boardVersion: 5 });

    expect(refreshReads).toHaveBeenCalledTimes(2);
  });

  it('detach removes every listener it attached', () => {
    const { socket, manager, join, refreshReads, detach } = setup();

    detach();
    socket.emit('connect');
    manager.emit('reconnect', 1);
    socket.emit('draft:state', { boardVersion: 1 });

    expect(join).not.toHaveBeenCalled();
    expect(refreshReads).not.toHaveBeenCalled();
    expect(socket.listenerCount('connect')).toBe(0);
    expect(socket.listenerCount('draft:state')).toBe(0);
    expect(manager.listenerCount('reconnect')).toBe(0);
  });
});
