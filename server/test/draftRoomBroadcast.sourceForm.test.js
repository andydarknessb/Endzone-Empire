const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Source-form guard for the one Draft room broadcast (#745), in the #633 style:
 * a plain source read beside the adapter's own tests, not a new guards-chain
 * script. It pins the invariant the fold exists to keep - a room-wide
 * `io.to(...).emit(...)` lives in ONE place - so the next author who reaches for
 * `io.to(...)` in a router or service is caught here, by name, instead of
 * quietly re-opening the drift #745 closed.
 *
 * The allowed set is spelled as a fixture this test reads. It has THREE entries,
 * and only two of them are the Draft room:
 *   - modules/draftRoomBroadcast.js - the one Draft room home (this module IS
 *     the `io.to(...)`);
 *   - modules/draftSocket.js - ONLY its deliverFeedEntry block, the per-recipient
 *     League chat delivery deliberately left outside the adapter (ADR 0012, and
 *     #745 scope item 4); a second assertion below pins it to that block.
 *   - services/scoring.service.js - the live-game `scores:updated` broadcast, a
 *     DIFFERENT domain (the live game engine, not the Draft room) that predates
 *     #745 and is deliberately out of its scope. It is listed so the guard is
 *     honest about every current `io.to(` and still fails on a NEW one; the raw
 *     `git grep "io.to("` in the issue's criterion 3 likewise returns this line.
 */
const SERVER_DIR = path.join(__dirname, '..');
const ALLOWED = [
  'modules/draftRoomBroadcast.js',
  'modules/draftSocket.js',
  'services/scoring.service.js',
];

/** Every .js file under a root, excluding server/test, node_modules, coverage. */
function jsFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === 'node_modules' || entry.name === 'coverage') continue;
        walk(p);
      } else if (entry.name.endsWith('.js')) {
        out.push(p);
      }
    }
  })(root);
  return out;
}

/** Relative POSIX paths (under `root`) of files whose source contains `io.to(`,
 *  minus those on the allowlist. Empty means "every room emit is accounted for". */
function unaccountedRoomEmits(root, allowed) {
  const allow = new Set(allowed);
  return jsFiles(root)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('io.to('))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .filter((rel) => !allow.has(rel));
}

test('a room-wide io.to(...) appears only in the allowed source files', () => {
  assert.deepEqual(
    unaccountedRoomEmits(SERVER_DIR, ALLOWED),
    [],
    'a new io.to(...) room emit must go through draftRoomBroadcast, not a router/service'
  );
});

test('in draftSocket.js, every io.to(...) is inside the deliverFeedEntry block (ADR 0012)', () => {
  const source = fs.readFileSync(path.join(SERVER_DIR, 'modules', 'draftSocket.js'), 'utf8');
  const start = source.indexOf('async function deliverFeedEntry');
  assert.ok(start !== -1, 'deliverFeedEntry still exists');
  // The block ends at the next top-level function/const declaration after it.
  const rest = source.slice(start + 1);
  const nextDecl = rest.search(/\n(?:async function |function |const |module\.exports)/);
  const end = nextDecl === -1 ? source.length : start + 1 + nextDecl;

  let idx = source.indexOf('io.to(');
  let count = 0;
  while (idx !== -1) {
    count += 1;
    assert.ok(idx >= start && idx < end, `io.to( at index ${idx} is outside deliverFeedEntry`);
    idx = source.indexOf('io.to(', idx + 1);
  }
  assert.ok(count > 0, 'deliverFeedEntry still emits to the room');
});

test('negative control: a stray io.to(...).emit(draft:state) in a router is caught, both in this file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-room-guard-'));
  try {
    // A temp copy of a real router with a stray room emit appended - exactly the
    // regression the guard exists to catch.
    const router = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'draft.router.js'), 'utf8');
    const doctored = `${router}\n// stray reintroduced for the negative control\nio.to(\`league:1\`).emit('draft:state', {});\n`;
    fs.writeFileSync(path.join(tmp, 'draft.router.js'), doctored);

    // Nothing in the temp tree is on an allowlist, so the doctored copy is flagged.
    const flagged = unaccountedRoomEmits(tmp, []);
    assert.deepEqual(flagged, ['draft.router.js'], 'the stray io.to(...).emit(draft:state) is flagged red');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
