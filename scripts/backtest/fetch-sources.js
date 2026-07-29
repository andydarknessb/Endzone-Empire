/* eslint-disable no-console */
'use strict';

/**
 * Phase 0 of the reconstructed historical backtest: fetch, hash, and PERSIST
 * the pinned external sources the whole harness will rest on.
 *
 * Usage:
 *   node scripts/backtest/fetch-sources.js --discover [--only <name>]...
 *   node scripts/backtest/fetch-sources.js --freeze-allowlist [--apply]
 *   node scripts/backtest/fetch-sources.js [--only <name>]... [--force [--repin]]
 *   node scripts/backtest/fetch-sources.js --verify
 *
 * Every byte enters through the frozen fetcher contract in
 * `lib/sourceFetch.js`: https only, pinned host allowlist checked at EVERY hop,
 * capped redirects, fixed timeout, maximum download size, schema validation,
 * and SHA-256 verification on write and on every later read. Provenance
 * records the stable source URL plus the byte hash, never the expiring signed
 * asset URL a GitHub release download redirects to.
 *
 * Why there are two fetch modes. The allowlist is supposed to be frozen from
 * the hosts ACTUALLY observed, which cannot be known before the first fetch.
 * `--discover` therefore runs against a deliberately narrow BOOTSTRAP set (the
 * four github.com/githubusercontent.com hosts a release download can plausibly
 * land on) and records the chain each file really took. `--freeze-allowlist`
 * then writes exactly the observed subset to `lib/allowed-hosts.json`, and
 * every later run uses only that. This is the one write outside
 * `backtest-data/`, so it is dry-run by default and needs an explicit --apply.
 *
 * Re-running is safe and does NOT silently repin. nflverse release assets are
 * replaced in place, so a later fetch can legitimately return different bytes;
 * an already-fetched, hash-verified file is skipped. `--force` refetches and
 * FAILS if the bytes changed, unless `--repin` says that is intended. After
 * the preregistration seals, repinning invalidates it.
 *
 * No database of any kind is reachable from here: nothing in this tree
 * requires `server/modules/pool`, directly or transitively, and nothing reads
 * DATABASE_URL. Phase 0 is network-only by construction.
 */

const fs = require('fs');
const path = require('path');

const {
  BOOTSTRAP_HOSTS,
  ALLOWLIST_PATH,
  MAX_REDIRECTS,
  TIMEOUT_MS,
  MAX_BYTES,
  fetchWithContract,
  assertColumns,
  assertGitBlobSha,
  writeVerified,
  readVerified,
  buildProvenanceRecord,
  allowlistFromProvenance,
  loadFrozenAllowlist,
} = require('./lib/sourceFetch');
const { parseCsvHeader } = require('./lib/csv');
const { SOURCES } = require('./lib/sources');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'backtest-data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const PROVENANCE_PATH = path.join(SOURCES_DIR, 'provenance.json');

function parseArgs(argv) {
  const args = {
    discover: false,
    freezeAllowlist: false,
    apply: false,
    verify: false,
    force: false,
    repin: false,
    dryRun: false,
    only: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--discover') args.discover = true;
    else if (token === '--freeze-allowlist') args.freezeAllowlist = true;
    else if (token === '--apply') args.apply = true;
    else if (token === '--verify') args.verify = true;
    else if (token === '--force') args.force = true;
    else if (token === '--repin') args.repin = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--only') args.only.push(argv[++i]);
    else if (token.startsWith('--only=')) args.only.push(token.slice('--only='.length));
    else throw new Error(`unknown argument ${token}`);
  }
  const modes = [args.discover, args.freezeAllowlist, args.verify].filter(Boolean).length;
  if (modes > 1) {
    throw new Error('--discover, --freeze-allowlist and --verify are mutually exclusive modes');
  }
  if (args.repin && !args.force) throw new Error('--repin only means anything with --force');
  return args;
}

function loadProvenance() {
  if (!fs.existsSync(PROVENANCE_PATH)) return { records: [] };
  return JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
}

/**
 * Provenance is written with sorted keys and a fixed record order so the file
 * is byte-stable across machines; `fetchedAt` is the only field that moves,
 * and it is per-record so an unchanged source keeps its original stamp.
 */
