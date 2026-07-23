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

const violations = [];
for (const file of walk(SRC)) {
  const relPosix = toPosix(path.relative(path.join(__dirname, '..'), file));
  if (isAllowlisted(relPosix)) continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Ignore var() fallbacks: `var(--x, #fff)` is intentional.
    const stripped = line.replace(/var\([^)]*\)/g, '');
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
