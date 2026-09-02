const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectDeploy,
  classifyStatus,
  decide,
  waitForDeploy,
  main,
  TERMINAL_FAILED_STATUSES,
  IN_PROGRESS_STATUSES,
} = require('./wait-for-render-deploy');

// The commit we are waiting to see go live, and the one the old instance
// still serves. Every test below turns on the poller telling these apart.
const WANT = 'sha-new-1234567';
const PREV = 'sha-old-7654321';

const item = (sha, status) => ({ deploy: { status, commit: { id: sha } } });

// ---------------------------------------------------------------------------
// A deterministic harness. `fetch`, `sleep` and `now` are injected: sleep only
// advances a fake clock, so a 45-minute ceiling test runs in microseconds and
// elapsed time is exactly what the sequence of sleeps says it is. `pages` is
// the deploys-endpoint response per poll; `readyz` the readyz response per
// poll. A spec is either a value (array / object -> JSON body) or one of the
// strings 'THROW' (fetch rejects), 'HTTP500' (res.ok false), 'MALFORMED'
// (200 with a non-array body) or 'BADJSON' (200 whose .json() throws). The
// last entry repeats, so a test that should never end on its own is caught by
// the ceiling rather than running off the end of the array.
// ---------------------------------------------------------------------------
function toResponse(spec) {
  if (spec === 'THROW') throw new Error('network down');
  if (spec === 'HTTP500') return { ok: false, status: 500 };
  if (spec === 'MALFORMED') return { ok: true, async json() { return { not: 'an array' }; } };
  if (spec === 'BADJSON') return { ok: true, async json() { throw new Error('invalid json'); } };
  return { ok: true, async json() { return spec; } };
}

function harness({ pages, readyz = [], intervalMs = 15000, ceilingMs = 45 * 60 * 1000, graceMs = 5 * 60 * 1000 }) {
  const logs = [];
  const counts = { deploy: 0, readyz: 0 };
  let clock = 0;
  const at = (arr, i) => arr[Math.min(i, arr.length - 1)];
  const io = {
    async fetch(url) {
      if (String(url).includes('/deploys')) {
        const spec = at(pages, counts.deploy);
        counts.deploy += 1;
        return toResponse(spec);
      }
      const spec = at(readyz, counts.readyz);
      counts.readyz += 1;
      return toResponse(spec);
    },
    async sleep(ms) {
      clock += ms;
    },
    now() {
      return clock;
    },
    log: (m) => logs.push(String(m)),
  };
  return { io, logs, counts, intervalMs, ceilingMs, graceMs, clock: () => clock };
}

function run(h, opts = {}) {
  return waitForDeploy(
    {
      serviceId: 'srv-web',
      sha: WANT,
      apiKey: 'render-key',
      readyzUrl: 'readyzUrl' in opts ? opts.readyzUrl : null,
      ceilingMs: h.ceilingMs,
      intervalMs: h.intervalMs,
      graceMs: h.graceMs,
      pageSize: 20,
    },
    h.io,
  );
}

// ===========================================================================
// The seven acceptance cases. Each names the stub that would turn it red.
// ===========================================================================

