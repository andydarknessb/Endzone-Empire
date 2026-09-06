'use strict';

// This test builds JS and CSS SOURCE TEXT as fixture data. The `${ident}`
// sequences inside ordinary strings are the Emotion keyframes interpolations
// under test (e.g. `animation: `${flashIn} ...``), not mistaken template
// literals, so no-template-curly-in-string is a false positive for this file.
/* eslint-disable no-template-curly-in-string */

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const {
  parseDeclarations,
  hiddenReasonFromDecls,
  offsetForToken,
  parseKeyframeBlocks,
  finalKeyframeHiddenReason,
} = require('./animationSafetyGuard');
const { scanCss } = require('./animationSafetyCss');
const { scanJs } = require('./animationSafetyJs');
const { findViolations, formatViolation, ALLOWLIST } = require('./animationSafetyGuard');

const REPO_ROOT = path.resolve(__dirname, '..');

// A hidden-ending Emotion keyframes (the flashIn shape) as a source prelude.
const HIDDEN_KF = "const flashIn = keyframes`\n  0% { opacity: 0; }\n  15% { opacity: 1; }\n  100% { opacity: 0; }\n`;\n";
// A visible-ending Emotion keyframes (the dash shape).
const VISIBLE_KF = "const dash = keyframes`\n  from { transform: translateX(0); }\n  to { transform: translateX(var(--d)); }\n`;\n";

// ============================================================================
// SHARED LEXICAL CORE: does a keyframes body end in a hidden state?
// ============================================================================

test('offsetForToken maps from/to/N% and rejects the rest', () => {
  assert.equal(offsetForToken('from'), 0);
  assert.equal(offsetForToken('to'), 100);
  assert.equal(offsetForToken('0%'), 0);
  assert.equal(offsetForToken(' 100% '), 100);
  assert.equal(offsetForToken('42.5%'), 42.5);
  assert.equal(offsetForToken('cover'), null);
  assert.equal(offsetForToken('50'), null); // percent sign required
});

test('parseDeclarations builds a last-wins prop map, lower-cased', () => {
  assert.deepEqual(parseDeclarations('opacity: 0; transform: none'), {
    opacity: '0',
    transform: 'none',
  });
  assert.deepEqual(parseDeclarations('OPACITY: 1; opacity: 0'), { opacity: '0' });
});

test('hiddenReasonFromDecls: opacity 0 (and 0.0) is hidden, opacity 1 / 0.5 is not', () => {
  assert.equal(hiddenReasonFromDecls({ opacity: '0' }), 'opacity: 0');
  assert.equal(hiddenReasonFromDecls({ opacity: '0.0' }), 'opacity: 0.0');
  assert.equal(hiddenReasonFromDecls({ opacity: '1' }), null);
  assert.equal(hiddenReasonFromDecls({ opacity: '0.5' }), null);
});

test('hiddenReasonFromDecls: visibility hidden and display none are hidden', () => {
  assert.equal(hiddenReasonFromDecls({ visibility: 'hidden' }), 'visibility: hidden');
  assert.equal(hiddenReasonFromDecls({ display: 'none' }), 'display: none');
  assert.equal(hiddenReasonFromDecls({ visibility: 'visible' }), null);
  assert.equal(hiddenReasonFromDecls({ display: 'block' }), null);
});

test('hiddenReasonFromDecls: a transparent background is NOT hidden (pickLandedFlash shape)', () => {
  assert.equal(hiddenReasonFromDecls({ 'background-color': 'transparent' }), null);
});

test('parseKeyframeBlocks parses selectors and drops unrecognized ones', () => {
  const blocks = parseKeyframeBlocks('0% { opacity: 0; } 50%, 100% { opacity: 1; }');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].offsets, [0]);
  assert.deepEqual(blocks[1].offsets, [50, 100]);
});

// --- finalKeyframeHiddenReason: the flashIn shape (the real defect) ---------

test('finalKeyframeHiddenReason: flashIn ends hidden (opacity 0 at 100%)', () => {
  const flashIn = `
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
    15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  `;
  const result = finalKeyframeHiddenReason(flashIn);
  assert.equal(result.hidden, true);
  assert.equal(result.reason, 'opacity: 0');
  assert.equal(result.finalOffset, 100);
});

