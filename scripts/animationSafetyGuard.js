'use strict';

/**
 * Guard for issue #542: forwards-filled animations that end in a hidden state
 * become PERMANENTLY hidden under reduced motion.
 *
 * WHY THIS EXISTS. src/theme/base.css (issue #533) collapses every non-essential
 * animation to `animation-duration: 0s` under `prefers-reduced-motion: reduce`,
 * but it does NOT touch `animation-fill-mode`. A forwards-filled animation
 * therefore jumps straight to its final keyframe and HOLDS it. When that final
 * keyframe hides the element (opacity 0, visibility hidden, display none) the
 * content is not made instantaneous, it is DELETED - and because the node stays
 * in the accessibility tree, the loss falls only on SIGHTED reduced-motion
 * users, the very group the reduced-motion policy exists to serve. The live
 * instance was RetroField's scoring-play callout (`flashIn`, ending
 * `100% { opacity: 0 }`); it is fixed, and this guard is what stops a
 * reintroduction.
 *
 * WHAT IT FLAGS. An animation declaration is unsafe when ALL of:
 *   1. it uses forwards fill (shorthand `forwards`/`both`, or an explicit
 *      `animation-fill-mode: forwards|both`), AND
 *   2. the keyframes it names end in a hidden final state (the `to` / `100%`
 *      keyframe explicitly sets opacity 0, visibility hidden, or display none),
 *      AND
 *   3. it has NO meaningful reduced-motion alternative for that same
 *      declaration or surface (see the two scanners for what counts).
 *
 * TWO SCANNERS, TWO PROBLEM SHAPES (ADR-style rationale, and the design fork
 * ruled on for #542):
 *   - The CSS side (scanCss, scripts/animationSafetyCss.js) is LEXICAL for
 *     detecting keyframes and hidden end states, but STRUCTURAL for correlating
 *     an animated selector to a reduce block inside a media query, so it uses
 *     postcss (already a transitive dependency, now declared direct).
 *   - The JS/Emotion side (scanJs, scripts/animationSafetyJs.js) asks a
 *     STRUCTURAL question - "is this animation the alternate branch of a
 *     prefers-reduced-motion conditional?" - which a regex can only guess at
 *     (it would guess right today and wrong after a reformat or a variable
 *     extraction). It uses @babel/parser, for the same reason.
 *
 * This file holds the SHARED LEXICAL CORE used by both scanners: parsing a
 * keyframes body and deciding whether its final keyframe is hidden. It is pure
 * (text in, verdict out, no filesystem), so both directions of the proof - an
 * unsafe end state is flagged, a visible end state is not - are testable against
 * fixture strings. scripts/animationSafetyGuard.test.js reads the real tree and
 * the deliberately-unsafe fixtures; only `npm run guards` makes it bite on a PR.
 */

// A hidden final state, per the #542 triage brief: opacity zero, visibility
// hidden, or display none. Nothing else counts (a `background: transparent`
// end, as in pickLandedFlash/scoreFlash, is NOT hidden - the element is still
// laid out and its text still renders), so those must NOT be swept in.
const HIDDEN_OPACITY = /^0(\.0+)?$/;

// Strip CSS block comments before parsing a keyframes body, so a `{`/`}` or a
// stray `opacity: 0` inside a comment cannot be mistaken for a real
// declaration. Keyframes bodies do not contain strings, so there is no
// string-vs-comment ambiguity to handle here.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Parse a declaration block ("opacity: 0; transform: none") into a lower-cased
// property -> value map. A later declaration of the same property wins, which
// matches the CSS cascade within a single keyframe.
function parseDeclarations(declText) {
  const decls = {};
  for (const part of declText.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().toLowerCase();
    if (!prop) continue;
    decls[prop] = value;
  }
  return decls;
}

// Given a property -> value map for a keyframe, return a human-readable reason
// string if it hides the element, else null. `visibility` and `display` are
// matched exactly (`hidden` / `none`); `opacity` matches 0 or 0.0... but never
// 0.5 or a non-zero value.
function hiddenReasonFromDecls(decls) {
  if (decls.opacity !== undefined && HIDDEN_OPACITY.test(decls.opacity)) {
    return `opacity: ${decls.opacity}`;
  }
  if (decls.visibility === 'hidden') return 'visibility: hidden';
  if (decls.display === 'none') return 'display: none';
  return null;
}

// A single keyframe selector token -> its numeric offset (0..100), or null if
// it is not an offset we understand. `from` is 0%, `to` is 100%, `N%` is N.
function offsetForToken(token) {
  const t = token.trim().toLowerCase();
  if (t === 'from') return 0;
  if (t === 'to') return 100;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(t);
  return m ? Number(m[1]) : null;
}

// Parse a keyframes body ("0% { ... } 100% { ... }") into an array of blocks,
// each { offsets: number[], declText: string }. Blocks whose selector has no
// recognizable offset are dropped.
function parseKeyframeBlocks(body) {
  const clean = stripCssComments(body);
  const blocks = [];
  // Keyframe blocks do not nest, so a non-brace-greedy match over
  // `<selector> { <decls> }` is exact here.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1];
    const declText = match[2];
    const offsets = selector
      .split(',')
      .map(offsetForToken)
      .filter((o) => o !== null);
    if (offsets.length === 0) continue;
    blocks.push({ offsets, declText });
  }
  return blocks;
}

