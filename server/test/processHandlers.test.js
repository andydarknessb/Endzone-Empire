const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

// #1537: the API's fatal and signal handlers used to run shutdown() and only
// set `process.exitCode`, which takes effect only once the event loop drains
// — the same gap #1535 fixed for the worker. This lifts that worker fix
// (server/worker.js) into a shared module both services install: the
// contract pinned here is that a fatal event or a signal EXITS the process,
// either when shutdown settles or when a deadline passes, whichever comes
// first, exactly once — with `name` labelling which service is exiting.

const { installProcessHandlers, SHUTDOWN_DEADLINE_MS } = require('../modules/processHandlers');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.exit = mock.fn();
  return proc;
}

function fakeLog() {
  const calls = { fatal: [], error: [] };
  return {
    calls,
    fatal(...args) { calls.fatal.push(args); },
    error(...args) { calls.error.push(args); },
    warn() {},
    info() {},
  };
}

function install(proc, overrides) {
  return installProcessHandlers(proc, { log: fakeLog(), shutdown: async () => {}, name: 'worker', ...overrides });
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('exports the one 10-second deadline used by both services', () => {
  assert.equal(SHUTDOWN_DEADLINE_MS, 10 * 1000);
});

test('calling it without a shutdown function throws', () => {
  assert.throws(
    () => installProcessHandlers(fakeProcess(), { name: 'worker' }),
    /shutdown/,
  );
});

test('an uncaught exception whose shutdown never settles still exits 1 at the deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const proc = fakeProcess();
  const never = () => new Promise(() => {});
  install(proc, { shutdown: never, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('boom'));
  assert.equal(proc.exit.mock.callCount(), 0, 'not before the deadline');
  t.mock.timers.tick(20);
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

test('a second fatal event after the first never produces a second exit', async () => {
  const proc = fakeProcess();
  install(proc, { shutdown: async () => {}, deadlineMs: 20 });
  proc.emit('uncaughtException', new Error('one'));
  proc.emit('uncaughtException', new Error('two'));
  await tick(10);
  assert.equal(proc.exit.mock.callCount(), 1);
});

test('the name option labels the fatal-event log line so the two services are told apart', async () => {
  const proc = fakeProcess();
  const log = fakeLog();
  installProcessHandlers(proc, { log, shutdown: async () => {}, deadlineMs: 20, name: 'api' });
  proc.emit('uncaughtException', new Error('boom'));
  await tick(5);
  assert.ok(
    log.calls.fatal.some(([, message]) => message === 'api uncaught exception'),
    `expected an "api uncaught exception" fatal log, got ${JSON.stringify(log.calls.fatal)}`,
  );
});

test('a shutdown that never settles is logged with the name at the deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const proc = fakeProcess();
  const log = fakeLog();
  installProcessHandlers(proc, { log, shutdown: () => new Promise(() => {}), deadlineMs: 20, name: 'api' });
  proc.emit('SIGTERM');
  t.mock.timers.tick(20);
  assert.ok(
    log.calls.fatal.some(([, message]) => message === 'api shutdown deadline elapsed; exiting anyway'),
    `expected the deadline fatal log to name "api", got ${JSON.stringify(log.calls.fatal)}`,
  );
});
