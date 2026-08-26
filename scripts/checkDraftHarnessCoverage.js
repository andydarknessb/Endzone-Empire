// Static coverage guard for the Draft E2E harness (issue #474, ADR 0014).
//
// The defect this catches: the Draft room calls an /api/ endpoint the Draft
// E2E harness does not answer, so every test that renders the room drowns in
// bare "Failed to load resource: 500" console errors with the path lost. It
// has bitten twice (#433, #435), the second time after a written warning, and
// the Draft E2E suites are not CI gates (#478), so nothing fails before a
// reviewer runs them locally.
//
// The faithful source of what the Draft room calls is the Draft room, not the
// server's routers (ADR 0014): this guard walks the transitive relative-import
// closure of the Draft route's entry component, collects every /api/ path
// literal passed to the axios api-client, and checks each against the harness's
// own route table (tests/e2e/fixtures/draftRouteTable.js) or a declared
// exemption beside it. It is honest only while it enumerates a nonzero number
// of calls and every api-client call in the closure is a string literal; it
// fails on either condition rather than passing vacuously.
//
// The functions below take a root directory and a table/exemptions, so the
// node --test file can point them at a fixture tree, and a second harness could
// be registered later without a rewrite.

const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;
const {
  routeTable,
  unstubbed,
  canonicalPattern,
} = require('../tests/e2e/fixtures/draftRouteTable');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const RESOLVE_SUFFIXES = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENTRY = 'src/components/DraftBoard/DraftBoard.jsx';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isTestFile(absPath) {
  return /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(absPath);
}

function parseFile(absPath) {
  const code = fs.readFileSync(absPath, 'utf8');
  try {
    return parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
    });
  } catch (err) {
    throw new Error(`failed to parse ${absPath}: ${err.message}`);
  }
}

/**
 * Resolves a relative import source (`./x`, `../y/z`) from `fromAbs` to a real
 * source file, trying the usual extension and index suffixes. Returns the
 * absolute path, or null when it resolves to something that is not a JS/JSX/TS
 * source file (a CSS/asset import, or a missing path).
 */
function resolveRelativeImport(fromAbs, source) {
  const base = path.resolve(path.dirname(fromAbs), source);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      if (SOURCE_EXTENSIONS.includes(path.extname(candidate))) return candidate;
    }
  }
  return null;
}

/** Every `import ... from '<rel>'` / `export ... from '<rel>'` relative source in a file's AST. */
function relativeImportSources(ast) {
  const sources = [];
  for (const node of ast.program.body) {
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration') &&
      node.source &&
      typeof node.source.value === 'string' &&
      node.source.value.startsWith('.')
    ) {
      sources.push(node.source.value);
    }
  }
  return sources;
}

/**
 * The set of source files reachable from `entryRelPath` by following relative
 * imports transitively. Test/spec files and non-source (asset) imports are not
 * followed. Returns absolute paths.
 */
