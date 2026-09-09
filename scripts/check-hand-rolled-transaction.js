#!/usr/bin/env node
/**
 * Guard against a new hand-rolled pooled transaction landing silently.
 *
 * #1061 routed roughly eighty pooled transactions through one wrapper,
 * `server/modules/withTransaction.js`. After that migration every pooled
 * transaction under `server/` either closes through the wrapper or is one of a
 * small, ruled set of sites that keep their own close on purpose. Nothing read
 * that convention, so a fresh copy of the close rule - or a new bare ROLLBACK -
 * would land with no one noticing, which is exactly the failure ADR 0010
 * describes: a convention with no consumer is unaudited. This is the consumer,
 * and per ADR 0010 it ships with the last conversion (#1068), not before it.
 *
 * THE RULE it holds every site against is stated once, in the #1060 ADR
 * (`docs/adr/0033-a-pooled-transaction-closes-through-withtransaction.md`),
 * quoted here so the explanation lives in one place:
 *
 *   "A pooled transaction closes through one wrapper,
 *   withTransaction(pool, work, { label }) in server/modules/, and the close
 *   rule is written in code exactly once, there, for every pooled transaction
 *   that closes by throw."
 *
 * The danger the rule avoids is the close, not the work: a ROLLBACK that itself
 * rejects leaves the transaction and its transaction-scoped lock open on the
 * socket, and a bare release then hands the next borrower an open transaction
 * with a lock stranded behind the transaction pooler (#839). The wrapper writes
 * the destroy-on-failed-close step once; a hand-rolled copy is four steps and
 * four chances to get one wrong (#1048, #1053, #1055).
 *
 * WHAT IS SCANNED, under server/services, server/routes and server/modules:
 *
 *   - `client.query('BEGIN' | 'COMMIT' | 'ROLLBACK')` - the transaction control
 *     statements, as a string or template literal, any quote style, whitespace
 *     tolerant. A control statement built from a non-literal (a variable or a
 *     helper's return) is out of scope: this guard reads the source, not the
 *     runtime, and a literal is what a copy-pasted hand-rolled site actually
 *     writes.
 *   - `<x>.release(` - returning a pooled client to the pool. The wrapper's
 *     whole point is that this call, and whether it destroys, is decided in one
 *     place. `.release(` cannot be proven to be a pg client statically, so it is
 *     scanned broadly and the escape hatch is the allowlist: a `.release(` that
 *     is not a pooled client (a semaphore, a lock handle) is a documented
 *     decision with its rule written down, never a silent pass.
 *
 * WHERE A HIT IS ALLOWED, and nowhere else:
 *
 *   - The wrapper itself, `server/modules/withTransaction.js`: it IS the close
 *     rule, written once.
 *   - `server/modules/advisoryLock.js` and `server/modules/liveGameEngine.js`:
 *     ADR 0033 Ruling 2 keeps these two out of the wrapper. Each wraps a lock
 *     transaction that never writes and closes by a flag rather than by throw,
 *     and absorbing that shape would widen the wrapper's contract for two
 *     callers. They keep their own close; it is the same rule, written inline
 *     for a flag-based close.
 *   - The ALLOWLIST below: sites the #1067 survey ruled keep a hand-rolled
 *     transaction on purpose. Every entry carries `file`, `function`, and a
 *     `rule` sentence naming why; an entry with an empty rule fails the guard,
 *     because an unexplained exception is the thing this guard exists to refuse.
 *
 * WHAT IS OUT OF THE SCAN, and why:
 *
 *   - Migrations under `server/db/` and one-off scripts under `server/scripts/`
 *     are not in the scanned roots. They are not the request-path transactional
 *     code the wrapper serves: a migration runs once against a DBA's connection,
 *     a maintenance script is a human-invoked one-off, and neither borrows from
 *     the request pool whose stranded-lock failure mode (#839) is the reason the
 *     wrapper exists. Scanning them would bury the application-code sites the
 *     guard is for under transaction plumbing that has a different owner.
 *   - `src/` - the client has no pool and no transactions (out of scope, #1068).
 *   - Test files (`*.test.js`, `*.test.jsx`): a test that exercises a bare
 *     ROLLBACK is the point, not a violation.
 *
 * LABEL UNIQUENESS (from #1081, absorbed into #1068). `withTransaction`'s
 * `label` exists to name WHICH transaction failed to close on the #839 path
 * (ADR 0033). A shared label defeats that, so the scan also collects the
 * `label` of every `withTransaction(` call site under the three roots and fails
 * when any label string appears at more than one site, naming both. There is no
 * allowlist for this: a duplicate is always a bug. A call site with no `label`
 * option resolves to the wrapper's default label and counts as one shared label
 * with every other unlabelled site, so two unlabelled sites collide too.
 *
 * A NOTE ON COUNTING (ADR 0010's file-content collision): this script names the
 * strings it forbids - `query('ROLLBACK')` and friends - in the comments above.
 * The scan is an AST pass over the three source roots, and this file lives under
 * `scripts/`, so it never scans itself and the examples above are never counted.
 * An auditor grepping the tree for `query('ROLLBACK')` WILL find those examples
 * here; exclude this file from any such count, and say that you did.
 *
 * Run standalone: `npm run check:hand-rolled-transaction`, which runs this
 * script's own `node --test` file first, the way `check:envelope-conformance`
 * does, then the scan over the real tree.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const REPO = path.join(__dirname, '..');
const EXTENSIONS = new Set(['.js', '.jsx']);

// The transactional application code the wrapper serves. Deliberately NOT
// server/db (migrations) or server/scripts (one-off maintenance) - see the
// docblock.
const SCAN_ROOTS = Object.freeze(['server/services', 'server/routes', 'server/modules']);
const ROOT_DIRECTORIES = Object.freeze({
  'server/services': path.join(REPO, 'server', 'services'),
  'server/routes': path.join(REPO, 'server', 'routes'),
  'server/modules': path.join(REPO, 'server', 'modules'),
});

// Whole-file exemptions. The wrapper is the close rule; the two lock modules
// are ADR 0033 Ruling 2. Repo-relative posix, matched exactly.
const EXEMPT_FILES = Object.freeze(new Set([
  'server/modules/withTransaction.js',
  'server/modules/advisoryLock.js',
  'server/modules/liveGameEngine.js',
]));

/**
 * Every hand-rolled transaction site the codebase keeps on purpose, and the
 * rule that sanctions it. Keyed by `file` (repo-relative posix) and `function`
 * (the enclosing named function, or a route as `METHOD path`), NOT by line:
 * line numbers churn on every unrelated edit and an allowlist that needs
 * re-deriving after each one is one people stop reading.
 *
 * The contents are exactly what #1067 (the misfit child of spec #1061) ruled
 * `allowlist`, and nothing else. Its rulings comment is the source of record;
 * all twelve other functions it surveyed were reshaped onto `withTransaction`
 * by #1070/#1071/#1072/#1073 and carry no hand-rolled transaction any more.
 *
 * `rule` is the whole point of the entry: an empty rule fails the guard.
 */
