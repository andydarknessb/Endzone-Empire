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

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'server'];
const SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// Directories excluded from the scan by path, with the reason each is
// exempt. server/db/migrations/ holds knex migration files whose bodies are
// SQL template strings -- SQL text, never rendered to a user -- so an em
// dash inside one (there are two, in `--` SQL comments, at the time this
// guard was written) is out of scope by ruling, not by accident.
const EXCLUDED_DIRS = [{ dir: 'server/db/migrations', reason: 'SQL text, never rendered' }];

// Paths allowed to keep an em dash, with a reason per entry, in the shape
// of scripts/check-color-literals.js's ALLOWLIST. Expected empty at merge;
// anything added here needs a reason a reader can check.
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
  return ALLOWLIST.some((entry) => entry.path === relPosix);
}

// Strip comments out of a file's text before it is scanned for an em dash.
// A comment styles nothing a user sees, so an em dash that only ever
// appears inside one is never a real violation. String and template
// literal content is copied through untouched -- it is the one place a
// literal character actually reaches a user.
//
// Handles:
//   - `//` line comments
//   - `/* ... */` block comments, single- or multi-line -- this also
//     covers JSX `{/* ... */}` comments, since the outer `{`/`}` are left
//     alone (they aren't comment syntax) and the `/* ... */` inside them is
//     stripped the same as any other block comment
//   - single/double-quoted strings and template literals, scanned as
//     opaque units so a `//` inside one (e.g. `'https://example.com'`) is
//     never misread as the start of a line comment. A quoted string is
//     only recognized as such when a matching closing quote appears before
//     the next newline (a real JS string can't contain a raw newline);
//     otherwise the quote is just an apostrophe in ordinary text (JSX
//     content like "can't") and is left as an ordinary character, so it
//     can't swallow a real comment later in the file while "looking for" a
//     closing quote that was never a string's to begin with
//   - regex literals (e.g. `/[/*]/`) are scanned as opaque units too, so a
//     `/*`-like sequence inside a character class is never misread as a
//     block-comment start on a later pass. A `/` right after `<` is never
//     treated as a regex start, since that's a JSX closing tag (`</a>`),
//     not an expression position
//
// Line breaks are always preserved (stripped characters become spaces, not
// removed) so line numbers in reported hits stay accurate.
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : '';

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === quote) { closed = true; break; }
        if (text[j] === '\n') break;
        j += text[j] === '\\' ? 2 : 1;
      }
      if (!closed) {
        out += c;
        i += 1;
        continue;
      }
      j += 1;
      out += text.slice(i, j);
      i = j;
      continue;
    }

    if (c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== '`') {
        j += text[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, n);
      out += text.slice(i, j);
      i = j;
      continue;
    }

    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }

    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }

    if (c === '/' && c2 !== '*' && c2 !== '/' && isRegexContext(out)) {
      const end = scanRegexLiteral(text, i);
      if (end !== null) {
        out += text.slice(i, end);
        i = end;
        continue;
      }
    }

    out += c;
    i += 1;
  }

  return out;
}

const REGEX_CONTEXT_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

function isRegexContext(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true;
  const ch = out[j];
  if (/[)\]}]/.test(ch)) return false;
  if (ch === '<') return false;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
    return REGEX_CONTEXT_KEYWORDS.has(out.slice(k + 1, j + 1));
  }
  return true;
}

function scanRegexLiteral(text, i) {
  const n = text.length;
  let j = i + 1;
  let inClass = false;
  let closed = false;
  while (j < n) {
    const ch = text[j];
    if (ch === '\n') break;
    if (ch === '\\') { j += 2; continue; }
    if (ch === '[') { inClass = true; j += 1; continue; }
    if (ch === ']') { inClass = false; j += 1; continue; }
    if (ch === '/' && !inClass) { j += 1; closed = true; break; }
    j += 1;
  }
  if (!closed) return null;
  while (j < n && /[a-zA-Z]/.test(text[j])) j += 1;
  return j;
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
