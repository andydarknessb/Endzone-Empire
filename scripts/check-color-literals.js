#!/usr/bin/env node
/**
 * Guard against new hard-coded color literals in front-end code.
 *
 * All colors must come from the design tokens in src/theme/tokens.js (used via
 * the MUI theme, `var(--token)`, or palette references like 'text.primary').
 * This script scans src/ for raw hex / rgb() / hsl() / quoted-named colors and
 * exits non-zero if any appear outside the allowlist below.
 *
 * Run: `npm run lint:colors`
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const EXTENSIONS = new Set(['.css', '.js', '.jsx']);

// Files/dirs allowed to contain literals, with the reason each is exempt.
const ALLOWLIST = [
  'src/theme/tokens.js', // the single source of truth — literals live here
  'src/theme/base.css', // var(--token, fallback) fallbacks for first paint
  'src/theme/contrast.js', // pure math, no colors, but belongs to the system
  'src/lib/nflTeamColors.js', // real NFL team colors (external data)
  'src/components/DraftGradesCard/', // A–F grade scale (data encoding)
  'src/components/LandingPage/LandingPage.css', // accent-tint gradient w/ both themes
  'src/features/celebrate-touchdown/ui/TecmoCutscene.css', // retro CRT scanline/gradient FX (not themeable)
  'src/features/celebrate-touchdown/ui/TecmoCutscene.jsx', // fixed pixel-art sprite palette (data encoding)
  'src/shared/ui/TecmoSprite.jsx', // fixed pixel-art sprite palette (data encoding)
  'src/content/articles/', // inline SVG illustrations in article hero banners (not themeable)
];

// Test files legitimately assert on color values.
const isTestFile = (rel) => /\.test\.(js|jsx)$/.test(rel);

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\b(rgba?|hsla?)\s*\(/;
const NAMED = /(?::\s*|['"])(goldenrod|whitesmoke|orange|lightgray|lightgrey|gainsboro|silver|maroon|navy|teal|olive|aqua|fuchsia|lime)\b/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory (SRC),
    // not from user or network input, so there's no traversal here.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function isAllowlisted(relPosix) {
  if (isTestFile(relPosix)) return true;
  return ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? relPosix.startsWith(entry) : relPosix === entry
  );
}

// Strip comments out of a file's text before it's scanned for color
// literals. Comments style nothing, so a hex/rgb/named-color literal that
// only ever appears inside one is never a real violation — and a bare
// GitHub issue reference like `#116` or `#122` inside a comment can no
// longer be misread as a 3-digit hex color, because the whole comment is
// gone before the HEX/FUNC/NAMED patterns ever see it.
//
// Handles, for .js/.jsx:
//   - `//` line comments
//   - `/* ... */` block comments, single- or multi-line, with or without a
//     leading `*` continuation on interior lines (that leading-`*` shape is
//     just a convention some block comments follow, not something this
//     scanner depends on)
//   - JSX `{/* ... */}` comments — the outer `{`/`}` are left alone (they
//     aren't color-literal syntax); the `/* ... */` inside is stripped by
//     the same block-comment handling as any other block comment
//   - single/double-quoted strings and template literals are scanned as
//     opaque units so a `//` inside one (e.g. `'http://example.com'`) is
//     never misread as the start of a line comment. A single/double-quoted
//     string is only recognized as such when a matching closing quote
//     appears before the next newline (real JS/CSS strings can't contain a
//     raw newline) — otherwise the quote is just an apostrophe in ordinary
//     text (e.g. JSX content like "can't") and is left as an ordinary
//     character, so it can't swallow a real comment later in the file
//     while "looking for" a closing quote that was never a string's to
//     begin with
//   - regex literals (e.g. `/[/*]/`) are scanned as opaque units too, so a
//     `/*`-like sequence inside a character class can't be misread as the
//     start of a block comment on the scan's next pass. A `/` right after
//     `<` is never treated as a regex start, since that's a JSX closing tag
//     (`</a>`), not an expression position
// For .css, only `/* ... */` block comments apply (CSS has no `//` line
// comments); quoted strings are still scanned as opaque units, with the
// same newline-bounded rule above, so a `/*` inside a quoted
// `content:`/`url()` value can't be misread as a comment start.
//
// Line breaks are always preserved (stripped characters become spaces, not
// removed) so line numbers in the reported violations stay accurate.
function stripComments(text, ext) {
  const isJs = ext === '.js' || ext === '.jsx';
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : '';

    if (c === '"' || c === "'") {
      // A JS/CSS string literal can't contain a raw, unescaped newline (a
      // `\` immediately before one is a legal line continuation and is
      // already swallowed by the backslash-skip below, so it never reaches
      // this check). Without this bound, an apostrophe in ordinary JSX text
      // (e.g. "can't") reads as a string opener and the scan runs to the
      // next quote anywhere later in the file — silently copying through,
      // unstripped, any real comment that happens to fall in between. If no
      // closing quote turns up before a raw newline (or EOF), this wasn't a
      // string opener at all — emit it as a single ordinary character
      // instead of consuming anything.
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

    if (isJs && c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== '`') {
        j += text[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, n);
      out += text.slice(i, j);
      i = j;
      continue;
    }

    if (isJs && c === '/' && c2 === '/') {
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

    // A regex literal's body can legally contain `/*` or `//` inside a
    // character class (e.g. `/[/*]/`) — without this, the scan above would
    // reach that inner `/*` on its next pass and misread it as a block
    // comment, silently swallowing every line after it (including any real
    // color literals) up to the next stray `*/`. `/*` and `//` are already
    // handled above and can never be regex literals, so this only fires for
    // an unambiguous `/pattern/` in an expression position.
    if (isJs && c === '/' && c2 !== '*' && c2 !== '/' && isRegexContext(out)) {
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

// Keywords after which a `/` starts an expression (so a regex literal is
// expected) rather than following a value (so `/` is division).
const REGEX_CONTEXT_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

// Decide whether a `/` at the current scan position can start a regex
// literal, by looking at the last significant character already written to
// `out`. `/*` and `//` are excluded before this is ever called (they can
// only be comments in real JS — an empty regex literal isn't valid syntax),
// so this only has to separate "regex expected" contexts (after `(`, `,`,
// `=`, a keyword, ...) from "division" contexts (after an identifier,
// number, `)`, `]`, `}`, a string/template that just closed, ...).
function isRegexContext(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true; // start of file
  const ch = out[j];
  if (/[)\]}]/.test(ch)) return false;
  // A `<` immediately before this `/` is a JSX closing tag (`</a>`), not an
  // expression position — without this, `<` falls through to the "any
  // other punctuation" case below and the `/` of `</...>` gets read as a
  // regex-literal start, consuming up to the tag's next `/` (its own
  // self-closing or the next element) and leaving quote/comment scanning
  // desynced for everything after it on that line.
  if (ch === '<') return false;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
    return REGEX_CONTEXT_KEYWORDS.has(out.slice(k + 1, j + 1));
  }
  return true;
}

