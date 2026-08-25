/**
 * In-process socket harness: a REAL `socket.io` server on an ephemeral port
 * with the production `attachDraftSocket` wiring, and REAL `socket.io-client`
 * connections carrying a minted JWT. It exists so the join handlers are
 * executed rather than described: every existing test of the join
 * acknowledgement calls `viewerContext` and `joinAck` directly, so the
 * `socket.on('draft:join', ...)` body between them - the part that decides
 * what the ack is built FROM - was never run by anything (#231).
 *
 * TEARDOWN IS THE POINT OF THIS FILE, not an afterthought. The server test
 * runner (scripts/run-server-tests.js) does NOT pass `--test-force-exit`, so
 * one leaked client, server, listener or timer does not fail this suite: it
 * HANGS the entire `test:server` run, for every agent and for CI. A hang is
 * worse than a red because nobody can tell whose change caused it, and
 * whoever eventually bisects it will not start here. Four things are put
 * back, and the singleton is the one that gets forgotten:
 *
 *   1. every client this harness connected (including ones that never
 *      connected, which still hold a reconnect-capable manager),
 *   2. `closeDraftSocket(io)`, which closes the io server,
 *   3. the http server, if io's close did not already take it down,
 *   4. the `modules/io` singleton, restored to its PRIOR VALUE rather than
 *      to null - something else in this process may be holding it.
 *
 * `JWT_SECRET` and `REDIS_URL` are managed the same way: captured at module
 * top, restored in the `after()` this file registers for you. `REDIS_URL`
 * must be unset before `attachDraftSocket` runs, or it attaches the Redis
 * adapter and opens two client connections nothing here can close.
 *
 * Usage - call at MODULE TOP, exactly as the route suites set their secret:
 *
 *   const harness = createSocketHarness({ secret: 'my-suite-secret' });
 *   test('...', async (t) => {
 *     myFakePool().install(t);
 *     const client = await harness.connectAs({ userId: 7, username: 'commish' });
 *     const ack = await harness.emit(client, 'draft:join', { leagueId: 1 });
 *   });
 */
const http = require('node:http');
const { after } = require('node:test');
const { io: ioClient } = require('socket.io-client');
const { signToken } = require('../../modules/auth');
const { attachDraftSocket, closeDraftSocket } = require('../../modules/draftSocket');
const { getIo, setIo } = require('../../modules/io');

/** How long a connect or an ack may take before we call it a failure. */
const SETTLE_MS = 5_000;

/**
 * A promise that rejects rather than hanging, with its timer ALWAYS cleared.
 * An uncleared timer is itself a leaked handle, so the clear lives in a
 * `finally` and not on the success path.
 */
function withDeadline(promise, message, ms = SETTLE_MS) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} (no answer within ${ms}ms)`)), ms);
    // Belt and braces: even if something below throws before the clear, an
    // unref'd timer cannot by itself hold the event loop open.
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function createSocketHarness({ secret = 'socket-harness-secret' } = {}) {
  const priorSecret = process.env.JWT_SECRET;
  const priorRedisUrl = process.env.REDIS_URL;
  process.env.JWT_SECRET = secret;
  // Unset BEFORE any attach: with it set, attachDraftSocket wires the Redis
  // adapter and opens connections this harness has no way to close.
  delete process.env.REDIS_URL;

  const clients = new Set();
  let priorIo;
  let io = null;
  let server = null;
  let starting = null;

  /** Idempotent: every test path funnels through one started server. */
  function start() {
    if (starting) return starting;
    starting = (async () => {
      priorIo = getIo();
      server = http.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      // Production wiring, called exactly as server.js calls it.
      io = attachDraftSocket(server);
      return `http://127.0.0.1:${server.address().port}`;
    })();
    return starting;
  }

  /**
   * Connect a client. `reconnection: false` is not a detail: a client left
   * with the default would keep retrying after the server closes and hold
   * the event loop open past the end of the run.
   */
  function open(options) {
    return start().then((url) => {
      const client = ioClient(url, { forceNew: true, reconnection: false, transports: ['websocket'], ...options });
      clients.add(client);
      return client;
    });
  }

  /** Drop one client early, so a suite does not accumulate live sockets that
   *  keep receiving another test's room broadcasts. */
  function release(client) {
    client.removeAllListeners();
    client.close();
    clients.delete(client);
  }

  /**
   * Connect as a manager, resolving once the handshake has succeeded. Pass the
   * test's `t` and the client is released when that test ends rather than at
   * the end of the file.
   */
  async function connectAs({ userId, username = `user-${userId}` }, t, options = {}) {
    const client = await open({ auth: { token: signToken({ id: userId, username }) }, ...options });
    if (t) t.after(() => release(client));
    await withDeadline(
      new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', (error) => reject(new Error(`connect refused: ${error.message}`)));
      }),
      `connect as ${username}`
    );
    return client;
  }

  /**
   * Attempt a connection that is EXPECTED to be refused, and resolve with the
   * middleware's error message. Resolving with 'connected' rather than
   * throwing keeps the assertion in the test, where the failure message can
   * say which case it was.
   */
  async function connectExpectingRefusal(options, t) {
    const client = await open(options);
    if (t) t.after(() => release(client));
    return withDeadline(
      new Promise((resolve) => {
        client.once('connect', () => resolve('connected'));
        client.once('connect_error', (error) => resolve(error.message));
      }),
      'refused connection'
    );
  }

  /**
   * Emit an event and resolve with the handler's acknowledgement.
   *
   * `onAck` runs SYNCHRONOUSLY inside the acknowledgement callback, which
   * matters for any test that compares the ack against an event: awaiting
   * this promise resumes on a microtask, by which time a packet dispatched
   * in the same batch has already run its listener, and the ack would look
   * second when it went out first.
   */
  function emit(client, event, payload, { onAck } = {}) {
    return withDeadline(
      new Promise((resolve) => client.emit(event, payload, (ack) => {
        if (onAck) onAck(ack);
        resolve(ack);
      })),
      `ack for ${event}`
    );
  }

  /** Collect the next `event` payload; call BEFORE the emit that triggers it.
   *  Deadlined like every other wait here, so an event that never arrives
   *  fails by name in seconds instead of stalling to the runner's timeout. */
  function nextEvent(client, event) {
    return withDeadline(
      new Promise((resolve) => client.once(event, resolve)),
      `${event} event`
    );
  }

  async function stop() {
    for (const client of clients) {
      client.removeAllListeners();
      client.close();
    }
    clients.clear();
    // Anything still queued on a just-closed socket gets one turn to drain
    // before the server goes away, so no write lands on a dead handle.
    await new Promise((resolve) => setImmediate(resolve));
    // io.close() also takes down the http server it was attached to, so the
    // server close below is conditional rather than unconditional.
    if (io) await closeDraftSocket(io);
    if (server && server.listening) await new Promise((resolve) => server.close(resolve));
    io = null;
    server = null;
    starting = null;
    // Back to the PRIOR value. `starting` guards `priorIo` ever being read
    // before it was captured.
    if (priorIo !== undefined) setIo(priorIo);
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
    if (priorRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = priorRedisUrl;
  }

  after(stop);

  // Only what a suite calls. `start`, `release` and `stop` are reached from
  // inside this file (by `open`, by `connectAs`'s cleanup, and by the
  // `after` above), so exposing them would be surface with no caller.
  return { connectAs, connectExpectingRefusal, emit, nextEvent };
}

module.exports = { createSocketHarness };
