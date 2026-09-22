const test = require('node:test');
const assert = require('node:assert/strict');
const { isPresentNumber } = require('../services/numericPresence');

// #1555: the predicate family (`isNum` / `isRealNumber` in decisionCardContext,
// espnOdds, nwsWeather, projectionFeatures, projectionModel, vegasOdds) shares
// this one body now. `Number(' ')`, `Number('\t')` and `Number([])` are all
// `0`, so without a trim-or-equivalent emptiness test a value that carries no
// measurement reads as a real, present zero.

test('isPresentNumber rejects null, undefined, and booleans', () => {
  assert.equal(isPresentNumber(null), false);
  assert.equal(isPresentNumber(undefined), false);
  assert.equal(isPresentNumber(true), false);
  assert.equal(isPresentNumber(false), false);
});

test('isPresentNumber rejects an empty string', () => {
  assert.equal(isPresentNumber(''), false);
});

test('isPresentNumber rejects a whitespace-only string', () => {
  assert.equal(isPresentNumber(' '), false);
  assert.equal(isPresentNumber('\t'), false);
});

test('isPresentNumber rejects an empty array (Number([]) is 0)', () => {
  assert.equal(isPresentNumber([]), false);
});

test('isPresentNumber rejects a non-numeric string and NaN', () => {
  assert.equal(isPresentNumber('abc'), false);
  assert.equal(isPresentNumber(NaN), false);
});

test('isPresentNumber accepts a real 0, including as a string', () => {
  assert.equal(isPresentNumber(0), true);
  assert.equal(isPresentNumber('0'), true);
});

test('isPresentNumber accepts negative and decimal numbers', () => {
  assert.equal(isPresentNumber(-1.5), true);
});

test('isPresentNumber accepts a numeric string with surrounding whitespace', () => {
  assert.equal(isPresentNumber(' 7 '), true);
});

test('isPresentNumber accepts exponential notation', () => {
  assert.equal(isPresentNumber('1e3'), true);
});
