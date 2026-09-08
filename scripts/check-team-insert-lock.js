#!/usr/bin/env node
/**
 * Guard: every statement that inserts a Team row runs behind a League-row lock
 * taken in the same function (#1043, follow-up from #938 / #967 / PR #1032).
 *
 * WHY THIS EXISTS. A Draft act (server/services/draftAct.service.js) locks the
 * League row `FOR UPDATE`, then reads the Teams into a snapshot WITHOUT a
 * per-row lock, and act bodies (reset, undo) gate and delete per Team from that
 * snapshot. A Team created between the snapshot read and the wipe would be
 * neither gated nor wiped. Today that cannot happen, but only by an invariant
 * nobody had written down: the one production Team-insert (joinLeague in
 * server/services/leagueMembership.service.js) takes the League row `FOR
 * UPDATE` before its INSERT, so a join serializes behind the act's League lock
 * and the snapshot is complete for the act's whole transaction. #1043 makes
 * that invariant observable, so a future join path, a commissioner "add team"
 * path, or a refactor that demotes the membership lock turns something red
 * instead of silently reopening the gap.
 *
 * WHAT IS ASSERTED, and its operationalization. The domain invariant is "in the
 * same transaction". The static proxy is PURELY LEXICAL and does not reason
 * about runtime: a League lock counts when its SQL appears, textually before the
 * insert, in the insert's enclosing function OR any function lexically enclosing
 * it (its ancestor chain) - either as inline SQL or as a `.query(NAME)` call on
 * a const whose value is the lock. joinLeague is the shape it is built around:
 * its own body takes the lock before its INSERT. An insert nested in a callback,
 * a loop or a for-await inside the locking function is covered, because the lock
 * sits on its ancestor chain. A lock inside a nested function that is NOT an
 * ancestor of the insert (a sibling helper) does NOT count - reported as
 * unlocked, deliberately, as a "make the lock visible" prompt.
 *
 * THE LIMIT OF A LEXICAL RULE, stated because this header is the guard's audit
 * surface. "An ancestor holds the lock" is not the same as "the lock ran, in
 * this transaction, before the insert". Two shapes read GREEN here that a
 * runtime check would not vouch for: an insert inside a closure the locking
 * function RETURNS, and an insert inside a handler the locking function
 * REGISTERS on an event bus (server/modules holds the socket handlers, so this
 * one is real, not hypothetical). Either can execute after the locking
 * function's transaction has ended. This is the accepted cost of taking the
 * scope from the OUTERMOST enclosing function - the same choice that lets the
 * ordinary callback/loop/for-await shapes above be green instead of three false
 * reds. teamInsertLockGuard.test.js pins both deferred shapes as GREEN so the
 * next person changes the trade on purpose rather than by accident. If a future
 * add-team path takes this deferred form, this guard will not catch it.
 *
 * WHY SOURCE-DERIVED, NOT HAND-LISTED. The precedents are the identity-comparison
 * guard (scripts/check-identity-comparisons.js) and the envelope-conformance
 * guard: a guard that discovers its own inputs cannot be quietly bypassed by a
 * new site the author forgot to add to a list. But a source-derived guard fails
 * SILENTLY when its DISCOVERY breaks, not only when its assertion does - and the
 * discovery set here has size ONE, so a matcher a hair too narrow would empty
 * the set and leave the guard green forever while asserting nothing. The
 * red-tell (delete FOR UPDATE) exercises only the assertion; it never touches
 * the scan. So the guard's own tests prove the scan too: a non-emptiness floor,
 * and the known site named by path (server/test/teamInsertLockGuard.test.js).
 *
 * SCOPE. The ONLINE (request-path) directories only: server/routes,
 * server/services and server/modules - the same three SERVER_ROOTS the
 * identity-comparison guard scans. AC1 says "the services directory"; routes is
 * added because the threat model names a commissioner "add team" path and
 * nothing stops it landing in a router, and modules because request-path code
 * lives there too (draftAct.service.js's callers, the socket handlers). That
 * widening past the letter of AC1 is called out in the PR.
 *
 * The OFFLINE trees are deliberately OUT: server/db/migrations, server/db/seeds,
 * server/scripts, server/data, worker.js. The cost of a scan is false POSITIVES,
 * not false negatives, and those trees are where they would come from. A data
 * migration or a backfill script legitimately inserts Team rows and CANNOT take
 * a League row `FOR UPDATE` (a migration runs in its own one-shot transaction,
 * with no concurrent Draft act to serialize against), so scanning them would
 * red an author for omitting a lock that would mean nothing there - and
 * migrations are a Cory-owned carve-out, so that red is one no IC could even
 * fix. The invariant this guard exists for is a RUNTIME one: a join or add-team
 * path racing a Draft act. Only online code can be on either side of that race.
 *
 * BLIND SPOTS, named rather than papered over. The discovery matcher sees only a
 * literal `INSERT INTO "teams"` (quoted or bare) in SQL text. It does NOT see a
 * query builder (`knex('teams').insert(...)`), a schema-qualified name
 * (`INSERT INTO public.teams`), or a `.sql` file (EXTENSIONS is .js/.jsx). None
 * is a live gap today - the server runtime creates Teams only through raw
 * `pool.query` with this exact shape (joinLeague), and knex appears only in
 * migrations and tests - so the non-emptiness floor stays honest. But a FUTURE
 * add-team path written in any of those forms would be invisible, and a guard's
 * blind spots belong in its own header, not in a reader's surprise.
 *
 * Comments are stripped first (check-color-literals.js's own stripper, which
 * keeps string and template-literal bodies verbatim so the SQL inside them is
 * still seen, and preserves line breaks so reported line numbers stay true), so
 * a Team-insert quoted in a comment is not counted, and a `FOR UPDATE` written
 * only in a comment does not satisfy the rule.
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./check-color-literals');

const REPO = path.join(__dirname, '..');
const EXTENSIONS = new Set(['.js', '.jsx']);

// A fixed source-tree allowlist, exactly as the identity-comparison guard does
// it: scan() refuses any other root so a caller cannot silently point it
// somewhere that finds nothing. These are the ONLINE (request-path) directories
// only - see the SCOPE note in the header for why the offline trees are out.
const SERVER_ROOTS = ['server/routes', 'server/services', 'server/modules'];
const ROOT_DIRECTORIES = Object.freeze({
  'server/routes': path.join(REPO, 'server', 'routes'),
  'server/services': path.join(REPO, 'server', 'services'),
  'server/modules': path.join(REPO, 'server', 'modules'),
});

// A statement inserting a Team row. The table name and its opening paren need
// not be on one line, and either may be quoted or bare, so this stays a hair
// wider than the one shape in the tree today: a matcher a hair too narrow would
// empty the discovery set (size one today) and the guard would go vacuously
// green while asserting nothing.
const TEAM_INSERT_SOURCE = 'INSERT\\s+INTO\\s+"?teams"?';
// Global, for matchAll (which copies lastIndex, so it stays reentrant). Never
// call `.test()` on this one - use a fresh non-global regex for that.
const TEAM_INSERT = new RegExp(TEAM_INSERT_SOURCE, 'gi');
const hasTeamInsert = (source) => new RegExp(TEAM_INSERT_SOURCE, 'i').test(source);

// A League-row lock, WITHIN ONE SQL statement: `FROM "leagues" ... FOR UPDATE`.
// It is only ever tested against a single statement (see sqlStatements /
// containsLeagueLock), never against a raw source span - an earlier version
// tested a `[^`]*?` span and could match a `FROM "leagues"` read in one
// statement against a `FOR UPDATE` on another table in a later one whenever no
// backtick sat between them (quoted SQL, or two statements in one template).
// Matches every real variant: the bare `WHERE "id" = $1 FOR UPDATE`, the
// commissionerPredicate form, and the `... AND "draft_status" = 'active' FOR
// UPDATE` reset form, single- or multi-line.
const LEAGUE_LOCK = /FROM\s+"leagues"[\s\S]*?FOR\s+UPDATE/i;

/**
 * A copy of comment-stripped source with the BODY of every string, single- and
 * double-quoted and template, replaced by spaces (delimiters, newlines and
 * length preserved). Braces inside a string or SQL (`'{}'::jsonb`, a message
 * `'done }'`, a template's `${...}` payload) must not count as structural
 * braces, or one stray brace would unbalance function-body matching and mis-scope
 * a perfectly locked insert. Indices stay aligned with the unmasked source, so a
 * range found here slices the SQL back out of the unmasked copy.
 *
 * Regex literals are NOT masked (telling `/` division from a regex opener needs
 * a full tokenizer). A regex literal carrying an UNBALANCED brace could still
 * mis-scope, but that fails CLOSED (a spurious violation a human sees), never
 * open, and no such literal exists on a Team-insert path today.
 */
