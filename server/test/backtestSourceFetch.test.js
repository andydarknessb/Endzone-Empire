const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAX_REDIRECTS,
  MAX_BYTES,
  BOOTSTRAP_HOSTS,
  sha256Hex,
  gitBlobSha1,
  assertGitBlobSha,
  assertSha256,
  parseHttpsUrl,
  assertHostAllowed,
  assertStableSourceUrl,
  assertDeclaredSizeWithinCap,
  fetchWithContract,
  assertColumns,
  writeVerified,
  readVerified,
  buildProvenanceRecord,
  allowlistFromProvenance,
  loadFrozenAllowlist,
} = require('../../scripts/backtest/lib/sourceFetch');
const { SOURCES, GAMES_CSV_BLOB, GAMES_CSV_COMMIT } = require('../../scripts/backtest/lib/sources');

const ALLOWED = ['github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com'];

/** A scripted transport: a queue of responses, one per hop, no network. */
function scriptedTransport(steps) {
  const seen = [];
  const transport = async (url) => {
    seen.push(url);
    const step = steps.shift();
    if (!step) throw new Error(`scripted transport ran out of responses at ${url}`);
    return step;
  };
  transport.seen = seen;
  return transport;
}

const ok = (body) => ({ statusCode: 200, headers: {}, body: Buffer.from(body) });
const redirect = (location) => ({ statusCode: 302, headers: { location }, body: Buffer.alloc(0) });

// --- hashing ---------------------------------------------------------------

test('sha256Hex matches a known digest and refuses non-Buffers', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.throws(() => sha256Hex('abc'), /requires a Buffer/);
});

