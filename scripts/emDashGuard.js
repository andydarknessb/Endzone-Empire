'use strict';

// Guard for issue #501: the no-em-dash house-style rule had no consumer
// (ADR 0016, following ADR 0010's "a convention ships with its consumer").
// Before this guard, the rule lived in a few per-string tests, in code
// comments that said "house style", and in the gitignored per-checkout
// CLAUDE.md -- so its observed health was produced by hand, a reviewer
// byte-checking a diff. This module finds a live em dash in user-facing
// source and reports file + line, so a violation is caught by
// `npm run guards` instead.
//
// Scope, per docs/adr/0016-no-em-dashes-in-user-facing-copy.md: .js, .jsx,
// .ts, .tsx under src/ and server/, excluding test/spec files and
// server/db/migrations/ (SQL text, never rendered). Comments -- `//` line
// comments, `/* */` block comments, and JSX `{/* */}` comments (a block
// comment inside braces, so the block-comment handling covers it) -- are
// stripped before matching, so a comment is never a hit. String and
// template literal content is left intact: a rendered string IS
// user-facing copy, which is exactly the "operation(s) failed" error
// message #501 found live in server/services/correction.service.js.
//
// This module is pure: findEmDashes(source) takes source text and returns
// hits with line numbers, no filesystem access. scripts/emDashGuard.test.js
// is what reads the real tree, and only the `guards` npm script (run by
// the `guards` CI job) makes it bite on a pull request.

const fs = require('node:fs');
const path = require('node:path');
const { stripComments: stripJsComments } = require('./check-color-literals');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'server'];
const SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// Directories excluded from the scan by path, with the reason each is
// exempt. server/db/migrations/ holds knex migration files whose bodies are
// SQL template strings -- SQL text, never rendered to a user -- so an em
// dash inside one (there are two, in `--` SQL comments, at the time this
// guard was written) is out of scope by ruling, not by accident.
const EXCLUDED_DIRS = [{ dir: 'server/db/migrations', reason: 'SQL text, never rendered' }];

// Paths allowed to keep an em dash, with a reason per entry, in the actual
// shape of scripts/check-color-literals.js's ALLOWLIST: a flat array of
// posix paths, each with its reason as a trailing `//` comment, where a
// trailing '/' marks a directory prefix rather than one file. Expected
// empty at merge; anything added here needs a reason a reader can check.
const ALLOWLIST = [];

const TEST_FILE_PATTERN = /\.(test|spec)\.(js|jsx|ts|tsx)$/;

// The three forms #501 asked this guard to catch: the raw U+2014 character,
// and its two HTML-entity escapes. (One of the original sweep's misses hid
// as `&mdash;` in an SEO title -- an entity is exactly as user-facing as
// the character it stands for once it's rendered.)
const EM_DASH_PATTERN = /—|&mdash;|&#8212;/g;

const REPLACEMENT_RULE =
  'No em dashes in user-facing copy: use real prose punctuation (comma, colon, ' +
  'full stop) or rewrite the sentence, the middot for label separators ' +
  '(·, as in "alice · commissioner"), a hyphen in a score ' +
  '("DEN 10 - 17 KC"), or a plain "-" in an empty table cell.';

function isTestFile(relPosix) {
  return TEST_FILE_PATTERN.test(relPosix);
}

function isExcludedDir(relPosix) {
  return EXCLUDED_DIRS.some(({ dir }) => relPosix === dir || relPosix.startsWith(dir + '/'));
}

function isAllowlisted(relPosix) {
  return ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? relPosix.startsWith(entry) : relPosix === entry
  );
}

