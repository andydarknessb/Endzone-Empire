'use strict';

/**
 * The FROZEN source-fetcher contract for the reconstructed historical backtest
 * (Phase 0 tooling). Every external byte the backtest is ever allowed to rest
 * on enters through here, once, and is pinned by hash from that moment on.
 *
 * Why this exists at all: `free_baseline_v3.1`'s constants were selected by a
 * backtest whose inputs were whatever the database happened to hold on the day
 * it ran. The replacement harness rests on immutable pinned bytes instead, so
 * the fetch itself has to be auditable: which host actually served the bytes,
 * how many hops, how big, and does the file still hash to what the
 * preregistration sealed.
 *
 * The contract, all of it enforced here and none of it optional:
 *
 *   1. HTTPS only. A plain-http URL is refused, including as a redirect
 *      target, so a downgrade cannot silently happen mid-chain.
 *   2. Pinned host allowlist. EVERY host in the observed chain must be on the
 *      list, not merely the first one. GitHub release downloads redirect to a
 *      separate asset host (nflverseSync.service.js:33 downloads from
 *      `github.com/.../releases/download`), so a same-host-only rule would
 *      reject valid downloads; an allowlist frozen from the hosts ACTUALLY
 *      observed during the Phase-0 fetches is the honest version of the same
 *      idea. The frozen list lives in `allowed-hosts.json` next to this file
 *      and is reproduced verbatim in the preregistration.
 *   3. Capped redirects (MAX_REDIRECTS), fixed timeout (TIMEOUT_MS), maximum
 *      download size (MAX_BYTES) enforced DURING the download, so a source
 *      that starts streaming an unbounded body is aborted rather than
 *      buffered.
 *   4. Schema validation: the file's header must carry every column a
 *      preregistered rule depends on.
 *   5. Exact-byte SHA-256 verification on write AND on every later read.
 *   6. Provenance records the STABLE source URL plus the byte hash, never the
 *      expiring signed asset URL a release download redirects to. A signed URL
 *      is refused outright by `assertStableSourceUrl` rather than stored: a
 *      provenance record nobody can re-fetch from is not provenance.
 *
 * Everything here is pure or explicitly injected: `fetchWithContract` takes its
 * transport as an argument, so the contract is tested without a network.
 *
 * Clauses 4, 5 and 6's byte-level half (schema validation, hash verification,
 * verified write/read) lives in `verifiedBytes.js` and is re-exported here
 * unchanged. Phase 1 must be able to READ a pinned file without importing a
 * fetcher — see that file's docblock — and the contract is still one module
 * from any caller's point of view.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const {
  sha256Hex,
  gitBlobSha1,
  assertGitBlobSha,
  assertSha256,
  assertColumns,
  writeVerified,
  readVerified,
  readProvenanceRecords,
} = require('./verifiedBytes');

/** Frozen numeric limits. Changing any of these changes the sealed contract. */
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 120000;
const MAX_BYTES = 134217728; // 128 MiB

/**
 * The ONLY hosts a discovery run may follow. This is not the frozen
 * allowlist: it is the deliberately narrow set the very first (pre-freeze)
 * fetch is permitted to explore, so that "frozen from what we observed" can
 * never mean "frozen from wherever a redirect happened to point". The frozen
 * allowlist is the subset actually observed, written to allowed-hosts.json.
 */
const BOOTSTRAP_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const ALLOWLIST_PATH = path.join(__dirname, 'allowed-hosts.json');

/**
 * Query parameters that mark a URL as a short-lived signed asset link. The
 * primary rule below is stricter than this list (any query string at all is
 * refused); the list exists so the failure names WHY, which is the difference
 * between an operator fixing the pin and an operator deleting the check.
 */
const SIGNING_PARAMS = Object.freeze([
  'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'x-amz-date',
  'x-amz-expires', 'x-amz-algorithm', 'x-amz-signedheaders',
  'awsaccesskeyid', 'signature', 'sig', 'expires', 'token', 'jwt',
  'actor_id', 'key_id', 'key', 'se', 'sp', 'sv', 'sr', 'st', 'skoid',
  'verify', 'x-goog-signature',
]);

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