const ALLOWLIST = [
  {
    file: 'server/services/leagueSettings.service.js',
    function: 'updateLeagueSettings',
    rule:
      'The transaction is optional by patch shape - opened only when a row-locked '
      + 'setting is in the patch - and rejectUpdate owns its ROLLBACK, so the function '
      + 'is its own transaction wrapper over an injected `db`; the #68 guarded-release '
      + 'contract stands. Module closed 2026-08-20 (#1067 ruling 1).',
  },
  {
    file: 'server/routes/league.router.js',
    function: 'GET /:id/matchups/:matchupId',
    rule:
      'The live path needs a transaction around materializeLineup\'s copy-forward loop '
      + 'and the settled path buys none (#978), so BEGIN and COMMIT are conditional '
      + '(`if (!asPlayed)`) inside one read handler; extracting the live half is a #978 '
      + 're-ruling, refused here (#1067 ruling 2).',
  },
];

// The HTTP verbs a route handler registers under, so a `router.get('/x', fn)`
// handler is named `GET /x` rather than reported as an anonymous arrow.
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (rel) => rel.split(path.sep).join('/');
const isTestFile = (rel) => /\.test\.(js|jsx)$/.test(rel);

function parse(source, file) {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      plugins: /\.jsx$/.test(file) ? ['jsx'] : [],
      errorRecovery: false,
    });
  } catch (err) {
    // A parse failure must be loud: a guard that silently skips a file it cannot
    // read is a guard that certifies nothing about that file.
    throw new Error(`check-hand-rolled-transaction: failed to parse ${file}: ${err.message}`);
  }
}

