// Shrink-only conformance guard for the server's failure envelope (#973,
// parent spec #942, ADR 0032).
//
// The convergence this guards: a refusal carries its machine code in a `code`
// field of its own and the sentence a manager reads in `message`. The reader
// `src/lib/httpFailure.js` currently TOLERATES four envelopes because the
// server emits four; that tolerance exists to be removed, and a tolerance with
// nothing counting its remaining users becomes permanent by default. This
// script counts them.
//
// It is a guard over the emitters, not over the reader: it parses every
// `res.json(...)` / `res.status(...).json(...)` object literal under server/
// and classifies the ones that carry a code somewhere other than the target
// shape. Three classes are non-conforming, all decidable from the object
// literal alone (no string-shape guessing, matching the reader's rule 1 that
// key presence, never text, discriminates a code from a sentence):
//
//   code-in-error-with-message   { error: <code>, message: <sentence> }
//       The `error` key holds the code and the sentence sits in `message`.
//       Recognised by the two keys appearing together: a codeless refusal
//       never emits both.
//   code-in-error                { error: <expr>.code } or { error: 'SCREAMING_CASE' }
//       The `error` key demonstrably holds a code even with no `message`
//       sibling. `.code` is read off the property being emitted and the
//       literal form off the literal itself, so neither is a guess about the
//       text of an arbitrary sentence.
//   code-beside-error            { code: <code>, error: <sentence> }  (no `message`)
//       The code has its own key already but the sentence rides in `error`, so
//       the reader still needs its `error`-fallback arm.
//
// Everything else conforms: `{ code, message }` (the target) and the large
// codeless `{ error: <sentence> }` population, which carries no code at all and
// so is not part of this convergence.
//
// The allowlist (ALLOWLIST below) is per FILE and per SHAPE with a COUNT, not
// per line: line numbers churn on every unrelated edit and would make the list
// a merge-conflict generator. The rule is shrink-only in both directions:
//   - more sites in a file than allowed, or a file not listed at all: FAIL,
//     the tolerance grew.
//   - fewer sites than allowed: FAIL, asking for the number to come down. A
//     stale entry would let the tolerance silently regrow to its old size.
// It also fails when it enumerates zero emitters at all, so a broken walk
// cannot pass vacuously (the rule ADR 0014 set for the harness guard).
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');

const traverse = traverseModule.default || traverseModule;

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['server/routes', 'server/modules', 'server/services', 'server/server.js'];
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests']);

const SHAPES = {
  CODE_IN_ERROR_WITH_MESSAGE: 'code-in-error-with-message',
  CODE_IN_ERROR: 'code-in-error',
  CODE_BESIDE_ERROR: 'code-beside-error',
};

// The emitters that still do not carry the code in its own field beside a
// `message` sentence. Shrink these numbers as they migrate; never raise one.
const ALLOWLIST = [
  {
    file: 'server/routes/draft.router.js',
    shape: SHAPES.CODE_BESIDE_ERROR,
    count: 3,
    reason:
      'Two INVALID_REQUEST argument refusals on the pick routes plus the isDraftRefusal branch on pick correction. Out of #973 scope: the Draft room reads these through its own refusal path (#808), and moving the sentence out of `error` there is a Draft-island change, not a commissioner one.',
  },
  {
    file: 'server/routes/league.router.js',
    shape: SHAPES.CODE_BESIDE_ERROR,
    count: 2,
    reason:
      'LeagueSettingsError and the start-draft refusal, both `{ error: <sentence>, ...(error.code ? { code } : {}) }`. The conditional spread means the same route emits with and without a code, so converging it is a copy change across the league routes that #973 deliberately left alone.',
  },
  {
    file: 'server/routes/pickem.router.js',
    shape: SHAPES.CODE_BESIDE_ERROR,
    count: 2,
    reason:
      "The pick'em fail() helper and the PICKEM_DISABLED refusal. fail() also spreads `error.details` into the same envelope, so converging it needs the details contract pinned first.",
  },
  {
    file: 'server/services/leagueType.js',
    shape: SHAPES.CODE_BESIDE_ERROR,
    count: 1,
    reason:
      'The PickemOnlyLeagueError middleware refusal. It is mounted across several routers, so it converges with them rather than on its own.',
  },
];

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isSourceFile(abs) {
  return abs.endsWith('.js') && !/\.(test|spec)\.js$/.test(abs);
}

