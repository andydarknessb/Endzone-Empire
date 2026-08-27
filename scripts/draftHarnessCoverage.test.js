const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  enumerateClientCalls,
  compareCoverage,
  runGuard,
  DEFAULT_ROOT,
  DEFAULT_ENTRY,
} = require('./checkDraftHarnessCoverage');
const { routeTable, unstubbed } = require('../tests/e2e/fixtures/draftRouteTable');

// Guard for issue #474 (ADR 0014): the Draft room must not call an /api/
// endpoint the Draft E2E harness does not answer. The static half walks the
// room's client-side import closure, enumerates its api-client calls, and
// checks each against the harness route table or a declared exemption.
//
// The pure tests below run the guard against synthetic fixture trees so each
// failure path is proven in isolation (a missing entry, a zero count, a
// non-literal call, an exempted file that overreaches). The final block runs
// the guard against the REAL tree: green as it stands, and red the moment a
// historically-missing entry is removed from a copy of the table. Do not read
// the presence of this file as proof on its own; it only bites on a pull
// request because the `guards` npm script (and the `guards` CI job that runs
// it) includes test:draft-harness-coverage.

/**
 * Writes a fixture tree under a fresh temp dir and returns its root. `files`
 * maps a path relative to `<root>/src` to file content. An api-client stub is
 * always written at src/api/apiClient.js so relative default-import resolution
 * finds it, exactly as the real tree does.
 */
function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-guard-'));
  const write = (relFromSrc, content) => {
    const abs = path.join(root, 'src', relFromSrc);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  write('api/apiClient.js', 'export default {};\n');
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return root;
}

test('enumerate: string and template literals, method paired, query dropped, ${} -> :param', () => {
  const root = makeTree({
    'entry.jsx': `
      import apiClient from './api/apiClient';
      export default function Entry(id, seq) {
        apiClient.get('/api/players');
        apiClient.post(\`/api/league/\${id}/chat/read\`);
        apiClient.get(\`/api/league/\${id}/draft-feed?before=\${seq}\`);
        return null;
      }
    `,
  });
  const { calls, nonLiteral } = enumerateClientCalls(root, 'src/entry.jsx');
  assert.equal(nonLiteral.length, 0);
  const keys = calls.map((c) => `${c.method} ${c.pattern}`).sort();
  assert.deepEqual(keys, [
    'GET /api/league/:param/draft-feed', // query string dropped
    'GET /api/players',
    'POST /api/league/:param/chat/read',
  ]);
});

test('enumerate: follows relative imports transitively, skips test files and assets', () => {
  const root = makeTree({
    'entry.jsx': `
      import './hooks/useThing';
      import './entry.css';
      import './entry.test';
    `,
    'hooks/useThing.js': `
      import apiClient from '../api/apiClient';
      export function useThing() { apiClient.get('/api/thing'); }
    `,
    'entry.css': `.x{}`,
    'entry.test.js': `
      import apiClient from './api/apiClient';
      apiClient.get('/api/should-not-be-seen');
    `,
  });
  const { calls } = enumerateClientCalls(root, 'src/entry.jsx');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.pattern}`), ['GET /api/thing']);
});

test('missing table entry is reported as an offender naming method, path and file', () => {
  const root = makeTree({
    'entry.jsx': `
      import apiClient from './api/apiClient';
      export default () => apiClient.get('/api/uncovered');
    `,
  });
  const en = enumerateClientCalls(root, 'src/entry.jsx');
  const { offenders } = compareCoverage(en, [], []);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /GET \/api\/uncovered/);
  assert.match(offenders[0], /entry\.jsx/);
});

test('zero enumerated calls is itself a failure', () => {
  const root = makeTree({
    'entry.jsx': `export default function Entry() { return null; }`,
  });
  const result = runGuard(root, 'src/entry.jsx', routeTable, unstubbed);
  assert.equal(result.callCount, 0);
  assert.equal(result.ok, false);
  assert.ok(result.messages.some((m) => /ZERO api-client calls/.test(m)), result.messages.join('\n'));
});

test('a non-literal api-client first argument is reported as a failure naming the file', () => {
  const root = makeTree({
    'entry.jsx': `
      import apiClient from './api/apiClient';
      export default function Entry(url) {
        apiClient.get(url);
        apiClient.post('/api/' + 'concatenated');
        return null;
      }
    `,
  });
  const en = enumerateClientCalls(root, 'src/entry.jsx');
  assert.equal(en.nonLiteral.length, 2, 'identifier arg and string concatenation are both non-literal');
  const { offenders } = compareCoverage(en, routeTable, []);
  assert.equal(offenders.length, 2);
  assert.ok(offenders.every((o) => /entry\.jsx/.test(o)));
  assert.ok(offenders.some((o) => /non-literal/.test(o)));
});

test('exempted file: a literal not in the exemption list fails naming that path', () => {
  const root = makeTree({
    'admin.js': `
      import apiClient from './api/apiClient';
      export function admin(id) {
        apiClient.post(\`/api/draft/league/\${id}/allowed\`);
        apiClient.post(\`/api/draft/league/\${id}/sneaked-in\`);
      }
    `,
    'entry.jsx': `import { admin } from './admin'; export default () => admin;`,
  });
  const en = enumerateClientCalls(root, 'src/entry.jsx');
  const exemptions = [
    {
      file: 'admin.js',
      reason: 'click-only',
      paths: [{ method: 'POST', pattern: '/api/draft/league/:id/allowed' }],
    },
  ];
  const { offenders } = compareCoverage(en, [], exemptions);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /sneaked-in/);
  assert.match(offenders[0], /exemption list/);
});