/**
 * Visit every node with the stack of function nodes enclosing it (each frame is
 * `{ node, parent }` so a route handler can be named from the `router.get(...)`
 * call it is an argument to). A pure recursion over the AST; no @babel/traverse
 * so the only parser dependency is @babel/parser, which is a declared dep.
 */
function eachNode(root, visit) {
  const recurse = (node, parent, funcStack) => {
    if (!node || typeof node.type !== 'string') return;
    const stack = FUNCTION_TYPES.has(node.type)
      ? funcStack.concat([{ node, parent }])
      : funcStack;
    visit(node, parent, stack);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end'
        || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments'
        || key === 'comments' || key === 'extra' || key === 'tokens') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) recurse(child, node, stack);
      } else if (value && typeof value.type === 'string') {
        recurse(value, node, stack);
      }
    }
  };
  recurse(root, null, []);
}

/** The literal string a node evaluates to, or null if it is not a plain literal. */
function literalString(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

/** True for `<x>.query(...)` (member call to a `query` method). */
function isMemberCall(node, methodName) {
  return (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.property.type === 'Identifier'
    && node.callee.property.name === methodName
  );
}

const TXN_STATEMENT = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i;

/**
 * Name the unit a hit lives in: the OUTERMOST enclosing function that has a
 * derivable identity - the module-level function, or the route handler that a
 * `router.<method>('/path', ...)` call registers. Outermost, not innermost,
 * because that is the granularity the allowlist is written at: #1067 ruled
 * `updateLeagueSettings` a sanctioned hand-rolled transaction even though a
 * nested `rejectUpdate` closure owns one of its ROLLBACKs, and both belong to
 * the one function the ruling names. A nested named helper's hit is therefore
 * attributed to the public function that contains it, and an anonymous
 * `.catch(() => ...)` callback is transparent the same way. Returns null only
 * for a hit at module top level, which no allowlist entry can name and which is
 * therefore a finding.
 */
function unitOf(funcStack) {
  for (let i = 0; i < funcStack.length; i += 1) {
    const { node, parent } = funcStack[i];

    // A route handler: fn is an argument to `router.<method>('/path', ...)`.
    if (
      parent
      && parent.type === 'CallExpression'
      && parent.callee.type === 'MemberExpression'
      && !parent.callee.computed
      && parent.callee.property.type === 'Identifier'
      && HTTP_METHODS.has(parent.callee.property.name)
      && parent.arguments.includes(node)
      && parent.arguments[0]
      && literalString(parent.arguments[0]) !== null
    ) {
      return `${parent.callee.property.name.toUpperCase()} ${literalString(parent.arguments[0])}`;
    }

    if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
    if ((node.type === 'ObjectMethod' || node.type === 'ClassMethod') && node.key) {
      if (node.key.type === 'Identifier') return node.key.name;
      if (node.key.type === 'StringLiteral') return node.key.value;
    }
    if (parent) {
      if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
        return parent.id.name;
      }
      if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
        return parent.left.name;
      }
      if (
        (parent.type === 'ObjectProperty' || parent.type === 'ClassProperty')
        && !parent.computed && parent.value === node
      ) {
        if (parent.key.type === 'Identifier') return parent.key.name;
        if (parent.key.type === 'StringLiteral') return parent.key.value;
      }
    }
    // Anonymous: keep climbing to the named function that owns this callback.
  }
  return null;
}

