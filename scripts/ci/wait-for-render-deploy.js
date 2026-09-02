#!/usr/bin/env node
/**
 * Wait for a Render service to be live at a specific commit (#733).
 *
 * Why this exists: the `Promote deployment` workflow's worker-deploy step used
 * to poll only `readyz` for `.release == $GITHUB_SHA` for 60 x 10 s and then
 * `exit 1`. On a slow Render web build (~28 min in run 33657882698) that
 * timed out at 610 s, and because it sat mid-job, its failure SKIPPED the
 * three steps after it: the Netlify client hook and both verify steps. Two
 * defects fed the incident: the wait was shorter than a slow-path build, and
 * `readyz` alone cannot tell a slow build (keep waiting) from a failed one
 * (stop now) - only the Render deploy status can. Meanwhile `readyz` alone is
 * also not sufficient to fire the worker hook: the OLD web instance answers
 * 200 and reports the OLD `.release`, so a poller that trusts the Render
 * "live" signal alone would fire the worker hook while the web still served
 * the previous commit, the exact race this closes.
 *
 * What it does: given a Render service id and the wanted commit SHA, it polls
 * the service's recent deploys (a page of several, selecting the entry whose
 * commit id equals the SHA, never merely the latest), and:
 *   - exits 0 once that deploy is `live` and, when a readyz URL is given,
 *     `readyz` reports `.release` equal to the SHA;
 *   - exits non-zero within one poll interval when that deploy's status is
 *     terminal-failed (build_failed / update_failed / pre_deploy_failed /
 *     canceled / deactivated), naming the status;
 *   - keeps waiting on in-progress statuses AND on any status Render adds
 *     later that this script does not recognise (logged, never fail-fast);
 *   - exits non-zero if no deploy for the SHA has appeared once a short grace
 *     period has passed, saying the hook registered no deploy;
 *   - exits non-zero at the ceiling with the last observed status;
 *   - counts a failed API call or a malformed body as one spent poll, exactly
 *     as the old worker-verify step did, so a transient blip never decides.
 *
 * Deliberate limits, each pinned by a test in wait-for-render-deploy.test.js:
 *
 * - A different SHA being the latest live deploy does NOT end the wait:
 *   selectDeploy matches on commit id, so a rollback or a stale latest deploy
 *   cannot satisfy the wait for THIS commit.
 * - `live` is necessary but not sufficient when a readyz URL is given: the
 *   readyz `.release` must also equal the SHA. This is the final gate before
 *   the worker hook fires, and the one signal that the NEW web instance (not
 *   the old one still answering 200) is serving.
 * - Only the five statuses listed above fail fast. Every other status,
 *   including one Render introduces after this was written, is treated as
 *   "keep waiting" and logged, because failing on an unknown status would turn
 *   a healthy new state into a red release.
 * - The grace period exists so "the hook never registered a deploy" (a
 *   mis-fired or mis-configured hook) fails in a few minutes rather than
 *   burning the whole 45-minute ceiling. It only applies while NO deploy for
 *   the SHA has been seen; once one appears, the ceiling governs.
 * - fetch, sleep and the clock are injected. Production wiring uses global
 *   `fetch` (present on the runner's Node), real `setTimeout` and `Date.now`;
 *   the tests inject a fake clock so a 45-minute ceiling verifies in
 *   microseconds and elapsed time is exactly the sum of the sleeps.
 *
 * Shape mirrors close-merged-issues.js: pure-ish layers behind one small
 * injected interface. `selectDeploy` / `classifyStatus` / `decide` are pure;
 * `fetchDeploys` / `fetchReadyzRelease` are the only pieces that talk to the
 * network; `waitForDeploy` is the loop; `main` is the only caller that reads
 * argv/env and returns an exit code.
 */

// Statuses that mean "stop now, this deploy will not become live". From the
// Render deploy status vocabulary; canceled and deactivated are terminal too.
const TERMINAL_FAILED_STATUSES = ['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'];

// Statuses that mean "still working, keep waiting". Any status NOT in either
// set is also treated as waiting (see classifyStatus); this list is only the
// ones we recognise, so the logs can say "in progress" rather than "unknown".
const IN_PROGRESS_STATUSES = ['created', 'queued', 'build_in_progress', 'pre_deploy_in_progress', 'update_in_progress'];

const TERMINAL_FAILED_SET = new Set(TERMINAL_FAILED_STATUSES);

function classifyStatus(status) {
  if (status === 'live') return 'live';
  if (TERMINAL_FAILED_SET.has(status)) return 'failed';
  // in-progress AND unrecognised both wait: never fail fast on a status Render
  // adds after this was written.
  return 'waiting';
}

// Pick the deploy whose commit id equals the SHA, from a page of several.
// Never returns the latest merely because it is first: a rollback or a stale
// latest deploy for a different commit must not satisfy this wait.
function selectDeploy(page, sha) {
  if (!Array.isArray(page)) return null;
  for (const item of page) {
    const deploy = item && item.deploy;
    if (deploy && deploy.commit && deploy.commit.id === sha) return deploy;
  }
  return null;
}