function maskLiterals(source) {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          out[j] = ' ';
          if (j + 1 < n && source[j + 1] !== '\n') out[j + 1] = ' ';
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        if (quote !== '`' && source[j] === '\n') break; // unterminated: not a string opener
        if (source[j] !== '\n') out[j] = ' ';
        j += 1;
      }
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * The SQL statements in a stretch of source: the body of each string/template
 * literal, split on `;` so two statements crammed into one literal are judged
 * apart. This is what scopes LEAGUE_LOCK to a single statement - the lock and a
 * `FOR UPDATE` on some other table must live in the SAME statement to count.
 */
function sqlStatements(source) {
  const statements = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      let body = '';
      while (j < n) {
        if (source[j] === '\\') { body += ' '; j += 2; continue; }
        if (source[j] === quote) break;
        if (quote !== '`' && source[j] === '\n') break;
        body += source[j];
        j += 1;
      }
      for (const piece of body.split(';')) statements.push(piece);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return statements;
}

/**
 * The names of any `const`/`let`/`var` in `fileSource` whose string value is a
 * League-row lock. This lets the lock's SQL be hoisted to a (module or local)
 * const and passed to `client.query(LOCK, ...)`: the function still takes the
 * lock, the SQL just lives under a name. Referencing such a name in scope
 * counts as taking the lock (see containsLeagueLock).
 */