/**
 * The heart of the shared core: does a keyframes body end in a hidden state?
 *
 * Under forwards fill the persisted state is the FINAL keyframe (the highest
 * offset, i.e. `to` / `100%`). Only properties EXPLICITLY declared in that final
 * keyframe persist; anything it omits falls back to the element's underlying
 * value and is not something the animation pins. So we look only at the final
 * keyframe's own declarations - a deliberately conservative boundary that
 * matches the real defect (flashIn sets `opacity: 0` at 100% explicitly) and
 * avoids inferring a hidden state the animation does not actually hold.
 *
 * If several blocks share the max offset (e.g. a `50%, 100%` and a separate
 * `100%`), their declarations are merged in source order, last winning, again
 * matching the cascade.
 *
 * Returns { hidden, reason, finalOffset }. `hidden` is false with a null reason
 * when there is no recognizable final keyframe or it declares nothing hiding.
 */
function finalKeyframeHiddenReason(body) {
  const blocks = parseKeyframeBlocks(body);
  if (blocks.length === 0) return { hidden: false, reason: null, finalOffset: null };
  const maxOffset = Math.max(...blocks.map((b) => Math.max(...b.offsets)));
  const finalDecls = {};
  for (const block of blocks) {
    if (!block.offsets.includes(maxOffset)) continue;
    Object.assign(finalDecls, parseDeclarations(block.declText));
  }
  const reason = hiddenReasonFromDecls(finalDecls);
  return { hidden: reason !== null, reason, finalOffset: maxOffset };
}

// ============================================================================
// THE WHOLE CHECK: walk the app source and report unsafe animations.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src'];
const CSS_EXTENSIONS = new Set(['.css']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|jsx|ts|tsx)$/;

// Paths allowed to keep an unsafe animation, each with a reason a reader can
// check, in the shape emDashGuard/check-color-literals use (a flat array of
// posix paths; a trailing '/' marks a directory prefix). Expected EMPTY at
// merge - this is the escape hatch for a real false positive (a valid
// reduced-motion guard written in a shape the scanners do not yet recognize),
// so the fix for a wrong flag is one reasoned line here, not deleting the gate.
const ALLOWLIST = [];

function isTestFile(relPosix) {
  return TEST_FILE_PATTERN.test(relPosix);
}

function isAllowlisted(relPosix) {
  return ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? relPosix.startsWith(entry) : relPosix === entry
  );
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory, not
    // from user or network input.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

// Lazy-require the scanners so the shared core (this file) has no hard runtime
// dependency on @babel/parser or postcss until an actual scan runs.
function loadScanners() {
  const { scanCss } = require('./animationSafetyCss');
  const { scanJs } = require('./animationSafetyJs');
  return { scanCss, scanJs };
}

/**
 * Scan the app source tree (default `src/`) for unsafe animations. Returns
 * { violations, stats } where each violation is
 * { file, line, source, animationName, reason } and stats carries the counts
 * that prove the scan actually looked: filesScanned, keyframes, forwardsUsages,
 * unresolved, parseErrors.
 *
 * `roots` is injectable so a test can point the same walker at the
 * deliberately-unsafe fixture directory and prove the check still fires.
 */
function findViolations({ root = REPO_ROOT, roots = SCAN_ROOTS } = {}) {
  const { scanCss, scanJs } = loadScanners();
  const violations = [];
  const stats = {
    filesScanned: 0,
    keyframes: 0,
    forwardsUsages: 0,
    unresolved: 0,
    parseErrors: 0,
  };

  for (const scanRoot of roots) {
    const dir = path.join(root, scanRoot);
    if (!fs.existsSync(dir)) continue;
    for (const file of walkFiles(dir)) {
      const ext = path.extname(file);
      const relPosix = toPosix(path.relative(root, file));
      const isCss = CSS_EXTENSIONS.has(ext);
      const isJs = JS_EXTENSIONS.has(ext);
      if (!isCss && !isJs) continue;
      if (isTestFile(relPosix) || isAllowlisted(relPosix)) continue;

      const source = fs.readFileSync(file, 'utf8');
      const result = isCss ? scanCss(source) : scanJs(source);
      stats.filesScanned += 1;
      stats.keyframes += result.keyframesCount || 0;
      stats.forwardsUsages += result.forwardsUsageCount || 0;
      stats.unresolved += result.unresolvedCount || 0;
      if (result.parseError) stats.parseErrors += 1;
      for (const v of result.violations) {
        violations.push({
          file: relPosix,
          line: v.line,
          source: isCss ? 'css' : 'js',
          animationName: v.animationName,
          reason: v.reason,
          selector: v.selector,
        });
      }
    }
  }

  return { violations, stats };
}

// A clear, single-line report of one violation: the declaration it named and
// the reason it printed (criterion 7).
function formatViolation(v) {
  const where = v.source === 'css' ? `selector \`${v.selector}\`` : `animation \`${v.animationName}\``;
  const named = v.source === 'css' ? `animation \`${v.animationName}\`` : where;
  return (
    `${v.file}:${v.line ?? '?'}: [animation-safety] ${named} is forwards-filled and its ` +
    `final keyframe hides the element (${v.reason}); under reduced motion the ` +
    `global 0s policy pins it hidden with no reduced-motion alternative for this ` +
    (v.source === 'css' ? `selector.` : `declaration.`)
  );
}

module.exports = {
  HIDDEN_OPACITY,
  stripCssComments,
  parseDeclarations,
  hiddenReasonFromDecls,
  offsetForToken,
  parseKeyframeBlocks,
  finalKeyframeHiddenReason,
  REPO_ROOT,
  SCAN_ROOTS,
  ALLOWLIST,
  isTestFile,
  isAllowlisted,
  findViolations,
  formatViolation,
};
