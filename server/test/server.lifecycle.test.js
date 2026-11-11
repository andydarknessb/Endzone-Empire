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
const settleService = require('../services/settle.service');

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
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };

// shutdown() runs once per module instance (shutdownPromise), so each case that
// needs its own shutdown loads server.js again; pool and redis stay the mocks.
function freshServer() {
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

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

// #2756: Advance week's Settle follow-up runs after commit and nothing awaited it,
// so a shutdown that ended the pool mid-follow-up lost that week's Trophies and Recap.
test('shutdown waits for a running Settle follow-up before it ends the pool (#2756)', async () => {
  let finish;
  settleService.trackFollowUp(new Promise((resolve) => { finish = resolve; }));
  const fresh = freshServer();
  poolEnd.mock.resetCalls();
  const done = fresh.shutdown('SIGTERM');
  await tick(50);
  assert.equal(poolEnd.mock.callCount(), 0, 'pool.end waits while the follow-up runs');
  finish();
  await done;
  assert.equal(poolEnd.mock.callCount(), 1, 'the pool ends once the follow-up settles');
});

test('a follow-up that never settles lets shutdown continue at the 30-second limit (#2756)', async (t) => {
  let release;
  settleService.trackFollowUp(new Promise((resolve) => { release = resolve; }));
  t.after(() => release());
  const fresh = freshServer();
  poolEnd.mock.resetCalls();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const done = fresh.shutdown('SIGTERM');
  await flush();
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(poolEnd.mock.callCount(), 0, 'still waiting at 29.999 s');
  t.mock.timers.tick(1);
  await done;
  assert.equal(poolEnd.mock.callCount(), 1, 'pool.end runs at the 30 s limit');
});

test('the API outer deadline outlasts the follow-up wait, so a SIGTERM still waits the full 30 seconds (#2756)', async (t) => {
  let release;
  settleService.trackFollowUp(new Promise((resolve) => { release = resolve; }));
  t.after(() => release());
  const fresh = freshServer();
  const proc = fakeProcess();
  poolEnd.mock.resetCalls();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fresh.installProcessHandlers(proc, { log: quietLog });
  proc.emit('SIGTERM');
  await flush();
  t.mock.timers.tick(10_000); // the shared 10 s worker deadline must not apply to the API
  await flush();
  assert.equal(proc.exit.mock.callCount(), 0, 'not exited at 10 s');
  t.mock.timers.tick(20_000);
  await flush();
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [0]);
  assert.equal(poolEnd.mock.callCount(), 1, 'pool.end ran before the exit');
});

test('no tracked follow-up outlives its case (#2860)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let drained = false;
  settleService.drainFollowUps().then(() => { drained = true; });
  await flush();
  assert.equal(drained, true, 'the set is empty, so the drain resolves without a tick');
});