/**
 * Every hand-rolled transaction hit in one file's source, as
 * `{ kind, code, line, unit }`. `kind` is 'BEGIN' | 'COMMIT' | 'ROLLBACK' |
 * 'release'; `unit` is the enclosing function identity (see unitOf).
 */
function findHits(source, file = 'source.js') {
  const ast = parse(source, file);
  const hits = [];
  eachNode(ast, (node, parent, funcStack) => {
    if (isMemberCall(node, 'query')) {
      const arg = literalString(node.arguments[0]);
      if (arg !== null && TXN_STATEMENT.test(arg)) {
        hits.push({
          kind: arg.trim().toUpperCase().split(/\s+/)[0],
          code: `${calleeText(node.callee)}('${arg.trim()}')`,
          line: node.loc ? node.loc.start.line : 0,
          unit: unitOf(funcStack),
        });
      }
    } else if (
      node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && !node.callee.computed
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === 'release'
    ) {
      hits.push({
        kind: 'release',
        code: `${calleeText(node.callee)}(...)`,
        line: node.loc ? node.loc.start.line : 0,
        unit: unitOf(funcStack),
      });
    }
  });
  return hits;
}

/** A short, human-readable rendering of `<receiver>.<method>` for a message. */
function calleeText(callee) {
  const object = callee.object;
  const receiver = object && object.type === 'Identifier' ? object.name : 'client';
  return `${receiver}.${callee.property.name}`;
}

/**
 * Every `withTransaction(` call site's label in one file, as `{ label, line }`.
 * A site with no `label` option is reported with `label === null` and treated
 * downstream as the shared default.
 */
function findLabels(source, file = 'source.js') {
  const ast = parse(source, file);
  const labels = [];
  eachNode(ast, (node) => {
    if (
      node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'withTransaction'
    ) {
      let label = null;
      for (const arg of node.arguments) {
        if (arg.type !== 'ObjectExpression') continue;
        const prop = arg.properties.find(
          (p) => (p.type === 'ObjectProperty' && !p.computed
            && ((p.key.type === 'Identifier' && p.key.name === 'label')
              || (p.key.type === 'StringLiteral' && p.key.value === 'label')))
        );
        if (prop) {
          const value = literalString(prop.value);
          // A non-literal label cannot collide statically; give it a
          // site-unique marker so it never falsely reports a duplicate.
          label = value !== null ? value : ` dynamic@${node.loc ? node.loc.start.line : 0}`;
          break;
        }
      }
      labels.push({ label, line: node.loc ? node.loc.start.line : 0 });
    }
  });
  return labels;
}

/**
 * Analyse a set of `{ file, source }` records against an allowlist. Pure, so a
 * test can hand it fixture sources with no disk. Returns four finding lists:
 *   - unlisted: a scanned hit whose (file, unit) is not exempt and not allowed
 *   - stale: an allowlist entry that matches no hit (the list outliving its code)
 *   - ruleless: an allowlist entry with an empty rule
 *   - duplicateLabels: a label shared by two or more withTransaction sites
 */
