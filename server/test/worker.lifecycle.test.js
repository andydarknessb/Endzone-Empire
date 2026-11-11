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

test('the production wiring uses the real shutdown by default and waits for in-flight scheduler work (#2864)', async () => {
  // A fake shutdown is injected everywhere above; this pins that the default
  // is the module's own shutdown, so a typo in the default cannot hide. It is
  // also the one case that runs shutdown (one-shot per process), so it holds a
  // scheduler job open across SIGTERM: pool.end waits until the job settles.
  const redis = require('../modules/redis');
  const pool = require('../modules/pool');
  const scheduler = require('../modules/scheduler');
  const order = [];
  const closeRedis = mock.method(redis, 'closeRedis', async () => { order.push('closeRedis'); });
  const poolQuery = mock.method(pool, 'query', async () => ({ rows: [] }));
  const poolEnd = mock.method(pool, 'end', async () => { order.push('pool.end'); });
  const proc = fakeProcess();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const job = { name: 'held', gate: { due: async () => ({ due: true }) }, run: () => held };
  try {
    install(proc, { deadlineMs: 5000 });
    const running = scheduler.tickUnlocked([job]);
    proc.emit('SIGTERM');
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(poolEnd.mock.callCount(), 0, 'the pool stays open while the job runs');
    release();
    await running;
    await tick(200);
    assert.equal(closeRedis.mock.callCount(), 1, 'the default shutdown ran (it closes Redis)');
    assert.deepEqual(order, ['pool.end', 'closeRedis'], 'pool.end once, after the job settles');
    assert.deepEqual(proc.exit.mock.calls[0].arguments, [0]);
  } finally {
    release();
    closeRedis.mock.restore();
    poolQuery.mock.restore();
    poolEnd.mock.restore();
  }
});

test('the worker deadline outlasts the scheduler drain and stays under Render\'s 60 s (#2864)', () => {
  const { SCHEDULER_DRAIN_MS } = require('../modules/scheduler');
  assert.ok(worker.WORKER_SHUTDOWN_DEADLINE_MS > SCHEDULER_DRAIN_MS);
  assert.ok(worker.WORKER_SHUTDOWN_DEADLINE_MS < 60_000);
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

// #2758: boot awaits the draft-sweep stamp before the scheduler starts. A Redis
// that never answers must not hold boot: startWorker still reaches the start log.
test('boot reaches the background worker start when the Redis stamp never settles', { timeout: 15_000 }, async (t) => {
  const pool = require('../modules/pool');
  const redis = require('../modules/redis');
  const { logger } = require('../modules/logger');
  const { stopScheduler } = require('../modules/scheduler');
  const { stopLiveGameEngine } = require('../modules/liveGameEngine');
  t.mock.method(redis, 'getRedisClient', () => new Promise(() => {}));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const info = t.mock.method(logger, 'info', () => {});
  t.after(() => { stopScheduler(); stopLiveGameEngine(); });

  await worker.startWorker();

  assert.ok(info.mock.calls.some((call) => call.arguments[0] === 'background worker started'));
});

// #2866: the engine's in-flight tick holds the pool open, and shutdown waits for it.
// shutdown is one-shot per module, so this case loads a fresh worker module of its own.
test('shutdown waits for an in-flight engine tick before it ends the pool (#2866)', async (t) => {
  const pool = require('../modules/pool');
  const redis = require('../modules/redis');
  const engine = require('../modules/liveGameEngine');
  const poolEnd = t.mock.method(pool, 'end', async () => {});
  t.mock.method(redis, 'closeRedis', async () => {});
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  t.mock.method(pool, 'connect', () => held);
  const releaseTick = () => release({ query: async () => ({ rows: [{ locked: false }] }), release() {} });
  t.after(() => { releaseTick(); engine.stopLiveGameEngine(); });
  delete require.cache[require.resolve('../worker')];
  const fresh = require('../worker');
  const proc = fakeProcess();
  fresh.installProcessHandlers(proc, { log: quietLog, deadlineMs: 5000 });
  engine.startLiveGameEngine();
  engine.tick();
  proc.emit('SIGTERM');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(poolEnd.mock.callCount(), 0, 'the pool stays open while the engine tick runs');
  releaseTick();
  await tick(200);
  assert.equal(poolEnd.mock.callCount(), 1, 'pool.end once, after the engine tick settles');
});

// #2869: a detached recap sweep or queued generation holds the pool open too.
test('shutdown waits for in-flight recap work before it ends the pool (#2869)', async (t) => {
  const pool = require('../modules/pool');
  const redis = require('../modules/redis');
  const gameRecap = require('../services/gameRecap.service');
  const poolEnd = t.mock.method(pool, 'end', async () => {});
  t.mock.method(redis, 'closeRedis', async () => {});
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  t.mock.method(gameRecap, 'drainRecaps', () => held);
  t.after(() => release());
  delete require.cache[require.resolve('../worker')];
  const fresh = require('../worker');
  const proc = fakeProcess();
  fresh.installProcessHandlers(proc, { log: quietLog, deadlineMs: 5000 });
  proc.emit('SIGTERM');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(poolEnd.mock.callCount(), 0, 'the pool stays open while the recap work runs');
  release();
  await tick(200);
  assert.equal(poolEnd.mock.callCount(), 1, 'pool.end once, after the recap work settles');
});