test('exempted file: a non-literal call in a declared file is acknowledged, not an offender', () => {
  const root = makeTree({
    'generic.js': `
      import apiClient from './api/apiClient';
      export function fetchAny(url) { return apiClient.get(url); }
    `,
    'entry.jsx': `import { fetchAny } from './generic'; export default () => fetchAny;`,
  });
  const en = enumerateClientCalls(root, 'src/entry.jsx');
  assert.equal(en.nonLiteral.length, 1);
  const { offenders } = compareCoverage(en, routeTable, [
    { file: 'generic.js', reason: 'generic fetcher', paths: [] },
  ]);
  assert.deepEqual(offenders, []);
});

test('canonical match: a table pattern with named params matches an enumerated :param path', () => {
  const root = makeTree({
    'entry.jsx': `
      import apiClient from './api/apiClient';
      export default (id) => apiClient.get(\`/api/players/\${id}/summary\`);
    `,
  });
  const en = enumerateClientCalls(root, 'src/entry.jsx');
  const table = [{ method: 'GET', pattern: '/api/players/:playerId/summary' }];
  const { offenders } = compareCoverage(en, table, []);
  assert.deepEqual(offenders, []);
});

// --- The two historical cases (#433 chat endpoints, #435 draft-feed) ---
//
// The guard reads the room's LIVE calls. Today the room calls draft-feed and
// chat/read (so removing those from a copy of the real table makes the real
// guard name them). It no longer calls chat / chat/unread: #435 (ADR 0012)
// replaced those two GETs with the combined draft-feed, so they moved to the
// Dashboard's useLeagueChat, outside this closure. Their #433-era shape is
// proven against a fixture room that still calls them.

test('historical #435 + chat/read: removing them from a copy of the real table names each', () => {
  const trimmed = routeTable.filter(
    (e) => !(e.pattern.includes('draft-feed') || e.pattern.includes('chat/read'))
  );
  const result = runGuard(DEFAULT_ROOT, DEFAULT_ENTRY, trimmed, unstubbed);
  assert.equal(result.ok, false);
  const joined = result.offenders.join('\n');
  assert.match(joined, /GET \/api\/league\/:param\/draft-feed/);
  assert.match(joined, /POST \/api\/league\/:param\/chat\/read/);
});

test('historical #433 chat GETs: a room that still called them, with a table missing them, names each', () => {
  const root = makeTree({
    'entry.jsx': `
      import apiClient from './api/apiClient';
      export default function Room(id, seq) {
        apiClient.get(\`/api/league/\${id}/chat?before=\${seq}\`);
        apiClient.get(\`/api/league/\${id}/chat/unread\`);
        return null;
      }
    `,
  });
  const result = runGuard(root, 'src/entry.jsx', [], []);
  assert.equal(result.ok, false);
  const joined = result.offenders.join('\n');
  assert.match(joined, /GET \/api\/league\/:param\/chat\b/);
  assert.match(joined, /GET \/api\/league\/:param\/chat\/unread/);
});

// --- The real tree, as it stands ---

test('the real Draft room closure is fully covered by the harness table + exemptions', () => {
  const result = runGuard(DEFAULT_ROOT, DEFAULT_ENTRY, routeTable, unstubbed);
  assert.equal(result.ok, true, `unexpected offenders:\n${result.messages.join('\n')}`);
  assert.ok(result.callCount > 0, 'the guard must enumerate a nonzero number of calls');
  assert.ok(result.distinctCount >= 10, `expected many distinct calls, got ${result.distinctCount}`);
});
