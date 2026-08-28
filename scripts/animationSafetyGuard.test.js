'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDeclarations,
  hiddenReasonFromDecls,
  offsetForToken,
  parseKeyframeBlocks,
  finalKeyframeHiddenReason,
} = require('./animationSafetyGuard');

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