test('gitBlobSha1 reproduces git hash-object for a known input', () => {
  // `printf 'hello' | git hash-object --stdin`
  assert.equal(gitBlobSha1(Buffer.from('hello')), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
});

test('assertGitBlobSha refuses bytes that are not the named revision', () => {
  const bytes = Buffer.from('hello');
  assert.equal(assertGitBlobSha(bytes, 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  assert.throws(() => assertGitBlobSha(bytes, 'f'.repeat(40)), /pinned git blob SHA/);
});

test('assertSha256 refuses a hash mismatch', () => {
  const bytes = Buffer.from('abc');
  assert.doesNotThrow(() => assertSha256(bytes, sha256Hex(bytes)));
  assert.throws(() => assertSha256(bytes, '0'.repeat(64)), /pinned SHA-256/);
});

// --- URL policy ------------------------------------------------------------

test('parseHttpsUrl refuses http, unparseable URLs, and embedded credentials', () => {
  assert.throws(() => parseHttpsUrl('http://github.com/x'), /non-https/);
  assert.throws(() => parseHttpsUrl('not a url'), /not a parseable URL/);
  assert.throws(() => parseHttpsUrl('https://user:pw@github.com/x'), /embedded credentials/);
  assert.equal(parseHttpsUrl('https://github.com/x').host, 'github.com');
});

test('assertHostAllowed rejects an off-allowlist host and names the allowlist', () => {
  assert.equal(assertHostAllowed('https://github.com/a', ALLOWED), 'github.com');
  assert.throws(
    () => assertHostAllowed('https://evil.example/a', ALLOWED),
    /host evil\.example is not on the pinned allowlist/
  );
});

test('assertStableSourceUrl refuses an expiring signed asset URL by name', () => {
  const signed =
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/2' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=300';
  assert.throws(() => assertStableSourceUrl(signed), /expiring signed asset URL/);
  assert.throws(() => assertStableSourceUrl(signed), /x-amz-signature/);
});

test('assertStableSourceUrl refuses any query string or fragment', () => {
  assert.throws(() => assertStableSourceUrl('https://github.com/a?v=1'), /query string or fragment/);
  assert.throws(() => assertStableSourceUrl('https://github.com/a#frag'), /query string or fragment/);
  assert.equal(assertStableSourceUrl('https://github.com/a/b.csv'), 'https://github.com/a/b.csv');
});

// --- size cap --------------------------------------------------------------

test('assertDeclaredSizeWithinCap refuses an oversized content-length before reading', () => {
  assert.equal(assertDeclaredSizeWithinCap('10', 100), true);
  assert.equal(assertDeclaredSizeWithinCap(undefined, 100), true, 'no header is not a breach');
  assert.throws(() => assertDeclaredSizeWithinCap('101', 100, { host: 'h' }), /declared 101 bytes, cap is 100/);
});

test('fetchWithContract refuses a body over the byte cap', async () => {
  const transport = scriptedTransport([ok('x'.repeat(50))]);
  await assert.rejects(
    fetchWithContract({ url: 'https://github.com/a.csv', allowedHosts: ALLOWED, transport, maxBytes: 10 }),
    /exceeds the 10-byte cap/
  );
});

// --- the redirect contract -------------------------------------------------

test('fetchWithContract follows a redirect and records EVERY host in the chain', async () => {
  const transport = scriptedTransport([
    redirect('https://release-assets.githubusercontent.com/asset?X-Amz-Signature=abc'),
    ok('season,week\n2025,1\n'),
  ]);
  const result = await fetchWithContract({
    url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',
    allowedHosts: ALLOWED,
    transport,
  });
  assert.deepEqual(result.observedHosts, ['github.com', 'release-assets.githubusercontent.com']);
  assert.equal(result.hops, 1);
  assert.equal(result.sha256, sha256Hex(Buffer.from('season,week\n2025,1\n')));
});

test('fetchWithContract rejects an OFF-ALLOWLIST redirect host even when the first host is allowed', async () => {
  const transport = scriptedTransport([redirect('https://cdn.evil.example/asset.csv'), ok('a,b\n1,2\n')]);
  await assert.rejects(
    fetchWithContract({ url: 'https://github.com/a.csv', allowedHosts: ALLOWED, transport }),
    /host cdn\.evil\.example is not on the pinned allowlist/
  );
  assert.equal(transport.seen.length, 1, 'the off-allowlist hop is never requested');
});

test('fetchWithContract rejects a redirect that downgrades to http', async () => {
  const transport = scriptedTransport([redirect('http://github.com/a.csv'), ok('a\n1\n')]);
  await assert.rejects(
    fetchWithContract({ url: 'https://github.com/a.csv', allowedHosts: ALLOWED, transport }),
    /non-https/
  );
});

test('fetchWithContract enforces the redirect cap', async () => {
  const steps = [];
  for (let i = 0; i < 12; i++) steps.push(redirect('https://github.com/hop' + i));
  const transport = scriptedTransport(steps);
  await assert.rejects(
    fetchWithContract({ url: 'https://github.com/a.csv', allowedHosts: ALLOWED, transport, maxRedirects: 2 }),
    /redirect cap of 2 exceeded/
  );
});

test('the frozen redirect cap is 5 and the frozen byte cap is 128 MiB', () => {
  assert.equal(MAX_REDIRECTS, 5);
  assert.equal(MAX_BYTES, 134217728);
});

test('fetchWithContract refuses a redirect with no location and a non-200 status', async () => {
  await assert.rejects(
    fetchWithContract({
      url: 'https://github.com/a.csv',
      allowedHosts: ALLOWED,
      transport: scriptedTransport([{ statusCode: 302, headers: {}, body: Buffer.alloc(0) }]),
    }),
    /302 redirect from github\.com with no location header/
  );
  await assert.rejects(
    fetchWithContract({
      url: 'https://github.com/a.csv',
      allowedHosts: ALLOWED,
      transport: scriptedTransport([{ statusCode: 404, headers: {}, body: Buffer.alloc(0) }]),
    }),
    /returned HTTP 404/
  );
});

test('fetchWithContract refuses an empty allowlist and a signed starting URL', async () => {
  await assert.rejects(
    fetchWithContract({ url: 'https://github.com/a.csv', allowedHosts: [], transport: scriptedTransport([]) }),
    /empty host allowlist/
  );
  await assert.rejects(
    fetchWithContract({
      url: 'https://github.com/a.csv?X-Amz-Signature=x',
      allowedHosts: ALLOWED,
      transport: scriptedTransport([]),
    }),
    /expiring signed asset URL/
  );
});

// --- schema ----------------------------------------------------------------

test('assertColumns names every missing column and refuses duplicate headers', () => {
  assert.equal(assertColumns({ header: ['a', 'b'], requiredColumns: ['a'] }), true);
  assert.throws(
    () => assertColumns({ header: ['a'], requiredColumns: ['a', 'b', 'c'], label: 'f' }),
    /f: schema validation failed, missing column\(s\) b, c/
  );
  assert.throws(
    () => assertColumns({ header: ['a', 'a'], requiredColumns: ['a'], label: 'f' }),
    /duplicate column name\(s\) a/
  );
});

// --- storage ---------------------------------------------------------------

test('writeVerified hashes the file it actually wrote, and readVerified refuses drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-fetch-'));
  try {
    const target = path.join(dir, 'nested', 'x.csv');
    const bytes = Buffer.from('a,b\n1,2\n');
    const written = writeVerified(target, bytes);
    assert.equal(written.byteLength, bytes.length);
    assert.equal(written.sha256, sha256Hex(bytes));
    assert.deepEqual(readVerified(target, written.sha256), bytes);

    fs.writeFileSync(target, Buffer.from('a,b\n1,3\n'));
    assert.throws(() => readVerified(target, written.sha256), /pinned SHA-256/);
    assert.throws(() => readVerified(target, null), /without an expected SHA-256/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- provenance ------------------------------------------------------------

test('buildProvenanceRecord refuses to store a signed asset URL as provenance', () => {
  assert.throws(
    () => buildProvenanceRecord({
      name: 'players',
      url: 'https://release-assets.githubusercontent.com/a?X-Amz-Signature=abc',
      bytes: Buffer.from('x'),
      observedHosts: ['release-assets.githubusercontent.com'],
    }),
    /expiring signed asset URL/
  );
});

test('buildProvenanceRecord records the stable URL, the byte hash, and the host chain', () => {
  const bytes = Buffer.from('season,week\n2025,1\n');
  const record = buildProvenanceRecord({
    name: 'players',
    url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',
    bytes,
    observedHosts: ['github.com', 'release-assets.githubusercontent.com'],
    requiredColumns: ['week', 'season'],
    header: ['season', 'week'],
    fetchedAt: '2026-07-29T00:00:00.000Z',
  });
  assert.equal(record.sha256, sha256Hex(bytes));
  assert.equal(record.byteLength, bytes.length);
  assert.deepEqual(record.observedHosts, ['github.com', 'release-assets.githubusercontent.com']);
  assert.deepEqual(record.requiredColumns, ['season', 'week'], 'sorted for stability');
  assert.equal(record.headerColumnCount, 2);
  assert.ok(!('X-Amz-Signature' in record));
});

test('buildProvenanceRecord refuses a missing chain or a chain entry that is not a bare host', () => {
  const base = { name: 'x', url: 'https://github.com/a.csv', bytes: Buffer.from('x') };
  assert.throws(() => buildProvenanceRecord({ ...base, observedHosts: [] }), /observed host chain/);
  assert.throws(
    () => buildProvenanceRecord({ ...base, observedHosts: ['github.com/nflverse'] }),
    /not a bare host/
  );
  assert.throws(() => buildProvenanceRecord({ ...base, observedHosts: ['github.com'], bytes: 'x' }), /requires the fetched Buffer/);
});

test('allowlistFromProvenance is the sorted union of every observed chain', () => {
  assert.deepEqual(
    allowlistFromProvenance([
      { observedHosts: ['github.com', 'release-assets.githubusercontent.com'] },
      { observedHosts: ['raw.githubusercontent.com'] },
      { observedHosts: ['github.com'] },
    ]),
    ['github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com']
  );
});

test('loadFrozenAllowlist refuses a host no discovery run could have observed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-allow-'));
  try {
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify({ hosts: ['github.com'] }));
    assert.deepEqual(loadFrozenAllowlist(good), ['github.com']);

    const stray = path.join(dir, 'stray.json');
    fs.writeFileSync(stray, JSON.stringify({ hosts: ['github.com', 'cdn.evil.example'] }));
    assert.throws(() => loadFrozenAllowlist(stray), /no discovery run could have observed/);

    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ hosts: [] }));
    assert.throws(() => loadFrozenAllowlist(empty), /has no hosts/);

    assert.throws(() => loadFrozenAllowlist(path.join(dir, 'nope.json')), /no frozen host allowlist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the pinned registry ---------------------------------------------------

test('every registry source has a stable, allowlist-shaped https URL and required columns', () => {
  assert.equal(SOURCES.length, 10);
  for (const source of SOURCES) {
    assert.doesNotThrow(() => assertStableSourceUrl(source.url), `${source.name} url`);
    assert.equal(parseHttpsUrl(source.url).protocol, 'https:');
    assert.ok(BOOTSTRAP_HOSTS.includes(parseHttpsUrl(source.url).host), `${source.name} host`);
    assert.ok(source.requiredColumns.length > 0, `${source.name} requiredColumns`);
  }
  const names = SOURCES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'source names are unique');
});