// Pure per-poll decision. `observation` is what this poll saw; `ctx` the
// invariants. Returns { action: 'succeed' | 'fail' | 'wait', message }.
function decide(observation, ctx) {
  const { sha, hasReadyz, elapsedMs, graceMs } = ctx;
  const deploy = observation.deploy;
  if (deploy) {
    const kind = classifyStatus(deploy.status);
    if (kind === 'failed') {
      return { action: 'fail', message: `deploy for ${sha} is ${deploy.status}` };
    }
    if (kind === 'live') {
      if (!hasReadyz) {
        return { action: 'succeed', message: `deploy for ${sha} is live` };
      }
      if (observation.readyzRelease === sha) {
        return { action: 'succeed', message: `deploy for ${sha} is live and readyz reports ${sha}` };
      }
      // Live on Render, but the NEW web instance is not serving yet: the old
      // instance still answers 200 with the previous release. Keep waiting.
      return {
        action: 'wait',
        message: `deploy for ${sha} is live but readyz release=${observation.readyzRelease} (want ${sha})`,
      };
    }
    return { action: 'wait', message: `deploy for ${sha} status=${deploy.status}` };
  }
  // No deploy for this SHA in the page yet.
  if (elapsedMs >= graceMs) {
    return {
      action: 'fail',
      message: `no deploy for ${sha} after ${Math.round(graceMs / 1000)}s grace; the hook registered no deploy`,
    };
  }
  return { action: 'wait', message: `no deploy for ${sha} yet (within grace)` };
}

async function fetchDeploys({ fetch, serviceId, apiKey, pageSize, log }) {
  const url = `https://api.render.com/v1/services/${serviceId}/deploys?limit=${pageSize}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      log(`deploys API returned HTTP ${res.status}; counting as one spent poll`);
      return [];
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      log('deploys API body was not an array; counting as one spent poll');
      return [];
    }
    return body;
  } catch (err) {
    log(`deploys API call failed (${err.message}); counting as one spent poll`);
    return [];
  }
}

async function fetchReadyzRelease({ fetch, readyzUrl, log }) {
  try {
    const res = await fetch(readyzUrl);
    if (!res.ok) {
      log(`readyz returned HTTP ${res.status}; treating release as unknown`);
      return null;
    }
    const body = await res.json();
    return (body && body.release) || null;
  } catch (err) {
    log(`readyz call failed (${err.message}); treating release as unknown`);
    return null;
  }
}

function defaultIo() {
  return {
    fetch: (...args) => fetch(...args),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (m) => console.log(m),
  };
}

// The loop. Returns 0 (live at the SHA) or 1 (terminal failure, no-deploy past
// grace, or ceiling). Never throws for an expected outcome.
async function waitForDeploy(opts, io = defaultIo()) {
  const { serviceId, sha, apiKey, readyzUrl, ceilingMs, intervalMs, graceMs, pageSize } = opts;
  const { fetch, sleep, now, log } = io;
  const hasReadyz = Boolean(readyzUrl);
  const start = now();
  let lastStatus = 'none';
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const elapsedMs = now() - start;
    const page = await fetchDeploys({ fetch, serviceId, apiKey, pageSize, log });
    const deploy = selectDeploy(page, sha);
    if (deploy) lastStatus = deploy.status;

    let readyzRelease = null;
    if (deploy && classifyStatus(deploy.status) === 'live' && hasReadyz) {
      readyzRelease = await fetchReadyzRelease({ fetch, readyzUrl, log });
    }

    const decision = decide({ deploy, readyzRelease }, { sha, hasReadyz, elapsedMs, graceMs });
    log(`attempt ${attempt} (${Math.round(elapsedMs / 1000)}s): ${decision.message}`);

    if (decision.action === 'succeed') return 0;
    if (decision.action === 'fail') return 1;

    if (elapsedMs >= ceilingMs) {
      log(`ceiling of ${Math.round(ceilingMs / 1000)}s reached; last observed status=${lastStatus}`);
      return 1;
    }
    await sleep(intervalMs);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const MINUTE = 60 * 1000;

// argv/env in, exit code out. The only caller that reads process state (via
// the require.main block below). Injectable io keeps it testable.
async function main({ argv = process.argv.slice(2), env = process.env, io } = {}) {
  const args = parseArgs(argv);
  const serviceId = args.service;
  const sha = args.sha || env.GITHUB_SHA;
  const apiKey = env.RENDER_API_KEY;

  if (!serviceId) throw new Error('--service (the Render service id, srv-...) is required');
  if (!sha) throw new Error('--sha or GITHUB_SHA is required');
  if (!apiKey) throw new Error('RENDER_API_KEY is required in the environment');

  const opts = {
    serviceId,
    sha,
    apiKey,
    readyzUrl: args.readyz || null,
    ceilingMs: Number(args['ceiling-ms'] ?? 45 * MINUTE),
    intervalMs: Number(args['interval-ms'] ?? 15 * 1000),
    graceMs: Number(args['grace-ms'] ?? 5 * MINUTE),
    pageSize: Number(args['page-size'] ?? 20),
  };
  return waitForDeploy(opts, io);
}

if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (err) => {
      console.error(err.message);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  TERMINAL_FAILED_STATUSES,
  IN_PROGRESS_STATUSES,
  classifyStatus,
  selectDeploy,
  decide,
  fetchDeploys,
  fetchReadyzRelease,
  waitForDeploy,
  main,
};
