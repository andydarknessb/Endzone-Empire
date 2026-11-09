const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const pool = require('../modules/pool');

// pg-pool announces each new connection on its 'connect' event. A connection
// that drops while checked out must not reach an 'error' event with no listener
// (Node throws it and the process exits, #1535), so the pool gives every client
// an error listener for its whole life and logs what it hears.
test('a client announced through the connect event can emit error without throwing, and the error is logged', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const client = new EventEmitter();

  pool.emit('connect', client);

  const dropped = new Error('read ECONNRESET');
  assert.doesNotThrow(() => client.emit('error', dropped));
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /postgres client error/);
  assert.equal(logged.mock.calls[0].arguments[1], dropped.message);
});

// pg-pool re-emits an idle client's error on the pool; with no pool listener
// that re-emit throws even though the client listener above already logged it.
test('an idle client error re-emitted on the pool does not throw', (t) => {
  t.mock.method(console, 'error', () => {});
  assert.doesNotThrow(() => pool.emit('error', new Error('idle drop'), new EventEmitter()));
});