test('AC1: a deploy live at the wanted SHA exits 0', async () => {
  // Red-turn: change the stub status from 'live' to 'build_in_progress' and
  // the loop runs to the ceiling instead of returning 0.
  const h = harness({ pages: [[item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 1);
});

test('AC2: a build_failed deploy exits non-zero within one poll, naming the status', async () => {
  // Red-turn: change the stub status to 'build_in_progress' and it waits
  // rather than failing fast.
  const h = harness({ pages: [[item(WANT, 'build_failed')]] });
  assert.equal(await run(h), 1);
  assert.equal(h.counts.deploy, 1, 'failed fast: no second poll, no sleep');
  assert.equal(h.clock(), 0);
  assert.ok(h.logs.some((l) => /build_failed/.test(l)), 'status is in the output');
});

test('AC3: in-progress then live exits 0', async () => {
  // Red-turn: put 'build_in_progress' in TERMINAL_FAILED_STATUSES and the
  // first poll exits 1 instead of waiting.
  const h = harness({ pages: [[item(WANT, 'build_in_progress')], [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2);
});

test('AC4: a different SHA being the latest live deploy does not end the wait', async () => {
  // Red-turn: make selectDeploy return page[0].deploy regardless of commit id
  // and the first poll's PREV 'live' exits 0 at the wrong commit.
  const h = harness({ pages: [[item(PREV, 'live')], [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2, 'the PREV-live poll did not end the wait');
});

test('AC5: no deploy for the SHA past the grace period exits non-zero', async () => {
  // Red-turn: give any page here an item(WANT, ...) and grace never trips.
  const h = harness({ pages: [[], [item(PREV, 'live')], []], graceMs: 20000, intervalMs: 15000 });
  assert.equal(await run(h), 1);
  assert.ok(h.logs.some((l) => /no deploy/i.test(l) && /hook/i.test(l)), 'says the hook registered no deploy');
});

test('AC6: one malformed API response followed by live exits 0', async () => {
  // Red-turn: make a malformed body throw instead of counting as one spent
  // poll and the run crashes before reaching the live poll.
  const h = harness({ pages: ['MALFORMED', [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2);
});

test('AC7: readyz reporting the previous SHA while the deploy is live keeps waiting', async () => {
  // This is the incident: a poller that trusts the Render "live" signal alone
  // fires the hook while the web still serves the old commit.
  // Red-turn: drop the readyz check (exit 0 on 'live' alone) and poll 1's PREV
  // readyz exits 0 at the wrong moment.
  const h = harness({
    pages: [[item(WANT, 'live')], [item(WANT, 'live')]],
    readyz: [{ release: PREV }, { release: WANT }],
  });
  assert.equal(await run(h, { readyzUrl: 'http://api/readyz' }), 0);
  assert.equal(h.counts.deploy, 2, 'the live-but-stale-readyz poll did not end the wait');
  assert.equal(h.counts.readyz, 2);
});

// ===========================================================================
// Further behaviours the brief pins.
// ===========================================================================

test('every terminal-failed status fails fast within one poll, naming itself', async () => {
  for (const status of TERMINAL_FAILED_STATUSES) {
    const h = harness({ pages: [[item(WANT, status)]] });
    assert.equal(await run(h), 1, status);
    assert.equal(h.counts.deploy, 1, status);
    assert.ok(h.logs.some((l) => l.includes(status)), status);
  }
});

test('an unrecognised status keeps waiting rather than failing fast', async () => {
  // Red-turn: treat an unknown status as terminal and poll 1 exits 1.
  const h = harness({ pages: [[item(WANT, 'some_status_render_adds_in_2027')], [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2);
  assert.ok(h.logs.some((l) => /some_status_render_adds_in_2027/.test(l)));
});

test('the ceiling exits non-zero with the last observed status', async () => {
  // Red-turn: raise ceilingMs above 30000 and it never stops here.
  const h = harness({ pages: [[item(WANT, 'build_in_progress')]], ceilingMs: 30000, intervalMs: 15000 });
  assert.equal(await run(h), 1);
  assert.ok(h.logs.some((l) => /ceiling/i.test(l) && /build_in_progress/.test(l)));
});

test('a transient HTTP error is one spent poll, not the verdict', async () => {
  // Red-turn: return 1 on a non-ok response and the first poll ends the run.
  const h = harness({ pages: ['HTTP500', [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2);
});

test('a network failure (fetch rejects) is one spent poll, not the verdict', async () => {
  const h = harness({ pages: ['THROW', [item(WANT, 'live')]] });
  assert.equal(await run(h), 0);
  assert.equal(h.counts.deploy, 2);
});

test('a readyz call that fails keeps waiting, then succeeds when it recovers', async () => {
  // The deploy is live throughout; only readyz is flaky. The hook must not
  // fire until readyz confirms the SHA.
  const h = harness({
    pages: [[item(WANT, 'live')], [item(WANT, 'live')]],
    readyz: ['HTTP500', { release: WANT }],
  });
  assert.equal(await run(h, { readyzUrl: 'http://api/readyz' }), 0);
  assert.equal(h.counts.readyz, 2);
});

// ---------------------------------------------------------------------------
// selectDeploy(): pick the entry matching the commit, from a page of several.
// ---------------------------------------------------------------------------

test('selectDeploy returns the entry whose commit.id matches, not the latest', () => {
  const page = [item(PREV, 'live'), item(WANT, 'build_in_progress'), item('sha-older', 'live')];
  assert.equal(selectDeploy(page, WANT).status, 'build_in_progress');
  assert.equal(selectDeploy(page, 'nope'), null);
  assert.equal(selectDeploy([], WANT), null);
  assert.equal(selectDeploy(null, WANT), null);
});

test('selectDeploy tolerates malformed entries without throwing', () => {
  const page = [null, {}, { deploy: null }, { deploy: { status: 'live' } }, item(WANT, 'live')];
  assert.equal(selectDeploy(page, WANT).status, 'live');
});

// ---------------------------------------------------------------------------
// classifyStatus(): the three-way split the loop turns on.
// ---------------------------------------------------------------------------

test('classifyStatus splits live / failed / waiting, unknown -> waiting', () => {
  assert.equal(classifyStatus('live'), 'live');
  for (const s of TERMINAL_FAILED_STATUSES) assert.equal(classifyStatus(s), 'failed');
  for (const s of IN_PROGRESS_STATUSES) assert.equal(classifyStatus(s), 'waiting');
  assert.equal(classifyStatus('a_new_render_status'), 'waiting');
  assert.equal(classifyStatus(undefined), 'waiting');
});

// ---------------------------------------------------------------------------
// decide(): pure per-poll decision, so the branch table is pinned directly.
// ---------------------------------------------------------------------------

test('decide: live with no readyz configured succeeds', () => {
  const d = decide({ deploy: { status: 'live' }, readyzRelease: null }, { sha: WANT, hasReadyz: false, elapsedMs: 0, graceMs: 1000 });
  assert.equal(d.action, 'succeed');
});

test('decide: live with readyz still on the previous SHA waits', () => {
  const d = decide({ deploy: { status: 'live' }, readyzRelease: PREV }, { sha: WANT, hasReadyz: true, elapsedMs: 0, graceMs: 1000 });
  assert.equal(d.action, 'wait');
});

test('decide: no deploy within grace waits, past grace fails', () => {
  const before = decide({ deploy: null, readyzRelease: null }, { sha: WANT, hasReadyz: false, elapsedMs: 500, graceMs: 1000 });
  assert.equal(before.action, 'wait');
  const after = decide({ deploy: null, readyzRelease: null }, { sha: WANT, hasReadyz: false, elapsedMs: 1000, graceMs: 1000 });
  assert.equal(after.action, 'fail');
  assert.match(after.message, /hook/i);
});

// ---------------------------------------------------------------------------
// main(): argument and env plumbing.
// ---------------------------------------------------------------------------

test('main: missing service id / sha / api key each throw', async () => {
  await assert.rejects(main({ argv: ['--sha', WANT], env: { RENDER_API_KEY: 'k' } }), /service/i);
  await assert.rejects(main({ argv: ['--service', 'srv-x'], env: {} }), /sha|GITHUB_SHA/i);
  await assert.rejects(main({ argv: ['--service', 'srv-x', '--sha', WANT], env: {} }), /RENDER_API_KEY/);
});

test('main: parses flags and returns the poller exit code', async () => {
  const h = harness({ pages: [[item(WANT, 'live')]] });
  const code = await main({
    argv: ['--service', 'srv-web', '--sha', WANT, '--ceiling-ms', '2700000', '--interval-ms', '15000'],
    env: { RENDER_API_KEY: 'render-key' },
    io: h.io,
  });
  assert.equal(code, 0);
});

test('main: --sha falls back to GITHUB_SHA', async () => {
  const h = harness({ pages: [[item(WANT, 'live')]] });
  const code = await main({
    argv: ['--service', 'srv-web'],
    env: { RENDER_API_KEY: 'render-key', GITHUB_SHA: WANT },
    io: h.io,
  });
  assert.equal(code, 0);
});