// --- finalKeyframeHiddenReason: the safe shapes -----------------------------

test('finalKeyframeHiddenReason: dash ends on a transform (visible), not hidden', () => {
  const dash = `
    from { transform: translateX(0); }
    to { transform: translateX(var(--dash-distance)); }
  `;
  assert.equal(finalKeyframeHiddenReason(dash).hidden, false);
});

test('finalKeyframeHiddenReason: tecmo-slam ends visible (scale 1, opacity 1)', () => {
  const slam = `
    0% { transform: scale(3.2); opacity: 0; }
    60% { opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  `;
  assert.equal(finalKeyframeHiddenReason(slam).hidden, false);
});

test('finalKeyframeHiddenReason: tecmo-fade-in ends visible (opacity 1 at `to`)', () => {
  const fadeIn = `
    from { opacity: 0; }
    to { opacity: 1; }
  `;
  assert.equal(finalKeyframeHiddenReason(fadeIn).hidden, false);
});

test('finalKeyframeHiddenReason: a pulse ending opacity 1 at 100% is not hidden', () => {
  // onClockPulse: opacity 0 appears only at an INTERMEDIATE keyframe (50%), so
  // it must not be treated as a hidden END state.
  const pulse = `
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  `;
  assert.equal(finalKeyframeHiddenReason(pulse).hidden, false);
});

test('finalKeyframeHiddenReason: opacity 0 only at 0% (never at the end) is not hidden', () => {
  const fadeUp = `
    0% { opacity: 0; }
    100% { opacity: 1; }
  `;
  assert.equal(finalKeyframeHiddenReason(fadeUp).hidden, false);
});

test('finalKeyframeHiddenReason: visibility hidden at the final keyframe is hidden', () => {
  const vanish = `
    from { visibility: visible; }
    to { visibility: hidden; }
  `;
  const r = finalKeyframeHiddenReason(vanish);
  assert.equal(r.hidden, true);
  assert.equal(r.reason, 'visibility: hidden');
});

test('finalKeyframeHiddenReason: display none at the final keyframe is hidden', () => {
  const collapse = `
    0% { display: block; }
    100% { display: none; }
  `;
  const r = finalKeyframeHiddenReason(collapse);
  assert.equal(r.hidden, true);
  assert.equal(r.reason, 'display: none');
});

test('finalKeyframeHiddenReason: a comment holding opacity 0 does not count', () => {
  const body = `
    from { opacity: 0; }
    to { /* opacity: 0; */ opacity: 1; }
  `;
  assert.equal(finalKeyframeHiddenReason(body).hidden, false);
});

// ============================================================================
// CSS SCANNER (scanCss): stylesheet keyframes + selector-correlated exemption
// ============================================================================

// Criterion 2: unsafe stylesheet keyframes with a forwards-filled hidden final
// state fail the check.
test('scanCss: a forwards animation naming a hidden-ending @keyframes is flagged', () => {
  const css = `
    @keyframes vanish {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    .callout { animation: vanish 1.8s ease-in-out forwards; }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].selector, '.callout');
  assert.equal(violations[0].animationName, 'vanish');
  assert.equal(violations[0].reason, 'opacity: 0');
});

// Criterion 3 (CSS): hidden final states via visibility and display are covered.
test('scanCss: hidden final state via visibility hidden is flagged', () => {
  const css = `
    @keyframes hide { to { visibility: hidden; } }
    .x { animation: hide 1s forwards; }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'visibility: hidden');
});

test('scanCss: hidden final state via display none is flagged', () => {
  const css = `
    @keyframes collapse { to { display: none; } }
    .x { animation: collapse 1s forwards; }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'display: none');
});

// A keyframes NAME that begins with a hyphen (a legal CSS custom ident) must
// still be caught. A `\b`-anchored regex silently misses it at the start of a
// value (no word boundary before `-`) - a false negative in a guard that must
// not have them; exact ident-token matching has no such corner.
test('scanCss: a hidden-ending keyframes whose name starts with a hyphen is flagged', () => {
  const css = `
    @keyframes -vanish { to { opacity: 0; } }
    .x { animation: -vanish 1s forwards; }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].animationName, '-vanish');
  assert.equal(violations[0].reason, 'opacity: 0');
});