test('only games.csv is pinned by git blob, and it carries the plan-approved pin', () => {
  const pinned = SOURCES.filter((s) => s.gitBlobSha1);
  assert.deepEqual(pinned.map((s) => s.name), ['games']);
  assert.equal(pinned[0].gitBlobSha1, GAMES_CSV_BLOB);
  assert.equal(GAMES_CSV_BLOB, '4f1edd10f607152ad3a8a3286aac567929781c42');
  assert.equal(GAMES_CSV_COMMIT, 'b19514f50ba4675e128c21c818592b4d92061a8f');
  assert.ok(pinned[0].url.includes(GAMES_CSV_COMMIT), 'the URL pins the same commit');
});

test('the Phase-0 fetch tree never reaches a database', () => {
  // `server/modules/pool` builds a pg.Pool at module evaluation out of
  // process.env. Phase 0 is network-only by construction, so nothing in the
  // backtest tooling may require it, directly or transitively.
  const root = path.join(__dirname, '..', '..', 'scripts', 'backtest');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
  // Comments are stripped first: these files DOCUMENT why they must not reach
  // the pool, and a docblock naming `process.env` is the opposite of a defect.
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const files = walk(root);
  assert.ok(files.length >= 5, 'found the backtest tooling');
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const requires = [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      assert.ok(
        !/modules\/pool|server\/services|\.\.\/server/.test(spec),
        `${path.basename(file)} requires ${spec}, which can reach the production pool`
      );
    }
    // Stronger than banning DATABASE_URL by name: the tooling reads no
    // environment at all, so no credential can reach it however it is spelled.
    // (`process.argv` is fine; `process.env` is not.)
    assert.ok(!/process\.env/.test(text), `${path.basename(file)} reads process.env`);
  }
});
