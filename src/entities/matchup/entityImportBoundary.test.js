const fs = require('fs');
const path = require('path');

/**
 * ADR 0029: an entity depends on nothing above it in the island and never
 * imports another entity. #1207 opened one release's exception -
 * `matchupModel.js` re-exported `entities/roster`'s `pairStartersBySlot` -
 * and #1210 closes it (the pairing moved up to
 * `pages/matchup/model/useMatchupPage.js`, a page importing an entity
 * directly, which ADR 0029 permits).
 *
 * No import-boundary test existed to catch a stray entity-to-entity import
 * before this file (#1210's held-ticket finding: the ticket's own red-tell
 * had to be written new, since nothing here checked the rule the re-export
 * violated). This one scans every source file under this entity for an
 * import that resolves into another entity's directory under
 * `src/entities/`, so a re-introduced `entities/roster` import (or any other
 * sibling entity) turns this red immediately rather than waiting for the
 * next architecture review to notice.
 *
 * Red against #1210's starting point: `matchupModel.js:2` imported
 * `pairStartersBySlot` from `'../../roster'`, which resolves to
 * `src/entities/roster` - a violation this test would have caught before
 * #1207's one-release exception ever needed authorizing.
 */

const ENTITY_ROOT = __dirname;
const ENTITIES_DIR = path.resolve(ENTITY_ROOT, '..');
const THIS_ENTITY = path.basename(ENTITY_ROOT); // 'matchup'

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdir dirent names cannot contain path separators
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && full !== __filename) {
      out.push(full);
    }
  }
  return out;
}

// Matches the module specifier of both `import ... from '...'` and
// `export ... from '...'` statements (the shape of the re-export #1210 deletes).
const FROM_IMPORT = /\b(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g;

function importSpecifiers(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const specifiers = [];
  let match;
  while ((match = FROM_IMPORT.exec(source))) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

// Resolves a relative specifier from its importing file to the entity slice
// (the directory directly under src/entities/) it lands in, or null when the
// import never reaches src/entities/ (shared/lib, the legacy tree below the
// island, or a package specifier).
function entitySliceOf(specifier, fromFile) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- test-time scan of checked-in source; the specifier is only resolved to classify its entity slice, never read or written
  const relative = path.relative(ENTITIES_DIR, resolved);
  if (relative.startsWith('..')) return null;
  return relative.split(path.sep)[0];
}

test('no file under entities/matchup imports from another entity slice', () => {
  const files = collectSourceFiles(ENTITY_ROOT);
  expect(files.length).toBeGreaterThan(0);

  const violations = [];
  for (const file of files) {
    for (const specifier of importSpecifiers(file)) {
      const slice = entitySliceOf(specifier, file);
      if (slice && slice !== THIS_ENTITY) {
        violations.push(`${path.relative(ENTITIES_DIR, file)} imports '${specifier}' (entities/${slice})`);
      }
    }
  }

  expect(violations).toEqual([]);
});