function writeProvenance(records, { allowlistSource }) {
  const ordered = SOURCES
    .map((s) => records.find((r) => r.name === s.name))
    .filter(Boolean);
  const doc = {
    generator: 'scripts/backtest/fetch-sources.js',
    contract: {
      protocol: 'https',
      maxRedirects: MAX_REDIRECTS,
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      allowlistSource,
      observedHosts: allowlistFromProvenance(ordered),
    },
    records: ordered,
  };
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  fs.writeFileSync(PROVENANCE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function selectedSources(only) {
  if (!only || only.length === 0) return SOURCES;
  const names = new Set(only);
  const unknown = [...names].filter((n) => !SOURCES.some((s) => s.name === n));
  if (unknown.length > 0) throw new Error(`unknown source name(s): ${unknown.join(', ')}`);
  return SOURCES.filter((s) => names.has(s.name));
}

/** Fetch one source under the contract, validate it, and persist it. */
async function fetchOne(source, allowedHosts) {
  const result = await fetchWithContract({
    url: source.url,
    allowedHosts,
    label: source.name,
  });
  const text = result.bytes.toString('utf8');
  const header = parseCsvHeader(text);
  assertColumns({
    header,
    requiredColumns: source.requiredColumns,
    label: source.name,
  });
  if (source.gitBlobSha1) {
    assertGitBlobSha(result.bytes, source.gitBlobSha1, { label: source.name });
  }
  const target = path.join(SOURCES_DIR, source.file);
  const written = writeVerified(target, result.bytes, { label: source.name });
  const record = buildProvenanceRecord({
    name: source.name,
    url: source.url,
    bytes: result.bytes,
    observedHosts: result.observedHosts,
    requiredColumns: source.requiredColumns,
    header,
    gitBlob: source.gitBlobSha1 ? assertGitBlobSha(result.bytes, source.gitBlobSha1, { label: source.name }) : null,
    fetchedAt: new Date().toISOString(),
  });
  record.presentOptionalColumns = (source.optionalColumns || []).filter((c) => header.includes(c)).sort();
  record.absentOptionalColumns = (source.optionalColumns || []).filter((c) => !header.includes(c)).sort();
  record.hops = result.hops;
  console.log(
    `  ${source.name}: ${written.byteLength} bytes, sha256 ${written.sha256}, ` +
    `chain ${result.observedHosts.join(' -> ')}, ${header.length} columns`
  );
  if (record.absentOptionalColumns.length > 0) {
    console.log(`    optional columns ABSENT: ${record.absentOptionalColumns.join(', ')}`);
  }
  return record;
}

async function runFetch(args) {
  const discovering = args.discover;
  const allowedHosts = discovering ? [...BOOTSTRAP_HOSTS] : loadFrozenAllowlist();
  const allowlistSource = discovering ? 'bootstrap (discovery run)' : path.relative(REPO_ROOT, ALLOWLIST_PATH).split(path.sep).join('/');
  console.log(`host allowlist (${allowlistSource}): ${allowedHosts.join(', ')}`);
  console.log(`limits: <=${MAX_REDIRECTS} redirects, ${TIMEOUT_MS}ms timeout, <=${MAX_BYTES} bytes`);

  const provenance = loadProvenance();
  const existing = new Map((provenance.records || []).map((r) => [r.name, r]));
  const targets = selectedSources(args.only);

  if (args.dryRun) {
    console.log('DRY RUN - would fetch:');
    for (const source of targets) {
      const have = existing.get(source.name);
      const onDisk = fs.existsSync(path.join(SOURCES_DIR, source.file));
      const skip = have && onDisk && !args.force;
      console.log(`  ${skip ? 'skip  ' : 'fetch '} ${source.name}  ${source.url}`);
    }
    return 0;
  }

  const records = [...(provenance.records || [])];
  let fetched = 0;
  let skipped = 0;
  for (const source of targets) {
    const have = existing.get(source.name);
    const target = path.join(SOURCES_DIR, source.file);
    if (have && fs.existsSync(target) && !args.force) {
      readVerified(target, have.sha256, { label: source.name });
      console.log(`  ${source.name}: already pinned, bytes verified (sha256 ${have.sha256})`);
      skipped++;
      continue;
    }
    const record = await fetchOne(source, allowedHosts);
    if (have && have.sha256 !== record.sha256 && !args.repin) {
      throw new Error(
        `${source.name}: refetched bytes differ from the pinned ones ` +
        `(was ${have.sha256}, now ${record.sha256}). nflverse replaces release assets in place, ` +
        'so this is expected over time - but repinning invalidates anything sealed against the old ' +
        'bytes. Pass --repin if that is genuinely intended.'
      );
    }
    if (have && have.sha256 === record.sha256 && have.fetchedAt) {
      record.fetchedAt = have.fetchedAt; // unchanged bytes keep their original stamp
    }
    const at = records.findIndex((r) => r.name === source.name);
    if (at >= 0) records[at] = record;
    else records.push(record);
    fetched++;
  }

  const doc = writeProvenance(records, { allowlistSource });
  console.log(`\nfetched ${fetched}, skipped ${skipped}; provenance -> ${path.relative(REPO_ROOT, PROVENANCE_PATH)}`);
  console.log(`observed host chain union: ${doc.contract.observedHosts.join(', ')}`);

  if (discovering) {
    const observedPath = path.join(DATA_DIR, 'observed-hosts.json');
    fs.writeFileSync(
      observedPath,
      `${JSON.stringify({ hosts: doc.contract.observedHosts, bootstrap: [...BOOTSTRAP_HOSTS] }, null, 2)}\n`
    );
    console.log(`observed hosts -> ${path.relative(REPO_ROOT, observedPath)}`);
    console.log('next: node scripts/backtest/fetch-sources.js --freeze-allowlist --apply');
  }
  return 0;
}

function runFreezeAllowlist(args) {
  const provenance = loadProvenance();
  if (!provenance.records || provenance.records.length !== SOURCES.length) {
    throw new Error(
      `refusing to freeze the allowlist from a partial discovery run ` +
      `(${(provenance.records || []).length} of ${SOURCES.length} sources recorded)`
    );
  }
  const hosts = allowlistFromProvenance(provenance.records);
  const stray = hosts.filter((h) => !BOOTSTRAP_HOSTS.includes(h));
  if (stray.length > 0) throw new Error(`observed host(s) outside the bootstrap set: ${stray.join(', ')}`);
  const doc = {
    frozen: 'The exact set of hosts observed while fetching every pinned source in Phase 0.',
    hosts,
    perSource: Object.fromEntries(
      provenance.records.map((r) => [r.name, r.observedHosts])
    ),
  };
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  if (!args.apply) {
    console.log('DRY RUN - would write the frozen allowlist to');
    console.log(`  ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
    console.log(body);
    console.log('re-run with --apply to write it');
    return 0;
  }
  fs.writeFileSync(ALLOWLIST_PATH, body);
  console.log(`frozen allowlist written to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}: ${hosts.join(', ')}`);
  return 0;
}

/** No network at all: prove every persisted source still is what was pinned. */
function runVerify() {
  const provenance = loadProvenance();
  const records = provenance.records || [];
  if (records.length === 0) throw new Error('nothing to verify: no provenance records');
  const problems = [];
  for (const source of SOURCES) {
    const record = records.find((r) => r.name === source.name);
    if (!record) {
      problems.push(`${source.name}: no provenance record`);
      continue;
    }
    const target = path.join(SOURCES_DIR, source.file);
    if (!fs.existsSync(target)) {
      problems.push(`${source.name}: pinned file missing at ${path.relative(REPO_ROOT, target)}`);
      continue;
    }
    const bytes = readVerified(target, record.sha256, { label: source.name });
    if (bytes.length !== record.byteLength) {
      problems.push(`${source.name}: ${bytes.length} bytes on disk, ${record.byteLength} recorded`);
      continue;
    }
    const header = parseCsvHeader(bytes.toString('utf8'));
    assertColumns({ header, requiredColumns: source.requiredColumns, label: source.name });
    if (source.gitBlobSha1) assertGitBlobSha(bytes, source.gitBlobSha1, { label: source.name });
    console.log(`  ${source.name}: OK (${bytes.length} bytes, sha256 ${record.sha256})`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`  FAIL ${p}`);
    throw new Error(`${problems.length} source(s) failed verification`);
  }
  console.log('all pinned sources verified');
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.freezeAllowlist) return runFreezeAllowlist(args);
  if (args.verify) return runVerify();
  return runFetch(args);
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = { parseArgs, DATA_DIR, SOURCES_DIR, PROVENANCE_PATH };