// A forwards animation ending VISIBLE is not flagged (do not ban forwards fill).
test('scanCss: a forwards animation ending on a visible transform is not flagged', () => {
  const css = `
    @keyframes run { from { transform: translateX(0); } to { transform: translateX(560px); } }
    .runner { animation: run 2s steps(20) forwards; }
  `;
  assert.deepEqual(scanCss(css).violations, []);
});

// A hidden-ending keyframes used WITHOUT forwards is not flagged: the element
// reverts to its base (visible) state when the animation ends.
test('scanCss: a hidden-ending keyframes without forwards fill is not flagged', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .x { animation: vanish 1s ease-in-out; }
  `;
  assert.deepEqual(scanCss(css).violations, []);
});

// Longhand: animation-name + animation-fill-mode: forwards is treated the same
// as the shorthand.
test('scanCss: longhand animation-name + animation-fill-mode forwards is flagged', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .x { animation-name: vanish; animation-duration: 1s; animation-fill-mode: forwards; }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].animationName, 'vanish');
});

// THE EXEMPTION, and that it is SELECTOR-correlated, not file-level. A reduce
// block that neutralizes the SAME selector exempts it...
test('scanCss: a reduce block neutralizing the SAME selector exempts the animation', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .callout { animation: vanish 1.8s forwards; }
    @media (prefers-reduced-motion: reduce) {
      .callout { animation: none; }
    }
  `;
  assert.deepEqual(scanCss(css).violations, []);
});

// ...but a reduce block on a DIFFERENT selector does NOT (this is exactly the
// loose file-level rule Cory rejected: the file contains a reduce block, but it
// does not cover the affected surface).
test('scanCss: a reduce block on a DIFFERENT selector does NOT exempt (not file-level)', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .callout { animation: vanish 1.8s forwards; }
    @media (prefers-reduced-motion: reduce) {
      .something-else { animation: none; }
    }
  `;
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].selector, '.callout');
});

// A reduce block that RESTORES the hidden property (opacity: 1) also exempts.
test('scanCss: a reduce block restoring opacity on the same selector exempts', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .callout { animation: vanish 1.8s forwards; }
    @media (prefers-reduced-motion: reduce) {
      .callout { opacity: 1; }
    }
  `;
  assert.deepEqual(scanCss(css).violations, []);
});

// Reduce block covers one of a comma-separated selector list.
test('scanCss: a reduce block covering one selector of a list exempts that rule', () => {
  const css = `
    @keyframes vanish { to { opacity: 0; } }
    .callout { animation: vanish 1.8s forwards; }
    @media (prefers-reduced-motion: reduce) {
      .callout, .other { animation: none !important; }
    }
  `;
  assert.deepEqual(scanCss(css).violations, []);
});

// Resolution boundary: an animation naming a keyframes NOT defined in this file
// is unresolved (declared limit), counted but not flagged.
test('scanCss: a forwards animation naming an unknown (cross-file) keyframes is unresolved, not flagged', () => {
  const css = `.cta { animation: landing-cta-pulse 2.4s forwards; }`;
  const result = scanCss(css);
  assert.deepEqual(result.violations, []);
  assert.equal(result.unresolvedCount, 1);
});

// Criterion 4 (CSS positive control): the real cutscene stylesheet passes AND
// the scan actually examined it (non-zero keyframes + forwards usages).
test('scanCss: the real TecmoCutscene.css has zero violations but is non-empty (positive control)', () => {
  const css = fs.readFileSync(
    path.join(REPO_ROOT, 'src/features/celebrate-touchdown/ui/TecmoCutscene.css'),
    'utf8'
  );
  const result = scanCss(css);
  assert.deepEqual(result.violations, []);
  assert.ok(result.keyframesCount >= 3, `expected >=3 keyframes, got ${result.keyframesCount}`);
  assert.ok(
    result.forwardsUsageCount >= 3,
    `expected >=3 forwards usages examined, got ${result.forwardsUsageCount}`
  );
});