function analyze(files, { allowlist = ALLOWLIST } = {}) {
  const ruleless = [];
  for (const entry of allowlist) {
    if (typeof entry.rule !== 'string' || entry.rule.trim().length === 0) {
      ruleless.push(`${entry.file} :: ${entry.function}: allowlist entry has no rule`);
    }
  }

  // (file, function) -> allowlist entry, for O(1) matching and stale tracking.
  const allowKey = (file, fn) => JSON.stringify([file, fn]);
  const allowed = new Map();
  for (const entry of allowlist) allowed.set(allowKey(entry.file, entry.function), { entry, matched: false });

  const unlisted = [];
  const labelSites = new Map(); // label -> [ `file:line` ... ]

  for (const { file, source } of files) {
    if (isTestFile(file)) continue;
    if (!EXEMPT_FILES.has(file)) {
      for (const hit of findHits(source, file)) {
        const key = allowKey(file, hit.unit);
        const record = allowed.get(key);
        if (record) {
          record.matched = true;
        } else {
          const where = hit.unit ? `${hit.unit}` : '<module top level>';
          unlisted.push(`${file}:${hit.line}: ${hit.kind} in ${where} (${hit.code})`);
        }
      }
    }
    for (const { label, line } of findLabels(source, file)) {
      const bucket = label === null ? ' default' : label;
      if (!labelSites.has(bucket)) labelSites.set(bucket, []);
      labelSites.get(bucket).push({ where: `${file}:${line}`, label });
    }
  }

  const stale = [];
  for (const { entry, matched } of allowed.values()) {
    if (!matched) {
      stale.push(`${entry.file} :: ${entry.function}: allowlisted but no hand-rolled transaction found here`);
    }
  }

  const duplicateLabels = [];
  for (const [bucket, sites] of labelSites) {
    if (sites.length < 2) continue;
    const shown = bucket === ' default'
      ? 'the default label (no `label` option)'
      : `label '${bucket}'`;
    duplicateLabels.push(`${shown} is used by ${sites.length} withTransaction sites: ${sites.map((s) => s.where).join(', ')}`);
  }

  return { unlisted, stale, ruleless, duplicateLabels };
}

/** Read every scannable file under `roots` as `{ file, source }`. */
function readFiles(roots) {
  const files = [];
  for (const root of roots) {
    const directory = ROOT_DIRECTORIES[root];
    if (!directory) throw new Error(`hand-rolled-transaction scan root is not allowed: ${root}`);
    for (const abs of walk(directory)) {
      const rel = toPosix(path.relative(REPO, abs));
      files.push({ file: rel, source: fs.readFileSync(abs, 'utf8') });
    }
  }
  return files;
}

/** Analyse the real tree under SCAN_ROOTS. */
function check(roots = SCAN_ROOTS, options = {}) {
  return analyze(readFiles(roots), options);
}

function main() {
  const { unlisted, stale, ruleless, duplicateLabels } = check();
  const clean = !unlisted.length && !stale.length && !ruleless.length && !duplicateLabels.length;
  if (clean) {
    console.log('✅ Every pooled transaction closes through withTransaction, or is a ruled exception with its rule recorded; every withTransaction label is unique.');
    return;
  }
  if (unlisted.length) {
    console.error(
      `\n❌ ${unlisted.length} hand-rolled transaction site(s) outside withTransaction and the allowlist.\n`
      + 'Route the transaction through withTransaction(pool, work, { label }) (ADR 0033),\n'
      + 'or - if it genuinely keeps its own close - add it to ALLOWLIST in\n'
      + 'scripts/check-hand-rolled-transaction.js with the rule it implements.\n'
      + 'If you cannot name the rule, that is the finding (ADR 0010).\n'
    );
    unlisted.forEach((v) => console.error(`  ${v}`));
  }
  if (duplicateLabels.length) {
    console.error(
      `\n❌ ${duplicateLabels.length} withTransaction label(s) shared across call sites.\n`
      + 'A label names WHICH transaction failed to close (ADR 0033); it must be unique\n'
      + 'to its call site. Rename one so both are distinct.\n'
    );
    duplicateLabels.forEach((v) => console.error(`  ${v}`));
  }
  if (ruleless.length) {
    console.error(`\n❌ ${ruleless.length} allowlist entr(ies) with no rule. The rule is the entry's whole purpose.\n`);
    ruleless.forEach((v) => console.error(`  ${v}`));
  }
  if (stale.length) {
    console.error(`\n❌ ${stale.length} allowlist entr(ies) no longer describe the code:\n`);
    stale.forEach((v) => console.error(`  ${v}`));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST,
  SCAN_ROOTS,
  EXEMPT_FILES,
  findHits,
  findLabels,
  analyze,
  check,
};
