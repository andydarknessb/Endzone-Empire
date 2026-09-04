const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'audit-with-retry.js');

// The exact annotation the script prints on exhaustion (#838). Kept verbatim
// here so a drift in the script's copy fails a test rather than silently
// changing what a reviewer reads in the Checks UI.
const EXHAUSTION_ANNOTATION =
  '::error::dependency audit: npm advisories endpoint did not answer after 3 attempts; no advisory was evaluated (#838)';

// The exact stderr line npm prints on an advisories-endpoint fault, and the
// only line the script is allowed to retry on. npm prefixes it with
// "npm error "; the fake reproduces that prefix so the match is exercised on
// the real shape, not a trimmed one.
const ENDPOINT_LINE = 'npm error audit endpoint returned an error';

// A fake npm. Each invocation appends one line to COUNTER_FILE (so the test
// can count invocations) and one JSON line to ARGV_FILE recording the exact
// argv the wrapper handed npm (so the test can assert the audit command, not
// only its retry behaviour), then emits the attempt-th entry of BEHAVIOR
// (a JSON array of { code, stderr?, stdout? }); the last entry repeats once
// the attempts run past the array. This is the "fake npm executable" the
// acceptance criteria call for: a real subprocess the script spawns, whose
// per-attempt stderr and exit code the test controls.
const FAKE_NPM = `
const fs = require('node:fs');
fs.appendFileSync(process.env.COUNTER_FILE, 'call\\n');
fs.appendFileSync(process.env.ARGV_FILE, JSON.stringify(process.argv.slice(2)) + '\\n');
const attempt = fs.readFileSync(process.env.COUNTER_FILE, 'utf8').trim().split('\\n').length;
const behavior = JSON.parse(process.env.BEHAVIOR);
const step = behavior[Math.min(attempt - 1, behavior.length - 1)];
if (step.stdout) process.stdout.write(step.stdout);
if (step.stderr) process.stderr.write(step.stderr);
process.exit(step.code);
`;

function runScript({ behavior, prefixArg }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-retry-'));
  const fakePath = path.join(dir, 'fake-npm.js');
  const counterFile = path.join(dir, 'calls.log');
  const argvFile = path.join(dir, 'argv.log');
  fs.writeFileSync(fakePath, FAKE_NPM);
  fs.writeFileSync(counterFile, '');
  fs.writeFileSync(argvFile, '');

  const args = [SCRIPT];
  if (prefixArg) args.push(prefixArg);

  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Run the fake through this node binary with no shell, so no chmod or
        // .cmd shim is needed on any host and a path with spaces is safe. In
        // CI the script defaults the executable to `npm` with no leading args.
        AUDIT_NPM_BIN: process.execPath,
        AUDIT_NPM_BIN_ARGS: JSON.stringify([fakePath]),
        // Zero backoff so the test never sleeps.
        AUDIT_RETRY_BACKOFF_MS: '0,0',
        BEHAVIOR: JSON.stringify(behavior),
        COUNTER_FILE: counterFile,
        ARGV_FILE: argvFile,
      },
    });
  } catch (err) {
    status = typeof err.status === 'number' ? err.status : 1;
    stdout = err.stdout ? err.stdout.toString() : '';
  }

  const calls = fs.readFileSync(counterFile, 'utf8').trim();
  const invocations = calls === '' ? 0 : calls.split('\n').length;
  const argvLog = fs.readFileSync(argvFile, 'utf8').trim();
  const argv = argvLog === '' ? [] : argvLog.split('\n').map((l) => JSON.parse(l));
  return { status, stdout, invocations, argv };
}

// (i) The endpoint fault clears on a retry: two faults then a clean exit 0.
// The script must exhaust neither its patience early nor its budget: exit 0,
// three invocations.
test('retries the endpoint fault and succeeds when it clears', () => {
  const { status, stdout, invocations } = runScript({
    behavior: [
      { code: 1, stderr: ENDPOINT_LINE + '\n' },
      { code: 1, stderr: ENDPOINT_LINE + '\n' },
      { code: 0, stdout: 'found 0 vulnerabilities\n' },
    ],
  });
  assert.equal(status, 0);
  assert.equal(invocations, 3);
  assert.ok(!stdout.includes('::error::'), 'no annotation on success');
});

// (ii) A real advisory (any non-zero exit whose stderr lacks the endpoint
// line) is never retried: the script exits with npm's own code after exactly
// one invocation and prints no annotation. Removing the "never retry" branch
// turns this red (it would run all three attempts).
test('never retries a real advisory and passes npm\'s exit code through', () => {
  const { status, stdout, invocations } = runScript({
    behavior: [
      {
        code: 7,
        stdout: '# npm audit report\n\nlodash  <=4.17.20\nSeverity: high\n',
        stderr: 'npm error code EAUDIT\n',
      },
    ],
  });
  assert.equal(status, 7);
  assert.equal(invocations, 1);
  assert.ok(!stdout.includes('::error::'), 'no annotation for a real advisory');
});

// (iii) The endpoint never answers: the budget is spent (three invocations),
// the run stays red (exit 1), and exactly one annotation line names the cause
// verbatim. Changing the matched string in the script turns this red.
test('stays red with one annotation when the endpoint never answers', () => {
  const { status, stdout, invocations } = runScript({
    behavior: [{ code: 1, stderr: ENDPOINT_LINE + '\n' }],
  });
  assert.equal(status, 1);
  assert.equal(invocations, 3);
  const annotations = stdout.split('\n').filter((l) => l.startsWith('::error::'));
  assert.deepEqual(annotations, [EXHAUSTION_ANNOTATION]);
});

// (iv) The exact audit command for the root gate. Asserting argv (not just
// the retry contract) is what catches a regression in auditArgs: replacing it
// with `return ['audit']` drops --omit=dev and --audit-level=high and turns
// this red.
test('runs the exact root audit argv (no prefix)', () => {
  const { status, argv } = runScript({
    behavior: [{ code: 0, stdout: 'found 0 vulnerabilities\n' }],
  });
  assert.equal(status, 0);
  assert.deepEqual(argv, [['audit', '--omit=dev', '--audit-level=high']]);
});

// (v) The exact audit command for the server gate. --prefix server is the
// ONLY thing scoping dependency-audit-server to server/; if a later edit
// drops it, that gate audits the root tree and goes green under the server
// name (the very failure this ticket removes, one layer up). Asserting the
// full argv here fails the moment --prefix, the prefix value, or either flag
// changes. Replacing auditArgs with `return ['audit']` turns this red too.
test('runs the exact server audit argv (--prefix server)', () => {
  const { status, argv } = runScript({
    behavior: [{ code: 0, stdout: 'found 0 vulnerabilities\n' }],
    prefixArg: 'server',
  });
  assert.equal(status, 0);
  assert.deepEqual(argv, [['audit', '--prefix', 'server', '--omit=dev', '--audit-level=high']]);
});