// ============================================================================
// JS/EMOTION SCANNER (scanJs): identifier resolution + structural exemption
// ============================================================================

// Criterion 1: unsafe Emotion keyframes with a forwards-filled hidden final
// state, applied UNGUARDED, fail the check.
test('scanJs: an unguarded forwards animation naming a hidden-ending keyframes is flagged', () => {
  const src = HIDDEN_KF + "const sx = { animation: `${flashIn} 1800ms ease-in-out forwards` };\n";
  const { violations } = scanJs(src);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].animationName, 'flashIn');
  assert.equal(violations[0].reason, 'opacity: 0');
});

// Criterion 5 / exemption (a): the guarded RetroField shape passes - the
// animation is the ALTERNATE of a prefersReducedMotion ternary.
test('scanJs: the guarded ternary shape (prefersReducedMotion ? static : animation) passes', () => {
  const src =
    HIDDEN_KF +
    'const sx = {\n' +
    '  ...(prefersReducedMotion\n' +
    "    ? { transform: 'translate(-50%, -50%)' }\n" +
    '    : { animation: `${flashIn} 1800ms ease-in-out forwards` }),\n' +
    '};\n';
  assert.deepEqual(scanJs(src).violations, []);
});

// Mutation 1 shape: reintroduce the former unconditional animation -> flagged.
test('scanJs: MUTATION 1 - the animation applied unconditionally is flagged', () => {
  const src = HIDDEN_KF + 'const sx = { animation: `${flashIn} 1800ms ease-in-out forwards` };\n';
  assert.equal(scanJs(src).violations.length, 1);
});

// Mutation 2 shape: remove the reduced-motion safety branch -> flagged. The
// four OTHER prefersReducedMotion references in the real file must not rescue
// it: the token appears in the file, but not as this animation's off-ramp.
test('scanJs: MUTATION 2 - safety branch removed, unrelated prefersReducedMotion nearby, still flagged', () => {
  const src =
    HIDDEN_KF +
    'const prefersReducedMotion = usePref();\n' +
    'const dismissed = prefersReducedMotion ? true : false;\n' +
    'const show = !prefersReducedMotion || dismissed;\n' +
    'const sx = { animation: `${flashIn} 1800ms ease-in-out forwards` };\n';
  const { violations } = scanJs(src);
  assert.equal(violations.length, 1, 'unrelated prefersReducedMotion tokens must not exempt it');
});

// Mutation 3 shape (JS): a SAFE keyframes turned hidden, used forwards but
// gated by a NON-reduced-motion condition (dashSide === 'home' && {...}) -> the
// check reads the keyframe and flags it.
test('scanJs: MUTATION 3 - a keyframes changed to end hidden, gated by a non-reduced condition, is flagged', () => {
  const dashHidden = "const dash = keyframes`\n  from { transform: translateX(0); }\n  to { opacity: 0; }\n`;\n";
  const src =
    dashHidden +
    "const sx = { ...(dashSide === 'home' && { animation: `${dash} 0.7s ease-out forwards` }) };\n";
  const { violations } = scanJs(src);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].animationName, 'dash');
  assert.equal(violations[0].reason, 'opacity: 0');
});

// Exemption (a), negated polarity: !prefersReducedMotion ? {animation} : {} ->
// animation runs when reduced motion is OFF -> exempt.
test('scanJs: a negated reduced-motion test with the animation on the consequent is exempt', () => {
  const src =
    HIDDEN_KF +
    'const sx = { ...(!prefersReducedMotion ? { animation: `${flashIn} 1800ms forwards` } : {}) };\n';
  assert.deepEqual(scanJs(src).violations, []);
});

// The WRONG branch must still fail: prefersReducedMotion ? {animation} : {}
// applies the animation UNDER reduced motion - the exact defect.
test('scanJs: the animation on the reduced-motion branch (runs under reduced motion) is flagged', () => {
  const src =
    HIDDEN_KF +
    'const sx = { ...(prefersReducedMotion ? { animation: `${flashIn} 1800ms forwards` } : {}) };\n';
  assert.equal(scanJs(src).violations.length, 1);
});