/** Every non-test .js file under the scan roots, absolute paths, sorted. */
function collectSourceFiles(rootDir, scanDirs = SCAN_DIRS) {
  const out = [];
  const walk = (abs) => {
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (isSourceFile(abs)) out.push(abs);
      return;
    }
    for (const entry of fs.readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(path.join(abs, entry));
    }
  };
  for (const rel of scanDirs) {
    const abs = path.resolve(rootDir, rel);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out.sort();
}

function parseFile(abs) {
  try {
    return parser.parse(fs.readFileSync(abs, 'utf8'), { sourceType: 'script' });
  } catch (err) {
    throw new Error(`failed to parse ${abs}: ${err.message}`);
  }
}

/** True for `<x>.json(...)` and `<x>.status(...).json(...)`. */
function isJsonSend(node) {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'json') return false;
  const target = callee.object;
  if (target.type === 'Identifier') return true;
  return (
    target.type === 'CallExpression' &&
    target.callee.type === 'MemberExpression' &&
    !target.callee.computed &&
    target.callee.property.type === 'Identifier' &&
    target.callee.property.name === 'status'
  );
}

function propertyName(prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

/** The object literals an expression can evaluate to, unwrapping a ternary. */
function objectLiterals(node) {
  if (!node) return [];
  if (node.type === 'ObjectExpression') return [node];
  if (node.type === 'ConditionalExpression') {
    return [...objectLiterals(node.consequent), ...objectLiterals(node.alternate)];
  }
  return [];
}

/** True when the value is demonstrably a machine code rather than a sentence. */
function looksLikeCodeValue(value) {
  if (!value) return false;
  if (
    value.type === 'MemberExpression' &&
    !value.computed &&
    value.property.type === 'Identifier' &&
    value.property.name === 'code'
  ) {
    return true;
  }
  if (value.type === 'StringLiteral') return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value.value);
  return false;
}

/** Every key name an object literal contributes, following conditional spreads. */
function keyNames(objectNode) {
  const names = new Set();
  for (const prop of objectNode.properties) {
    if (prop.type === 'SpreadElement') {
      for (const inner of objectLiterals(prop.argument)) {
        for (const name of keyNames(inner)) names.add(name);
      }
      continue;
    }
    const name = propertyName(prop);
    if (name) names.add(name);
  }
  return names;
}

/**
 * Classifies one emitted object literal, returning a shape name, or null when
 * it conforms (or carries no code at all).
 */
function classifyObject(objectNode) {
  const names = keyNames(objectNode);
  if (!names.has('error')) return null;

  let errorValue;
  for (const prop of objectNode.properties) {
    if (propertyName(prop) === 'error') errorValue = prop.value;
  }

  if (names.has('message')) return SHAPES.CODE_IN_ERROR_WITH_MESSAGE;
  if (looksLikeCodeValue(errorValue)) return SHAPES.CODE_IN_ERROR;
  if (names.has('code')) return SHAPES.CODE_BESIDE_ERROR;
  return null;
}

/**
 * Every non-conforming emitter under `rootDir`, as `{ file, line, shape }`,
 * plus the total number of `.json(...)` emitters seen (the vacuity counter).
 */