function lockConstNames(fileSource) {
  const names = new Set();
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(`[^`]*`|'[^'\n]*'|"[^"\n]*")/g;
  for (const match of fileSource.matchAll(declaration)) {
    if (LEAGUE_LOCK.test(match[2])) names.add(match[1]);
  }
  return names;
}

// The first-argument identifier of every `.query(` call: `client.query(FOO` ->
// `FOO`. A single FIXED literal regex (no per-name `new RegExp`, which trips
// semgrep's detect-non-literal-regexp and needlessly rebuilds a pattern per
// const), matched with matchAll so it stays reentrant.
const QUERY_CALL_ARG = /\.query\s*\(\s*([A-Za-z_$][\w$]*)/g;

/**
 * True when `scopeSource` takes a League-row lock: either a single SQL statement
 * in it IS the lock, or it EXECUTES a lock-const - passes a const whose value is
 * the lock (`lockNames`, from lockConstNames over the whole file) as the first
 * argument of a `.query(` call. It must be the query CALL, not a bare mention: a
 * function that merely names the const (`const note = { sql: LOCK_SQL }`) and
 * then inserts has taken no lock.
 */
function containsLeagueLock(scopeSource, lockNames) {
  if (sqlStatements(scopeSource).some((statement) => LEAGUE_LOCK.test(statement))) return true;
  if (lockNames && lockNames.size) {
    for (const match of scopeSource.matchAll(QUERY_CALL_ARG)) {
      if (lockNames.has(match[1])) return true;
    }
  }
  return false;
}

// Keywords whose `(...) {` is a control block, not a function body.
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory, not
    // from user or network input, so there is no traversal here.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      // Exclude the test tree (fixture SQL is not production code) and the
      // usual non-source directories.
      if (entry.name === 'test' || entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (rel) => rel.split(path.sep).join('/');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const isIdentChar = (c) => c === '_' || c === '$' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/**
 * Is the `{` at `openIndex` the opening brace of a function BODY (a declaration,
 * a method, or an arrow), as opposed to a control block (`if`/`for`/...) or an
 * object/param literal? Operates on comment-stripped source.
 *
 * Scans only a small window backward from `openIndex` (never slices the whole
 * prefix): it is called once per closing brace, so a whole-prefix slice would
 * make the scan O(n^2) in a large file.
 */
function isFunctionBodyOpen(source, openIndex) {
  // The last non-whitespace char before the brace.
  let i = openIndex - 1;
  while (i >= 0 && isSpace(source[i])) i -= 1;
  if (i < 0) return false;
  // Arrow body: `... => {`.
  if (source[i] === '>' && i >= 1 && source[i - 1] === '=') return true;
  // A declaration/method body opens right after the parameter list's `)`.
  if (source[i] !== ')') return false;
  // Match that `)` back to its `(`.
  let depth = 0;
  for (; i >= 0; i -= 1) {
    const c = source[i];
    if (c === ')') depth += 1;
    else if (c === '(') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i < 0) return false;
  // The identifier (if any) immediately before that `(` decides it: a control
  // keyword means a control block, anything else (a function/method name, or
  // `function`) means a body.
  const first = identifierBefore(source, i);
  if (CONTROL_KEYWORDS.has(first.text)) return false;
  // `for await (...) {` puts `await`, not `for`, immediately before the `(`, so
  // the raw keyword reads as a function name. Look one token further back: a
  // preceding `for` makes this a for-await-of control block, not a function.
  if (first.text === 'await') {
    const second = identifierBefore(source, first.start - 1);
    if (second.text === 'for') return false;
  }
  return true;
}

/**
 * The identifier ending at or before `from` (skipping trailing whitespace),
 * as `{ text, start }` where `start` is the index of its first character.
 * `text` is '' when no identifier is there.
 */
function identifierBefore(source, from) {
  let j = from;
  while (j >= 0 && isSpace(source[j])) j -= 1;
  const end = j;
  while (j >= 0 && isIdentChar(source[j])) j -= 1;
  return { text: source.slice(j + 1, end + 1), start: j + 1 };
}

/**
 * Ranges [{open, close}] of every function BODY in comment-stripped source,
 * found by brace matching. Template-literal `${...}` braces are balanced, so
 * they net out; the SQL and messages in this tree carry no stray braces.
 */
function functionBodyRanges(source) {
  const stack = [];
  const ranges = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') stack.push(i);
    else if (c === '}') {
      const open = stack.pop();
      if (open === undefined) continue;
      if (isFunctionBodyOpen(source, open)) ranges.push({ open, close: i });
    }
  }
  return ranges;
}

/** Every function body containing `index` - the insert's lexical-ancestor chain. */
function enclosingFunctions(ranges, index) {
  return ranges.filter((range) => range.open < index && index < range.close);
}

/** The outermost function body containing `index`, or null if none does. */
function outermostFunction(ancestors) {
  let best = null;
  for (const range of ancestors) {
    if (!best || range.open < best.open) best = range;
  }
  return best;
}

/**
 * Every Team-insert site in one file's source, as `{ line }`. Takes RAW source
 * and strips comments itself (the identity-comparison guard's lesson: a caller
 * that forgets to strip would have every commented-out insert reported as real
 * code, silently). This is the DISCOVERY half - what the guard's own tests pin a
 * floor and a named site against.
 */
function findTeamInserts(rawSource) {
  const source = stripComments(rawSource, '.js');
  const found = [];
  for (const match of source.matchAll(TEAM_INSERT)) {
    found.push({ line: lineOf(source, match.index) });
  }
  return found;
}

/**
 * The lock scope for an insert: the text from the insert's OUTERMOST enclosing
 * function up to the insert, with the bodies of nested functions that are NOT on
 * the insert's ancestor chain blanked out.
 *
 * Two directions, and both matter:
 *  - The insert's own enclosing callbacks and loops (its ancestor chain) stay
 *    OPEN, so an insert nested in `rows.map(async r => { ... })` after the lock,
 *    or in a `for await` loop after the lock, still sees the lock its enclosing
 *    function took. (This is the over-correction the first cut got wrong.)
 *  - A nested function that does NOT contain the insert (a helper defined
 *    elsewhere in the body, whether or not it sits textually before the insert)
 *    is BLANKED, so a `FOR UPDATE` inside a helper that may never run, or run in
 *    another transaction, does not count.
 *
 * Ranges and indices come from the masked copy; the SQL is sliced from the
 * unmasked copy, and the two are the same length.
 */
function lockScope(unmasked, ranges, ancestors, outermost, index) {
  const isAncestor = new Set(ancestors);
  const chars = unmasked.slice(outermost.open, index).split('');
  for (const range of ranges) {
    const nestedInOutermost = range.open >= outermost.open && range.close <= outermost.close;
    if (!nestedInOutermost || isAncestor.has(range)) continue;
    const from = Math.max(range.open, outermost.open);
    const to = Math.min(range.close, index - 1);
    for (let p = from; p <= to; p += 1) chars[p - outermost.open] = ' ';
  }
  return chars.join('');
}

/**
 * Every Team-insert site NOT preceded by a League-row lock on its lexical-
 * ancestor chain, as `{ line }`. This is the RULE half. A site with no enclosing
 * function (top-level) is a violation: no lock can be proven for it.
 *
 * Function-body ranges are found on the literal-masked copy (so a brace inside a
 * string or SQL cannot mis-scope them), while the lock is read from the unmasked
 * copy (which still carries the SQL). The two copies are the same length, so a
 * range from one indexes cleanly into the other.
 */
function unlockedTeamInserts(rawSource) {
  const source = stripComments(rawSource, '.js');
  // No insert, no function-body walk: most files have none, and building ranges
  // for them would be wasted work.
  if (!hasTeamInsert(source)) return [];
  const masked = maskLiterals(source);
  const ranges = functionBodyRanges(masked);
  const lockNames = lockConstNames(source);
  const violations = [];
  for (const match of source.matchAll(TEAM_INSERT)) {
    const index = match.index;
    const ancestors = enclosingFunctions(ranges, index);
    const outermost = outermostFunction(ancestors);
    const scope = outermost ? lockScope(source, ranges, ancestors, outermost, index) : '';
    if (!outermost || !containsLeagueLock(scope, lockNames)) {
      violations.push({ line: lineOf(source, index) });
    }
  }
  return violations;
}

/**
 * Scan `roots` for Team-insert sites. Returns two maps keyed by repo-relative
 * posix path: `inserts` (every site, for the discovery floor) and `violations`
 * (unlocked sites, the rule). Refuses any root outside the fixed allowlist.
 */
function scan(roots) {
  const inserts = new Map();
  const violations = new Map();
  for (const root of roots) {
    const directory = ROOT_DIRECTORIES[root];
    if (!directory) throw new Error(`team-insert-lock scan root is not allowed: ${root}`);
    for (const file of walk(directory)) {
      const rel = toPosix(path.relative(REPO, file));
      const raw = fs.readFileSync(file, 'utf8');
      const found = findTeamInserts(raw);
      if (found.length) inserts.set(rel, found);
      const bad = unlockedTeamInserts(raw);
      if (bad.length) violations.set(rel, bad);
    }
  }
  return { inserts, violations };
}

/** Flattened `file:line` lists for both maps. */
function check(roots) {
  const { inserts, violations } = scan(roots);
  const insertSites = [];
  for (const [file, sites] of inserts) {
    for (const { line } of sites) insertSites.push(`${file}:${line}`);
  }
  const violationSites = [];
  for (const [file, sites] of violations) {
    for (const { line } of sites) violationSites.push(`${file}:${line}`);
  }
  return { insertSites, violationSites };
}

function main() {
  const { insertSites, violationSites } = check(SERVER_ROOTS);

  if (insertSites.length === 0) {
    console.error(
      '\n❌ The Team-insert scan found NOTHING under the online server directories. '
      + 'That is not a pass: the discovery matcher has broken, and this guard would be '
      + 'vacuously green.\nFix TEAM_INSERT in scripts/check-team-insert-lock.js.\n'
    );
    process.exit(1);
  }
  if (violationSites.length === 0) {
    console.log(
      `✅ All ${insertSites.length} Team-insert site(s) in the online server directories take a League row lock first.`
    );
    return;
  }
  console.error(
    `\n❌ ${violationSites.length} Team-insert(s) with no League row lock (SELECT ... FROM "leagues" `
    + '... FOR UPDATE) earlier in the same function:\n\n'
    + '  A Draft act reads the Teams into an unlocked snapshot and gates/deletes per Team\n'
    + '  from it (draftAct.service.js). A Team created without serializing behind the\n'
    + '  League lock could be neither gated nor wiped (#1043). Either lock the League row\n'
    + '  before the insert, or - if this insert genuinely needs no such serialization -\n'
    + '  bring the change to the reviewer with the argument for why.\n'
  );
  violationSites.forEach((v) => console.error(`  ${v}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SERVER_ROOTS,
  TEAM_INSERT,
  LEAGUE_LOCK,
  isFunctionBodyOpen,
  functionBodyRanges,
  enclosingFunctions,
  outermostFunction,
  lockConstNames,
  containsLeagueLock,
  findTeamInserts,
  unlockedTeamInserts,
  scan,
  check,
};