// Strip comments out of a file's text before it is scanned for an em dash.
// A comment styles nothing a user sees, so an em dash that only ever
// appears inside one is never a real violation. String and template
// literal content is copied through untouched -- it is the one place a
// literal character actually reaches a user.
//
// This delegates to check-color-literals.js's stripComments rather than
// re-implementing it: that tokenizer (`//`/`/* */`/JSX `{/* */}` comments,
// quoted strings and template literals scanned as opaque units so a `//`
// inside a URL string is never misread as a comment start, regex literals
// scanned opaquely too) is already built and already tested there, and
// scripts/check-identity-comparisons.js already reuses it the same way, for
// the same stated reason: "getting it right is genuinely hard ... and it is
// already tested." A second, drifting copy would only add a place for these
// two guards to silently disagree.
//
// The '.js' passed below is not a claim about the file being scanned -- it
// only selects stripComments' JS-like `//`-comment branch (its only
// extension-sensitive behavior), which is correct for all four of this
// guard's scanned extensions: TypeScript's comment, string, template-literal
// and regex-literal grammar is the same JS grammar for every construct this
// tokenizer cares about, so `.ts`/`.tsx` get identical treatment to
// `.js`/`.jsx` here on purpose, not by omission.
//
// KNOWN LIMITATIONS, inherited from the shared tokenizer and verified
// against this guard during #501's review (each also reproduces against
// check-color-literals.js's own stripComments, so this is shared,
// pre-existing behavior, not something this guard introduced):
//   - a template literal nested inside another template literal's `${...}`
//     interpolation desyncs the closing-backtick scan, which can misread a
//     `//` inside the inner literal as a line-comment start and blank the
//     rest of that source line
//   - a comment written inside a template literal's `${...}` interpolation
//     (e.g. `` `${/* note */ x}` ``) is copied through opaquely as part of
//     the template span instead of being recognized and stripped, which can
//     produce a false positive
//   - a `/` immediately after a postfix `++`/`--` (or certain other
//     non-identifier characters) can be misread as the start of a regex
//     literal, consuming through a genuine trailing `//` comment on the same
//     line without recognizing it as one
// A correct fix for all three needs a real JS/JSX parser, which is a bigger
// lift than a lightweight, regex-based guard script -- consistent with this
// repo's existing choice not to do that in check-color-literals.js either.
// None of the four em-dash violations #501 found trip any of these paths
// (verified: the "the real tree carries no em dash" test below reads the
// actual tree, not a stand-in). If one of these ever bites on a real file,
// the fix belongs in check-color-literals.js's stripComments, where both
// guards would pick it up together.
function stripComments(text) {
  return stripJsComments(text, '.js');
}

// The pure core: source text in, em-dash hits with line numbers out. Both
// directions of the guard's proof -- a real hit is reported, and stripping
// it (or moving it into a comment) clears the same report -- are testable
// against fixture strings with no filesystem involved.
function findEmDashes(source) {
  const stripped = stripComments(source);
  const strippedLines = stripped.split(/\r?\n/);
  const originalLines = source.split(/\r?\n/);
  const hits = [];
  strippedLines.forEach((line, i) => {
    EM_DASH_PATTERN.lastIndex = 0;
    let match;
    while ((match = EM_DASH_PATTERN.exec(line)) !== null) {
      hits.push({ line: i + 1, match: match[0], text: originalLines[i].trim() });
    }
  });
  return hits;
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

// Walk one scan root (relative to REPO_ROOT, e.g. 'src') and return every
// file under it with a scanned extension.
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory
    // (REPO_ROOT/src or REPO_ROOT/server), not from user or network input.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// The whole check: walk src/ and server/, skip test files, the migrations
// exclusion and the allowlist, and report every em-dash hit found in the
// rest, each formatted as `<path>:<line>: <offending text>`.
function findViolations(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = path.join(root, scanRoot);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const relPosix = toPosix(path.relative(root, file));
      if (isTestFile(relPosix) || isExcludedDir(relPosix) || isAllowlisted(relPosix)) continue;

      const source = fs.readFileSync(file, 'utf8');
      for (const hit of findEmDashes(source)) {
        violations.push({ file: relPosix, line: hit.line, match: hit.match, text: hit.text });
      }
    }
  }
  return violations;
}

function formatViolation(v) {
  return `${v.file}:${v.line}: ${v.text}`;
}

module.exports = {
  REPO_ROOT,
  SCAN_ROOTS,
  SCAN_EXTENSIONS,
  EXCLUDED_DIRS,
  ALLOWLIST,
  EM_DASH_PATTERN,
  REPLACEMENT_RULE,
  isTestFile,
  isExcludedDir,
  isAllowlisted,
  stripComments,
  findEmDashes,
  walk,
  findViolations,
  formatViolation,
};