function walkClosure(rootDir, entryRelPath) {
  const entryAbs = path.resolve(rootDir, entryRelPath);
  const seen = new Set();
  const queue = [entryAbs];
  while (queue.length) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    if (isTestFile(abs)) continue;
    seen.add(abs);
    const ast = parseFile(abs);
    for (const source of relativeImportSources(ast)) {
      const resolved = resolveRelativeImport(abs, source);
      if (resolved && !seen.has(resolved) && !isTestFile(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

/** The local identifier a file binds the api-client default export to, or null. */
function apiClientLocalName(ast, fileAbs, apiClientAbs) {
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (typeof node.source.value !== 'string' || !node.source.value.startsWith('.')) continue;
    const resolved = resolveRelativeImport(fileAbs, node.source.value);
    if (resolved !== apiClientAbs) continue;
    const def = node.specifiers.find((s) => s.type === 'ImportDefaultSpecifier');
    if (def) return def.local.name;
  }
  return null;
}

/**
 * Reconstructs a template literal's cooked text with every `${...}`
 * interpolation replaced by the literal `:param`.
 */
function templateToPattern(node) {
  let out = '';
  node.quasis.forEach((q, i) => {
    out += q.value.cooked != null ? q.value.cooked : q.value.raw;
    if (i < node.expressions.length) out += ':param';
  });
  return out;
}

/** Drops a query string, if any. */
function dropQuery(urlPattern) {
  return urlPattern.split('?')[0];
}

/**
 * Walks one file's AST for calls on the api-client identifier, classifying
 * each `apiClient.<method>(firstArg, ...)`:
 *   - first arg a string/template literal beginning with /api/  -> a `call`
 *   - first arg anything else (identifier, member, concat, call) -> `nonLiteral`
 * A literal that does not begin with /api/ is ignored (not an api route).
 */
function collectCallsInFile(ast, apiClientLocal, fileRel, calls, nonLiteral) {
  traverse(ast, {
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.object.type !== 'Identifier' ||
        callee.object.name !== apiClientLocal ||
        callee.property.type !== 'Identifier' ||
        !HTTP_METHODS.has(callee.property.name)
      ) {
        return;
      }
      const method = callee.property.name.toUpperCase();
      const line = nodePath.node.loc ? nodePath.node.loc.start.line : 0;
      const firstArg = nodePath.node.arguments[0];

      if (firstArg && firstArg.type === 'StringLiteral') {
        if (!firstArg.value.startsWith('/api/')) return;
        calls.push({ method, pattern: dropQuery(firstArg.value), rawUrl: firstArg.value, file: fileRel, line });
        return;
      }
      if (firstArg && firstArg.type === 'TemplateLiteral') {
        const built = templateToPattern(firstArg);
        if (!built.startsWith('/api/')) return;
        calls.push({ method, pattern: dropQuery(built), rawUrl: built, file: fileRel, line });
        return;
      }
      nonLiteral.push({ file: fileRel, line, method });
    },
  });
}

/**
 * Enumerates every api-client call in the Draft room's import closure.
 * Returns `{ calls, nonLiteral, files }`. `calls[].file` and `nonLiteral[].file`
 * are paths relative to `<rootDir>/src`, matching the exemption `file` fields.
 */
function enumerateClientCalls(rootDir, entryRelPath) {
  const srcDir = path.resolve(rootDir, 'src');
  const apiClientAbs = path.resolve(rootDir, 'src/api/apiClient.js');
  const closure = walkClosure(rootDir, entryRelPath);
  const calls = [];
  const nonLiteral = [];
  for (const fileAbs of closure) {
    const ast = parseFile(fileAbs);
    const local = apiClientLocalName(ast, fileAbs, apiClientAbs);
    if (!local) continue;
    const fileRel = toPosix(path.relative(srcDir, fileAbs));
    collectCallsInFile(ast, local, fileRel, calls, nonLiteral);
  }
  return { calls, nonLiteral, files: closure.map((f) => toPosix(path.relative(srcDir, f))) };
}

function methodPatternKey(method, pattern) {
  return `${method} ${canonicalPattern(pattern)}`;
}

/**
 * Compares an enumeration against a route table and its exemptions. Returns
 * `{ offenders, callCount, nonLiteralCount }`. An offender is a human-readable
 * line naming the method, path, and source file. The comparison is canonical:
 * a table pattern `/api/league/:id` and an enumerated `/api/league/:param`
 * match.
 */
function compareCoverage(enumeration, table, exemptions) {
  const offenders = [];

  const tableKeys = new Set(table.map((e) => methodPatternKey(e.method, e.pattern)));

  const exemptByFile = new Map();
  for (const group of exemptions) {
    exemptByFile.set(group.file, {
      reason: group.reason,
      keys: new Set((group.paths || []).map((p) => methodPatternKey(p.method, p.pattern))),
    });
  }

  for (const call of enumeration.calls) {
    const key = methodPatternKey(call.method, call.pattern);
    const exempt = exemptByFile.get(call.file);
    if (exempt) {
      if (!exempt.keys.has(key)) {
        offenders.push(
          `${call.method} ${call.pattern}  (from ${call.file}) is not in that file's exemption list`
        );
      }
      continue;
    }
    if (!tableKeys.has(key)) {
      offenders.push(`${call.method} ${call.pattern}  (from ${call.file})`);
    }
  }

  for (const nl of enumeration.nonLiteral) {
    if (exemptByFile.has(nl.file)) continue;
    offenders.push(
      `non-literal ${nl.method} api-client call  (from ${nl.file}:${nl.line}) - the guard cannot see this endpoint, so it must be a literal or the file exempted`
    );
  }

  // A path called from several sites (draft-feed is fetched three ways) yields
  // one offender line, not three: dedupe while preserving first-seen order.
  const dedupedOffenders = [...new Set(offenders)];

  return {
    offenders: dedupedOffenders,
    callCount: enumeration.calls.length,
    nonLiteralCount: enumeration.nonLiteral.length,
  };
}

/**
 * Runs the whole guard against a tree. Returns `{ ok, callCount, offenders,
 * messages }`. A zero call count is itself a failure (the guard would pass
 * vacuously otherwise, ADR 0014).
 */
function runGuard(rootDir, entryRelPath, table, exemptions) {
  const enumeration = enumerateClientCalls(rootDir, entryRelPath);
  const { offenders, callCount, nonLiteralCount } = compareCoverage(enumeration, table, exemptions);
  const messages = [...offenders];
  if (callCount === 0) {
    messages.push(
      'enumerated ZERO api-client calls in the Draft room closure - the guard would pass vacuously; check the entry point and closure walk'
    );
  }
  return {
    ok: messages.length === 0,
    callCount,
    nonLiteralCount,
    distinctCount: new Set(enumeration.calls.map((c) => methodPatternKey(c.method, c.pattern))).size,
    offenders,
    messages,
    enumeration,
  };
}

function main() {
  const result = runGuard(DEFAULT_ROOT, DEFAULT_ENTRY, routeTable, unstubbed);
  console.log(
    `[draft-harness-coverage] enumerated ${result.callCount} api-client call(s) ` +
      `(${result.distinctCount} distinct method+path) from the Draft room closure at ${DEFAULT_ENTRY}`
  );
  if (result.ok) {
    console.log('[draft-harness-coverage] OK: every Draft room call is answered by the harness or declared as a gap.');
    return 0;
  }
  console.error('[draft-harness-coverage] FAIL: the Draft room calls endpoints the harness does not cover:');
  for (const line of result.messages) console.error(`  - ${line}`);
  console.error(
    '\nFix: add a route-table entry in tests/e2e/fixtures/draftRouteTable.js (with a driven ' +
      'fixture in a Draft E2E spec), or declare the call as a deliberate gap in `unstubbed`.'
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  walkClosure,
  enumerateClientCalls,
  compareCoverage,
  runGuard,
  resolveRelativeImport,
  templateToPattern,
  DEFAULT_ROOT,
  DEFAULT_ENTRY,
};
