const { logger } = require('./logger');

// How long a fatal event or a signal waits for shutdown() before the process
// is exited regardless. Render restarts an exited instance within seconds; a
// hung one it never touches. One deadline for both the worker and the API
// (#1537), covering signals as well as fatal events.
const SHUTDOWN_DEADLINE_MS = 10 * 1000;

/**
 * Wire the fatal and signal handlers on `proc` so that the process EXITS.
 *
 * Lifted from the worker's own handler (#1535, PR #1536) so the API gets the
 * same contract: before that fix a handler ran shutdown() and only set
 * `process.exitCode`, which takes effect only once the event loop drains. A
 * hung shutdown step (an unbounded `await` on a closing socket or pool) left
 * a process that had started shutting down and would never exit. Now the
 * handler exits explicitly when shutdown settles, or at `deadlineMs` if it
 * does not, whichever comes first, and exactly once.
 *
 * `shutdown` is required: this shared module has no default shutdown, since
 * the worker's and the API's are different. `name` ('worker', 'api') labels
 * the four log messages so they can be told apart. Injectable `proc`, `exit`
 * and `deadlineMs` are the test seam; production passes only `shutdown` and
 * `name`.
 */
function installProcessHandlers(proc = process, {
  exit = (code) => proc.exit(code),
  shutdown,
  deadlineMs = SHUTDOWN_DEADLINE_MS,
  log = logger,
  name = 'process',
} = {}) {
  if (typeof shutdown !== 'function') {
    throw new Error('installProcessHandlers requires a shutdown function');
  }
  let exiting = false;
  const exitAfterShutdown = (reason, code) => {
    if (exiting) return;
    exiting = true;
    // Set first: if shutdown leaves nothing holding the loop open, Node may
    // exit on its own before either exit() below runs, and it must not
    // report success after a fatal event.
    proc.exitCode = code;
    let exited = false;
    const exitOnce = (why) => {
      if (exited) return;
      exited = true;
      if (why) log.fatal({ reason, code }, why);
      exit(code);
    };
    const deadline = setTimeout(
      () => exitOnce(`${name} shutdown deadline elapsed; exiting anyway`),
      deadlineMs,
    );
    if (typeof deadline.unref === 'function') deadline.unref();
    Promise.resolve()
      .then(() => shutdown(reason))
      .catch((error) => log.error({ err: error, reason }, `${name} shutdown failed`))
      .finally(() => {
        clearTimeout(deadline);
        exitOnce(null);
      });
  };
  for (const signal of ['SIGTERM', 'SIGINT']) {
    proc.once(signal, () => exitAfterShutdown(signal, 0));
  }
  proc.once('uncaughtException', (error) => {
    log.fatal({ err: error }, `${name} uncaught exception`);
    exitAfterShutdown('uncaughtException', 1);
  });
  proc.once('unhandledRejection', (error) => {
    log.fatal({ err: error }, `${name} unhandled rejection`);
    exitAfterShutdown('unhandledRejection', 1);
  });
}

module.exports = { installProcessHandlers, SHUTDOWN_DEADLINE_MS };