// A non-reduced-motion condition is not an off-ramp.
test('scanJs: a ternary keyed on a non-reduced-motion condition does not exempt', () => {
  const src =
    HIDDEN_KF +
    'const sx = { ...(isTouchdown ? { animation: `${flashIn} 1800ms forwards` } : {}) };\n';
  assert.equal(scanJs(src).violations.length, 1);
});

// Exemption (b): in-object @media reduce override (the DraftBoardMatrix shape).
test('scanJs: an in-object @media (prefers-reduced-motion: reduce) override exempts', () => {
  const src =
    HIDDEN_KF +
    'const sx = {\n' +
    '  animation: `${flashIn} 1800ms forwards`,\n' +
    "  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },\n" +
    '};\n';
  assert.deepEqual(scanJs(src).violations, []);
});

// Exemption (b) must be MEANINGFUL, not mere presence of an animation key: a
// reduce override that re-asserts a forwards fill neutralizes nothing, so it
// must NOT exempt (the false-negative the spec review caught).
test('scanJs: an in-object reduce override that does NOT neutralize (animationFillMode forwards) is still flagged', () => {
  const src =
    HIDDEN_KF +
    'const sx = {\n' +
    '  animation: `${flashIn} 1800ms forwards`,\n' +
    "  '@media (prefers-reduced-motion: reduce)': { animationFillMode: 'forwards' },\n" +
    '};\n';
  assert.equal(scanJs(src).violations.length, 1);
});

// ...while a reduce override that restores opacity does neutralize, so it exempts.
test('scanJs: an in-object reduce override restoring opacity exempts', () => {
  const src =
    HIDDEN_KF +
    'const sx = {\n' +
    '  animation: `${flashIn} 1800ms forwards`,\n' +
    "  '@media (prefers-reduced-motion: reduce)': { opacity: 1 },\n" +
    '};\n';
  assert.deepEqual(scanJs(src).violations, []);
});

// A forwards animation ending VISIBLE is not flagged (dash shape).
test('scanJs: a forwards animation naming a visible-ending keyframes is not flagged', () => {
  const src = VISIBLE_KF + 'const sx = { animation: `${dash} 0.7s ease-out forwards` };\n';
  const result = scanJs(src);
  assert.deepEqual(result.violations, []);
  assert.equal(result.forwardsUsageCount, 1);
});

// A hidden-ending keyframes used WITHOUT forwards is not flagged.
test('scanJs: a hidden-ending keyframes used without forwards fill is not flagged', () => {
  const src = HIDDEN_KF + 'const sx = { animation: `${flashIn} 1800ms ease-in-out` };\n';
  assert.deepEqual(scanJs(src).violations, []);
});

// Resolution boundary: an IMPORTED (not same-file) keyframes is unresolved and
// not flagged - the declared v1 false-negative, counted so it is visible.
test('scanJs: an imported keyframes used forwards is unresolved (declared boundary), not flagged', () => {
  const src =
    "import { fadeOut } from './shared';\n" +
    'const sx = { animation: `${fadeOut} 1s forwards` };\n';
  const result = scanJs(src);
  assert.deepEqual(result.violations, []);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.keyframesCount, 0);
});

// Criterion 5 (positive control): the real RetroField.jsx (the retro-scoreboard
// widget's field since #903; the legacy page's copy left the tree with it)
// passes AND the scan examined it - flashIn (hidden, but guarded) and dash
// (visible) both resolved. The widget's field applies `dash` from ONE sprite
// component used twice, so the source carries one dash usage plus flashIn.
test('scanJs: the real RetroField.jsx has zero violations but is non-empty (positive control)', () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'src/widgets/retro-scoreboard/ui/RetroField.jsx'),
    'utf8'
  );
  const result = scanJs(src);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.violations, []);
  assert.ok(result.keyframesCount >= 2, `expected >=2 keyframes (dash, flashIn), got ${result.keyframesCount}`);
  assert.ok(
    result.forwardsUsageCount >= 2,
    `expected >=2 forwards usages examined (1 dash + 1 flashIn), got ${result.forwardsUsageCount}`
  );
});

// ============================================================================
// DELIBERATELY-UNSAFE FIXTURE: the standing proof the check still fires when
// the real tree is clean (pl-endzone's condition on #542). The fixtures live
// under tests/fixtures/, outside every scan path, and are read explicitly here.
// ============================================================================