/** Pure: parse and require https, no credentials embedded in the URL. */
function parseHttpsUrl(url, { label = 'url' } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (err) {
    throw new Error(`${label}: not a parseable URL (${String(url)})`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label}: refusing non-https URL ${parsed.protocol}//${parsed.host}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label}: refusing a URL carrying embedded credentials`);
  }
  return parsed;
}

/** Fail loud unless the URL's host is on the supplied allowlist. */
function assertHostAllowed(url, allowedHosts, { label = 'url' } = {}) {
  const parsed = parseHttpsUrl(url, { label });
  const allowed = new Set(allowedHosts || []);
  if (!allowed.has(parsed.host)) {
    throw new Error(
      `${label}: host ${parsed.host} is not on the pinned allowlist ` +
      `[${[...allowed].sort().join(', ')}] - refusing to fetch`
    );
  }
  return parsed.host;
}

/**
 * Fail loud unless the URL is a STABLE source URL fit to record as provenance:
 * https, allowlisted-shaped (no credentials), and carrying no query string or
 * fragment at all. Signed release-asset URLs always carry a query; naming the
 * specific signing parameter when one is present makes the refusal legible.
 */
function assertStableSourceUrl(url, { label = 'source url' } = {}) {
  const parsed = parseHttpsUrl(url, { label });
  const params = [...parsed.searchParams.keys()].map((k) => k.toLowerCase());
  const signing = params.filter((k) => SIGNING_PARAMS.includes(k));
  if (signing.length > 0) {
    throw new Error(
      `${label}: refusing to record an expiring signed asset URL as provenance ` +
      `(signing parameter${signing.length > 1 ? 's' : ''} ${signing.join(', ')}); ` +
      'provenance must name the stable source URL plus the byte hash'
    );
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error(
      `${label}: refusing to record a URL with a query string or fragment as provenance ` +
      '(a stable source URL has neither)'
    );
  }
  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Pure: the declared-length gate. Split out so the cap is testable without a
 * network, and so the "refuse before reading a chunk" ordering is a property
 * of a named function rather than of a callback's line order.
 */
function assertDeclaredSizeWithinCap(contentLengthHeader, maxBytes, { host = 'source' } = {}) {
  const declared = Number(contentLengthHeader);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`download refused: ${host} declared ${declared} bytes, cap is ${maxBytes}`);
  }
  return true;
}

/**
 * ONE https request, no redirect following, size- and time-capped. Separated
 * from the redirect loop so the contract (`fetchWithContract`) can be tested
 * against an injected transport with no network at all.
 *
 * The size cap is applied to bytes as they arrive and destroys the response on
 * breach, so an oversized body is never fully buffered. A declared
 * content-length over the cap is refused before a single chunk is read.
 */
