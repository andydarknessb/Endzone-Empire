const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

// #1537: server.js's fatal and signal handlers used to run shutdown() and
// only set `process.exitCode`, which only takes effect once the event loop
// drains — the same gap #1535 fixed for the worker. This pins that the API
// is now wired to the same shared handler (server/modules/processHandlers.js):
// a fatal event on an injected `proc` runs the API's OWN shutdown (through
// pool.end and closeRedis, mocked here) and then exits, exactly as the
// worker's counterpart in server/test/worker.lifecycle.test.js does.

const pool = require('../modules/pool');
const redis = require('../modules/redis');

// Mocked before requiring ../server: server.js reaches these through the
// module objects (not destructured), the same seam server/worker.js already
// uses, so a mock applied at any point before shutdown() runs is honoured.
const poolEnd = mock.method(pool, 'end', async () => {});
const closeRedis = mock.method(redis, 'closeRedis', async () => {});

// require('../server') is already safe in tests without booting anything
// (server/test/bootGates.test.js:58): the top-level `if (require.main ===
// module)` block that starts listening and installs the process handlers on
// the real `process` only runs when the file is executed directly.
const server = require('../server');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.exit = mock.fn();
  return proc;
}

const quietLog = { fatal() {}, error() {}, warn() {}, info() {} };
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an uncaught exception on an injected proc reaches pool.end and then exits 1 (default shutdown wired)', async () => {
  const proc = fakeProcess();
  server.installProcessHandlers(proc, { log: quietLog, deadlineMs: 5000 });
  proc.emit('uncaughtException', new Error('boom'));
  await tick(200);
  assert.ok(poolEnd.mock.callCount() >= 1, 'the API shutdown ran (it calls pool.end)');
  assert.ok(closeRedis.mock.callCount() >= 1, 'the API shutdown ran (it calls closeRedis)');
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [1]);
});

test('SIGTERM on an injected proc runs the API shutdown and exits 0', async () => {
  const proc = fakeProcess();
  server.installProcessHandlers(proc, { log: quietLog, deadlineMs: 5000 });
  proc.emit('SIGTERM');
  await tick(200);
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [0]);
});
