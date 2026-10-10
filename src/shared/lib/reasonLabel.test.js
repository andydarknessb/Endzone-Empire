const fs = require('fs');
const path = require('path');
const { reasonLabel } = require('./reasonLabel');

describe('reasonLabel', () => {
  it('returns the CONTEXT.md Unavailable label for each known reason', () => {
    expect(reasonLabel('bye')).toBe('on bye');
    expect(reasonLabel('out')).toBe('out');
    expect(reasonLabel('ir')).toBe('on IR');
    expect(reasonLabel('no_team')).toBe('no team');
    expect(reasonLabel('practice_squad')).toBe('practice squad');
    expect(reasonLabel('suspended')).toBe('suspended');
  });

  it('returns null for an unknown or missing reason', () => {
    expect(reasonLabel('questionable')).toBeNull();
    expect(reasonLabel('doubtful')).toBeNull();
    expect(reasonLabel(undefined)).toBeNull();
    expect(reasonLabel(null)).toBeNull();
    expect(reasonLabel('')).toBeNull();
  });

  it('returns null for an inherited Object.prototype member, not the member itself', () => {
    // An own-property-only lookup: {}['constructor'] and {}['toString'] both
    // resolve to real functions through the prototype chain, and a bracket
    // lookup with `|| null` would hand one back as if it were a label.
    expect(reasonLabel('constructor')).toBeNull();
    expect(reasonLabel('toString')).toBeNull();
    expect(reasonLabel('__proto__')).toBeNull();
    expect(reasonLabel('hasOwnProperty')).toBeNull();
  });
});

// The guard (#1208): re-adding a `{ bye: 'on bye', ... }` map anywhere under
// src/ other than this helper is the regression the ticket names. It binds
// the MAP, not the phrase - "on bye" also appears in the Quick actions and
// Draft Sim template-literal sentences (useQuickActions.js, analysis.js) and
// in test-asserted copy, none of which this guard may touch.
describe('the bye -> "on bye" map lives in one file', () => {
  const HELPER_PATH = path.join(__dirname, 'reasonLabel.js');
  const SRC_ROOT = path.join(__dirname, '..', '..');
  // An object-literal entry mapping the key `bye` (quoted or not) to the
  // string 'on bye', in single, double or backtick quotes either side.
  const MAP_ENTRY = /['"]?\bbye['"]?\s*:\s*['"`]on bye['"`]/;

  function sourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdir dirent names cannot contain path separators
      if (entry.isDirectory()) {
        sourceFiles(full, out);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.[jt]sx?$/.test(entry.name)) continue;
      if (full === HELPER_PATH) continue;
      out.push(full);
    }
    return out;
  }

  it('is never re-added to another file under src/', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => MAP_ENTRY.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_ROOT, file).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('the map-entry pattern matches a restored map (quoted or bare key) and not the copy sentences', () => {
    expect(MAP_ENTRY.test("const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };")).toBe(true);
    expect(MAP_ENTRY.test("const UNAVAILABLE_LABELS = { 'bye': 'on bye', out: 'out', ir: 'on IR' };")).toBe(true);
    expect(MAP_ENTRY.test('const UNAVAILABLE_LABELS = { "bye": "on bye", out: "out", ir: "on IR" };')).toBe(true);
    expect(MAP_ENTRY.test('byes + " starters on bye"')).toBe(false);
    expect(MAP_ENTRY.test('the label reads "on bye" in copy')).toBe(false);
  });
});