function httpsGetOnce(url, { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = parseHttpsUrl(url, { label: 'request' });
    const req = https.request(
      parsed,
      { method: 'GET', headers: { 'user-agent': 'endzone-empire-backtest-phase0', accept: '*/*' } },
      (res) => {
        try {
          assertDeclaredSizeWithinCap(res.headers['content-length'], maxBytes, { host: parsed.host });
        } catch (err) {
          res.destroy();
          reject(err);
          return;
        }
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            reject(new Error(`download refused: body exceeded the ${maxBytes}-byte cap`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks, total),
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request to ${parsed.host} timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

/**
 * Fetch one URL under the frozen contract, following redirects MANUALLY so
 * every host in the chain is observed, checked against the allowlist, and
 * reported back for pinning. An http client that follows redirects internally
 * (axios, fetch) hides exactly the fact this function exists to record.
 *
 * Returns `{ bytes, sha256, observedHosts, hops, finalStatus }`. `observedHosts`
 * is the ordered chain starting with the requested host; the SIGNED final URL
 * is never returned or recorded, only its host.
 */
async function fetchWithContract({
  url,
  allowedHosts,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = TIMEOUT_MS,
  maxBytes = MAX_BYTES,
  transport = httpsGetOnce,
  label = 'fetch',
}) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new Error(`${label}: refusing to fetch with an empty host allowlist`);
  }
  let current = assertStableSourceUrl(url, { label: `${label} source url` });
  const observedHosts = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const host = assertHostAllowed(current, allowedHosts, { label: `${label} hop ${hop}` });
    observedHosts.push(host);
    const res = await transport(current, { timeoutMs, maxBytes });
    const status = Number(res && res.statusCode);
    if (status >= 300 && status < 400) {
      const location = res.headers && (res.headers.location || res.headers.Location);
      if (!location) {
        throw new Error(`${label}: ${status} redirect from ${host} with no location header`);
      }
      if (hop === maxRedirects) {
        throw new Error(
          `${label}: redirect cap of ${maxRedirects} exceeded (chain ${observedHosts.join(' -> ')})`
        );
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (status !== 200) {
      throw new Error(`${label}: ${host} returned HTTP ${status}`);
    }
    const bytes = res.body;
    if (!Buffer.isBuffer(bytes)) throw new Error(`${label}: transport returned a non-Buffer body`);
    if (bytes.length > maxBytes) {
      throw new Error(`${label}: body of ${bytes.length} bytes exceeds the ${maxBytes}-byte cap`);
    }
    return {
      bytes,
      sha256: sha256Hex(bytes),
      observedHosts,
      hops: hop,
      finalStatus: status,
    };
  }
  /* istanbul ignore next - the loop returns or throws on every path */
  throw new Error(`${label}: redirect cap of ${maxRedirects} exceeded`);
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Pure: build one provenance record. Deliberately takes the STABLE url and the
 * observed host chain separately - the signed URL the release download
 * redirected to is not an input to this function and cannot be recorded by it.
 */
function buildProvenanceRecord({
  name,
  url,
  bytes,
  observedHosts,
  requiredColumns = [],
  header = null,
  gitBlob = null,
  fetchedAt = null,
}) {
  if (!name) throw new Error('provenance record requires a name');
  const stableUrl = assertStableSourceUrl(url, { label: `${name} source url` });
  if (!Buffer.isBuffer(bytes)) throw new Error(`${name}: provenance requires the fetched Buffer`);
  if (!Array.isArray(observedHosts) || observedHosts.length === 0) {
    throw new Error(`${name}: provenance requires the observed host chain`);
  }
  for (const host of observedHosts) {
    if (typeof host !== 'string' || host.length === 0 || host.includes('/')) {
      throw new Error(`${name}: observed host chain entry is not a bare host (${String(host)})`);
    }
  }
  const record = {
    name,
    url: stableUrl,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
    observedHosts: [...observedHosts],
    requiredColumns: [...requiredColumns].sort(),
  };
  if (header) record.headerColumnCount = header.length;
  if (gitBlob) record.gitBlobSha1 = gitBlob;
  if (fetchedAt) record.fetchedAt = fetchedAt;
  return record;
}

/** Pure: the frozen allowlist implied by a set of provenance records. */
function allowlistFromProvenance(records) {
  const hosts = new Set();
  for (const record of records || []) {
    for (const host of record.observedHosts || []) hosts.add(host);
  }
  return [...hosts].sort();
}

/** Load the frozen host allowlist. Fails loud if it has not been frozen yet. */
function loadFrozenAllowlist(allowlistPath = ALLOWLIST_PATH) {
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(
      `no frozen host allowlist at ${allowlistPath} - run the discovery fetch first ` +
      '(fetch-sources.js --discover), then freeze it (--freeze-allowlist --apply)'
    );
  }
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const hosts = parsed && parsed.hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new Error(`${allowlistPath}: frozen allowlist has no hosts`);
  }
  const stray = hosts.filter((h) => !BOOTSTRAP_HOSTS.includes(h));
  if (stray.length > 0) {
    throw new Error(
      `${allowlistPath}: frozen allowlist contains host(s) no discovery run could have observed ` +
      `(${stray.join(', ')}) - the bootstrap set is [${BOOTSTRAP_HOSTS.join(', ')}]`
    );
  }
  return hosts;
}

module.exports = {
  MAX_REDIRECTS,
  TIMEOUT_MS,
  MAX_BYTES,
  BOOTSTRAP_HOSTS,
  ALLOWLIST_PATH,
  SIGNING_PARAMS,
  sha256Hex,
  gitBlobSha1,
  assertGitBlobSha,
  assertSha256,
  parseHttpsUrl,
  assertHostAllowed,
  assertStableSourceUrl,
  assertDeclaredSizeWithinCap,
  httpsGetOnce,
  fetchWithContract,
  assertColumns,
  writeVerified,
  readVerified,
  readProvenanceRecords,
  buildProvenanceRecord,
  allowlistFromProvenance,
  loadFrozenAllowlist,
};