const FIXTURE_DIR = 'tests/fixtures/animation-safety';

test('fixture: the unsafe CSS fixture IS flagged by scanCss with the reason', () => {
  const css = fs.readFileSync(path.join(REPO_ROOT, FIXTURE_DIR, 'unsafe.css'), 'utf8');
  const { violations } = scanCss(css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].selector, '.fixture-callout');
  assert.equal(violations[0].animationName, 'fixture-vanish');
  assert.equal(violations[0].reason, 'opacity: 0');
});

test('fixture: the unsafe JS fixture IS flagged by scanJs with the reason', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, FIXTURE_DIR, 'unsafe.jsx'), 'utf8');
  const { violations } = scanJs(js);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].animationName, 'fixtureFlashOut');
  assert.equal(violations[0].reason, 'opacity: 0');
});

// End-to-end: the WHOLE walker (not just the pure scanners) finds both planted
// violations when pointed at the fixture directory. This proves the glob, the
// file routing, and the aggregation are load-bearing - the exact things a clean
// tree cannot exercise.
test('fixture: findViolations pointed at the fixture dir finds both planted violations', () => {
  const { violations, stats } = findViolations({ roots: [FIXTURE_DIR] });
  assert.equal(violations.length, 2, formatEach(violations));
  const byName = violations.map((v) => v.animationName).sort();
  assert.deepEqual(byName, ['fixture-vanish', 'fixtureFlashOut']);
  assert.equal(stats.parseErrors, 0);
  // Every violation formats to a clear, single line naming declaration + reason.
  for (const v of violations) {
    const line = formatViolation(v);
    assert.match(line, /animation-safety/);
    assert.match(line, /opacity: 0/);
  }
});

function formatEach(violations) {
  return '\n' + violations.map(formatViolation).join('\n') + '\n';
}

// ============================================================================
// THE GUARD ITSELF: the real app tree must carry no unsafe animation, AND the
// scan must be shown to have actually looked (non-zero examined counts, zero
// parse errors). The console line below is the guard's own output in a real
// `npm run guards` run - the artefact that proves the check examined something.
// ============================================================================

test('the real app tree (src/) carries no unsafe forwards-hidden animation', () => {
  const { violations, stats } = findViolations();

  // The guard's own output line: a non-zero examined count is the artefact that
  // proves the scan looked at real code rather than silently finding nothing.
  console.log(
    `[animation-safety] scanned ${stats.filesScanned} files, examined ${stats.keyframes} ` +
      `keyframes and ${stats.forwardsUsages} forwards-filled animation declarations ` +
      `(${stats.unresolved} unresolved, ${stats.parseErrors} parse errors); ` +
      `${violations.length} violation(s).`
  );

  // Positive control: the enumeration that returns zero must also be shown to
  // find the known safe cases (dash, flashIn, the three tecmo animations), or a
  // zero result is indistinguishable from a scan that looked at nothing.
  assert.ok(stats.keyframes > 0, 'expected the scan to examine at least one keyframes definition');
  assert.ok(
    stats.forwardsUsages > 0,
    'expected the scan to examine at least one forwards-filled animation'
  );
  assert.equal(
    stats.parseErrors,
    0,
    'every scanned JS file must parse; a parse error means the guard silently skipped a file'
  );

  assert.deepEqual(
    violations.map(formatViolation),
    [],
    violations.length > 0
      ? '\nForwards-filled animations that end hidden are permanently hidden under ' +
          'reduced motion (the global 0s policy in src/theme/base.css does not reset ' +
          'animation-fill-mode). Give the affected declaration or surface a real ' +
          'reduced-motion alternative (a prefersReducedMotion off-ramp, or a @media ' +
          '(prefers-reduced-motion: reduce) override on the same selector), end the ' +
          'animation on a visible keyframe, or drop forwards fill. See issue #542.\n'
      : undefined
  );
});

test('the animation-safety allowlist is empty at merge', () => {
  assert.deepEqual(
    ALLOWLIST,
    [],
    'ALLOWLIST is expected to be empty; every entry needs a reason a reader can check'
  );
});