// Look for a regex literal starting at text[i] (`text[i] === '/'`). Returns
// the index just past the closing delimiter (and any flags), or null if no
// unescaped closing `/` is found before a newline (real regex literals
// can't contain a literal line break, so this isn't one).
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

// Ignore var() fallbacks (`var(--x, #fff)` is intentional), then test for
// any of the three color-literal shapes.
function hasColorLiteral(line) {
  const stripped = line.replace(/var\([^)]*\)/g, '');
  return HEX.test(stripped) || FUNC.test(stripped) || NAMED.test(stripped);
}

// Scan one file's already-read text for violations, given its repo-relative
// posix path (used only for the reported message) and extension (used to
// decide whether `//` comments apply).
function findViolations(relPosix, ext, rawText) {
  const originalLines = rawText.split(/\r?\n/);
  const strippedLines = stripComments(rawText, ext).split(/\r?\n/);
  const violations = [];
  strippedLines.forEach((strippedLine, i) => {
    if (hasColorLiteral(strippedLine)) {
      violations.push(`${relPosix}:${i + 1}: ${originalLines[i].trim()}`);
    }
  });
  return violations;
}

function main() {
  const violations = [];
  for (const file of walk(SRC)) {
    const relPosix = toPosix(path.relative(path.join(__dirname, '..'), file));
    if (isAllowlisted(relPosix)) continue;

    const ext = path.extname(file);
    const rawText = fs.readFileSync(file, 'utf8');
    violations.push(...findViolations(relPosix, ext, rawText));
  }

  if (violations.length > 0) {
    console.error(
      `\n❌ Found ${violations.length} hard-coded color literal(s). ` +
        `Use a design token from src/theme/tokens.js instead.\n`
    );
    violations.forEach((v) => console.error(`  ${v}`));
    console.error(
      '\nIf a literal is legitimate (external data, data-encoding scale), add it ' +
        'to the ALLOWLIST in scripts/check-color-literals.js with a reason.\n'
    );
    process.exit(1);
  }

  console.log('✅ No hard-coded color literals found outside the allowlist.');
}

if (require.main === module) {
  main();
}

module.exports = {
  stripComments,
  hasColorLiteral,
  findViolations,
};
