const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

// #1535: on 2026-09-16 at 17:55:50Z a pooled Postgres client being closed
// took `read ECONNABORTED`, Node raised `uncaughtException`, and the worker's
// handler ran shutdown() and set `process.exitCode = 1`. Setting exitCode only
// exits once the event loop drains; the Redis emitter transport kept it alive,
// so the process sat with no timers for 17 hours and Render, which restarts
// only an exited process, never brought it back. These tests pin the contract
// that replaces it: after a fatal event or a signal the worker EXITS, either
// when shutdown settles or when a deadline passes, whichever comes first.

const worker = require('../worker');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.exit = mock.fn();
  return proc;
}

const quietLog = { fatal() {}, error() {}, warn() {}, info() {} };

function install(proc, overrides) {
  return worker.installProcessHandlers(proc, { log: quietLog, ...overrides });
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an uncaught exception whose shutdown never settles still exits 1 at the deadline', async () => {
  const proc = fakeProcess();
  const never = () => new Promise(() => {});
  install(proc, { shutdown: never, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('read ECONNABORTED'));
  assert.equal(proc.exit.mock.callCount(), 0, 'not before the deadline');
  await tick(60);
  assert.equal(proc.exit.mock.callCount(), 1, 'exactly one exit');
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [1]);
});

test('an uncaught exception whose shutdown settles exits 1 once, and the deadline is cancelled', async () => {
  const proc = fakeProcess();
  const reasons = [];
  const settles = async (reason) => { reasons.push(reason); };
  install(proc, { shutdown: settles, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('boom'));
  await tick(5);
  assert.deepEqual(reasons, ['uncaughtException']);
  assert.equal(proc.exit.mock.callCount(), 1);
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [1]);
  await tick(60);
  assert.equal(proc.exit.mock.callCount(), 1, 'the deadline must not fire a second exit');
});

test('an unhandled rejection exits 1; a shutdown that rejects still exits 1', async () => {
  const proc = fakeProcess();
  install(proc, { shutdown: async () => { throw new Error('pool.end failed'); }, deadlineMs: 20 });
  proc.emit('unhandledRejection', new Error('rejected'));
  await tick(5);
  assert.equal(proc.exit.mock.callCount(), 1);
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [1]);
});

test('a shutdown that throws synchronously still exits 1', async () => {
  const proc = fakeProcess();
  install(proc, { shutdown: () => { throw new Error('sync boom'); }, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('fatal'));
  await tick(5);
  assert.equal(proc.exit.mock.callCount(), 1);
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [1]);
});

test('the exit code is set the instant a fatal event lands, so a loop that drains on its own cannot exit 0', () => {
  const proc = fakeProcess();
  install(proc, { shutdown: () => new Promise(() => {}), deadlineMs: 1000 });
  proc.emit('uncaughtException', new Error('fatal'));
  assert.equal(proc.exitCode, 1);
  const term = fakeProcess();
  install(term, { shutdown: () => new Promise(() => {}), deadlineMs: 1000 });
  term.emit('SIGTERM');
  assert.equal(term.exitCode, 0);
});

test('the production wiring uses the real shutdown by default', async () => {
  // A fake shutdown is injected everywhere above; this pins that the default
  // is the module's own shutdown, so a typo in the default cannot hide.
  const redis = require('../modules/redis');
  const closeRedis = mock.method(redis, 'closeRedis', async () => {});
  const proc = fakeProcess();
  try {
    install(proc, { deadlineMs: 5000 });
    proc.emit('SIGTERM');
    await tick(200);
    assert.equal(closeRedis.mock.callCount(), 1, 'the default shutdown ran (it closes Redis)');
    assert.deepEqual(proc.exit.mock.calls[0].arguments, [0]);
  } finally {
    closeRedis.mock.restore();
  }
});

test('SIGTERM and SIGINT run shutdown with the signal name and exit 0', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const proc = fakeProcess();
    const reasons = [];
    install(proc, { shutdown: async (reason) => { reasons.push(reason); }, deadlineMs: 20 });
    proc.emit(signal);
    await tick(5);
    assert.deepEqual(reasons, [signal]);
    assert.deepEqual(proc.exit.mock.calls[0].arguments, [0]);
  }
});

test('a second fatal event after the first never produces a second exit', async () => {
  const proc = fakeProcess();
  install(proc, { shutdown: async () => {}, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('one'));
  proc.emit('uncaughtException', new Error('two'));
  await tick(10);
  assert.equal(proc.exit.mock.callCount(), 1);
});