function scanOneFile(abs, file) {
  const ast = parseFile(abs);
  const findings = [];
  let sendCount = 0;
  traverse(ast, {
    CallExpression(nodePath) {
      if (!isJsonSend(nodePath.node)) return;
      sendCount += 1;
      for (const obj of objectLiterals(nodePath.node.arguments[0])) {
        const shape = classifyObject(obj);
        if (!shape) continue;
        findings.push({ file, line: obj.loc ? obj.loc.start.line : 0, shape });
      }
    },
  });
  return { findings, sendCount };
}

function enumerateEmitters(rootDir, scanDirs = SCAN_DIRS) {
  const findings = [];
  let sendCount = 0;
  for (const abs of collectSourceFiles(rootDir, scanDirs)) {
    const scanned = scanOneFile(abs, toPosix(path.relative(rootDir, abs)));
    findings.push(...scanned.findings);
    sendCount += scanned.sendCount;
  }
  return { findings, sendCount };
}

function key(file, shape) {
  return `${file}::${shape}`;
}

/** Compares an enumeration against the allowlist. Returns `{ ok, messages }`. */
function compare(enumeration, allowlist) {
  const actual = new Map();
  for (const finding of enumeration.findings) {
    const k = key(finding.file, finding.shape);
    if (!actual.has(k)) actual.set(k, []);
    actual.get(k).push(finding);
  }

  const allowed = new Map(allowlist.map((entry) => [key(entry.file, entry.shape), entry]));
  const messages = [];

  for (const [k, findings] of [...actual.entries()].sort()) {
    const entry = allowed.get(k);
    const { file, shape } = findings[0];
    const lines = findings.map((f) => f.line).join(', ');
    if (!entry) {
      messages.push(
        `NEW non-conforming emitter: ${file} emits ${findings.length} ${shape} envelope(s) (line ${lines}) and is not on the allowlist`
      );
      continue;
    }
    if (findings.length > entry.count) {
      messages.push(
        `GREW: ${file} ${shape} is allowed ${entry.count} but has ${findings.length} (line ${lines})`
      );
    } else if (findings.length < entry.count) {
      messages.push(
        `STALE allowlist entry: ${file} ${shape} is allowed ${entry.count} but only ${findings.length} remain; lower the count in scripts/envelopeConformance.js so the tolerance cannot regrow`
      );
    }
  }

  for (const [k, entry] of [...allowed.entries()].sort()) {
    if (actual.has(k)) continue;
    messages.push(
      `STALE allowlist entry: ${entry.file} ${entry.shape} is allowed ${entry.count} but none remain; delete the entry from scripts/envelopeConformance.js`
    );
  }

  if (enumeration.sendCount === 0) {
    messages.push(
      'enumerated ZERO json emitters under server/: the guard would pass vacuously; check the scan roots'
    );
  }

  return { ok: messages.length === 0, messages };
}

function runGuard(rootDir, allowlist = ALLOWLIST, scanDirs = SCAN_DIRS) {
  const enumeration = enumerateEmitters(rootDir, scanDirs);
  const result = compare(enumeration, allowlist);
  return { ...result, ...enumeration };
}

function main() {
  const result = runGuard(DEFAULT_ROOT);
  console.log(
    `[envelope-conformance] scanned ${result.sendCount} json emitter(s) under server/; ` +
      `${result.findings.length} still carry a code outside the { code, message } envelope`
  );
  if (result.ok) {
    console.log(
      '[envelope-conformance] OK: every remaining non-conforming emitter is on the allowlist at its allowed count.'
    );
    return 0;
  }
  console.error('[envelope-conformance] FAIL:');
  for (const line of result.messages) console.error(`  - ${line}`);
  console.error(
    '\nFix: emit { code, message } (the code in its own field, the sentence in message), ' +
      'or, when an emitter genuinely cannot converge yet, shrink the allowlist rather than grow it.'
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  ALLOWLIST,
  SHAPES,
  SCAN_DIRS,
  DEFAULT_ROOT,
  collectSourceFiles,
  classifyObject,
  keyNames,
  enumerateEmitters,
  compare,
  runGuard,
};
