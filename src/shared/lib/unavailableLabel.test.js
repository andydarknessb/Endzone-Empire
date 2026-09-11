const fs = require('fs');
const path = require('path');
const { unavailableLabel } = require('./unavailableLabel');

describe('unavailableLabel', () => {
  it('returns the CONTEXT.md Unavailable label for each known reason', () => {
    expect(unavailableLabel('bye')).toBe('on bye');
    expect(unavailableLabel('out')).toBe('out');
    expect(unavailableLabel('ir')).toBe('on IR');
  });

  it('returns null for an unknown or missing reason', () => {
    expect(unavailableLabel('questionable')).toBeNull();
    expect(unavailableLabel('doubtful')).toBeNull();
    expect(unavailableLabel(undefined)).toBeNull();
    expect(unavailableLabel(null)).toBeNull();
    expect(unavailableLabel('')).toBeNull();
  });
});

// The guard (#1208): re-adding a `{ bye: 'on bye', ... }` map anywhere under
// src/ other than this helper is the regression the ticket names. It binds
// the MAP, not the phrase - "on bye" also appears in the Quick actions and
// Draft Sim template-literal sentences (useQuickActions.js, analysis.js) and
// in test-asserted copy, none of which this guard may touch.
describe('the bye -> "on bye" map lives in one file', () => {
  const HELPER_PATH = path.join(__dirname, 'unavailableLabel.js');
  const SRC_ROOT = path.join(__dirname, '..', '..');
  // \bbye\s*:\s*['"`]on bye['"`] - an object-literal entry mapping the key
  // `bye` to the string 'on bye', in single, double or backtick quotes.
  const MAP_ENTRY = /\bbye\s*:\s*['"`]on bye['"`]/;

  function sourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
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

  it('is green at head and red with one map restored (self-check)', () => {
    const restored = "const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };";
    expect(MAP_ENTRY.test(restored)).toBe(true);
    expect(MAP_ENTRY.test('byes + " starters on bye"')).toBe(false);
    expect(MAP_ENTRY.test('the label reads "on bye" in copy')).toBe(false);
  });
});
