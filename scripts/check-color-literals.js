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
  'src/components/MatchupDetail/TecmoCutscene.css', // retro CRT scanline/gradient FX (not themeable)
  'src/components/MatchupDetail/TecmoCutscene.jsx', // fixed pixel-art sprite palette (data encoding)
  'src/components/MatchupDetail/TecmoSprite.jsx', // fixed pixel-art sprite palette (data encoding)
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

// An all-digit `#NNN`/`#NNNN` etc. is exactly what a GitHub issue reference
// looks like ("(#116", "#116)", "#116 AC3") — and JS/JSX comments and JSDoc
// routinely cite the issue a change belongs to. A real hex color literal
// almost always carries at least one a-f digit; requiring digits-only here
// keeps this exemption from swallowing genuine 3/6-digit all-numeric colors
// outside a comment (those still hit HEX below, since this only strips
// matches on lines that are entirely comment).
const ISSUE_REFERENCE = /#\d+\b/g;

// A whole-line comment in JS/JSX: a `//` line, an interior line of a
// `/** ... */` block (which in this codebase always continues with a
// leading `*`), or a single-line `/** ... */`/`/* ... */` doc comment that is
// the ENTIRE line (starts with `/*` AND ends with `*/`) — not just a comment
// prefix followed by real code, e.g. `/* eslint-disable-next-line */ x = 1`,
// where only the leading fragment is a comment and the rest must still be
// checked. Scoped to .js/.jsx only — in .css, a leading `*` is the universal
// selector, not a comment continuation.
function isCommentLine(ext, trimmedLine) {
  if (ext !== '.js' && ext !== '.jsx') return false;
  if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) return true;
  return trimmedLine.startsWith('/*') && trimmedLine.endsWith('*/');
}

const violations = [];
for (const file of walk(SRC)) {
  const relPosix = toPosix(path.relative(path.join(__dirname, '..'), file));
  if (isAllowlisted(relPosix)) continue;

  const ext = path.extname(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Ignore var() fallbacks: `var(--x, #fff)` is intentional.
    let stripped = line.replace(/var\([^)]*\)/g, '');
    if (isCommentLine(ext, line.trim())) {
      stripped = stripped.replace(ISSUE_REFERENCE, '#');
    }
    if (HEX.test(stripped) || FUNC.test(stripped) || NAMED.test(stripped)) {
      violations.push(`${relPosix}:${i + 1}: ${line.trim()}`);
    }
  });
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
