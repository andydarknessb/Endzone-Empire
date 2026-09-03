#!/usr/bin/env node
/**
 * Run `npm audit` for a CI gate, retrying ONLY an npm advisories-endpoint
 * outage and never a real advisory (#838).
 *
 * Why this exists: the two dependency-audit gates ran a bare
 * `npm audit --omit=dev --audit-level=high`. npm exits 1 both when an
 * advisory at or above `high` exists AND when the advisories endpoint at
 * registry.npmjs.org never answers. The two are indistinguishable in the
 * Checks UI, so a transient outage fails a required gate exactly as a real
 * finding would, and the reflex to re-run until green is the same reflex
 * that would hide a real advisory. This wrapper retries the outage a bounded
 * number of times and, when the budget is spent, stays red with a message
 * that says the endpoint did not answer so no one mistakes it for a finding.
 *
 * The contract, each clause pinned by a test in audit-with-retry.test.js:
 *
 * - Retries ONLY on the exact stderr line `audit endpoint returned an error`
 *   (ENDPOINT_FAULT below), which is what npm prints for an endpoint outage.
 *   Any other non-zero exit is a real result (an advisory, a usage error):
 *   it is passed straight through with npm's own exit code and output and no
 *   annotation. An advisory is therefore never retried.
 * - Budget: 3 attempts total (one initial + backoff.length retries), backoff
 *   15s then 45s between attempts. The backoff is injectable via
 *   AUDIT_RETRY_BACKOFF_MS (comma-separated ms) so the tests do not sleep;
 *   the attempt count is derived from it, so the annotation's "N attempts"
 *   and the real budget can never drift apart.
 * - On exhaustion the run stays red: exit 1, npm's last output still on
 *   stderr (it is streamed through every attempt), plus exactly one GitHub
 *   annotation line on stdout naming the cause and this issue.
 * - The npm executable is injectable via AUDIT_NPM_BIN (default `npm`) so a
 *   test can substitute a fake. It is a command string run through a shell,
 *   which lets the fake be `node "<path>"` on any host with no chmod or .cmd
 *   shim; the audit arguments are fixed literals, never caller input.
 *
 * Zero dependencies on purpose: the audit jobs do not run `npm ci`, so this
 * must run on a bare checkout with only Node's standard library.
 */
const { spawnSync } = require('node:child_process');

// The one stderr line the wrapper is allowed to retry. npm prints it (behind
// its own "npm error " prefix) when the advisories endpoint faults; a real
// advisory never contains it. Changing this string is what a red-tell test
// flips to prove the retry is keyed on it and nothing else.
const ENDPOINT_FAULT = 'audit endpoint returned an error';

const DEFAULT_BACKOFF_MS = [15000, 45000];

function parseBackoff(raw) {
  if (raw == null || raw.trim() === '') return DEFAULT_BACKOFF_MS;
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .map((n) => (Number.isFinite(n) && n >= 0 ? n : 0));
}

function auditArgs(prefix) {
  const args = ['audit'];
  if (prefix) args.push('--prefix', prefix);
  args.push('--omit=dev', '--audit-level=high');
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One npm run. stdio is captured (not inherited) so stderr can be inspected
// for the endpoint line, then written through unchanged so the job log reads
// exactly as a bare `npm audit` would.
function runOnce(npmBin, args) {
  const result = spawnSync(`${npmBin} ${args.join(' ')}`, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  // A launch failure (result.error) has no exit code; treat it as a non-zero,
  // non-endpoint result so it passes through red without retry.
  const code = typeof result.status === 'number' ? result.status : 1;
  return { code, stderr };
}

async function run({ prefix, npmBin, backoff }) {
  const args = auditArgs(prefix);
  const maxAttempts = backoff.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { code, stderr } = runOnce(npmBin, args);

    if (code === 0) return 0;

    const isEndpointFault = stderr.includes(ENDPOINT_FAULT);
    if (!isEndpointFault) {
      // A real advisory or any other non-zero exit: npm's own code, no retry,
      // no annotation.
      return code;
    }

    if (attempt < maxAttempts) {
      await sleep(backoff[attempt - 1]);
      continue;
    }

    // Budget spent on the endpoint fault: stay red and say why, exactly once.
    process.stdout.write(
      `::error::dependency audit: npm advisories endpoint did not answer after ${maxAttempts} attempts; no advisory was evaluated (#838)\n`,
    );
    return 1;
  }

  // Unreachable: the loop returns on every path above.
  return 1;
}

if (require.main === module) {
  run({
    prefix: process.argv[2],
    npmBin: process.env.AUDIT_NPM_BIN || 'npm',
    backoff: parseBackoff(process.env.AUDIT_RETRY_BACKOFF_MS),
  }).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (err) => {
      console.error(err && err.message ? err.message : err);
      process.exitCode = 1;
    },
  );
}

module.exports = { ENDPOINT_FAULT, DEFAULT_BACKOFF_MS, parseBackoff, auditArgs, run };
