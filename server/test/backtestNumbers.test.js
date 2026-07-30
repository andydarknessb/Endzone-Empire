const test = require('node:test');
const assert = require('node:assert/strict');

const numbers = require('../../scripts/backtest/lib/numbers');

/**
 * The predicate that exists because `Number(null) === 0` bit this harness three
 * times in three modules, each time turning MISSING EVIDENCE into a MEASURED
 * ZERO - and in this domain zero is a real finding, so the two must never be
 * confusable.
 */

test('every shape that Number() would silently turn into a number is MISSING', () => {
  // THE HAZARD: each of these coerces to a FINITE NUMBER, and none of them is
  // one. `Number(null)` is 0, `Number('')` is 0, `Number('  ')` is 0,
  // `Number([])` is 0, `Number(true)` is 1.
  for (const value of [null, '', '   ', '\t', '\n  \t ', [], true, false]) {
    assert.equal(numbers.isMissing(value), true, `${JSON.stringify(value)} is missing`);
    assert.equal(Number.isFinite(Number(value)), true,
      `${JSON.stringify(value)} coerces to a finite number, which is exactly the hazard`);
  }
  // `undefined` is the one absent value JavaScript already refuses to coerce
  // (`Number(undefined)` is NaN), so a bare finite check happens to catch it.
  // It is still missing, and treating it the same way keeps the rule one rule.
  assert.equal(numbers.isMissing(undefined), true);
  assert.equal(Number.isNaN(Number(undefined)), true);
  // Real numbers - including zero - are never missing.
  for (const value of [0, '0', -3, '5', 1.5, '1.5', '  7  ']) {
    assert.equal(numbers.isMissing(value), false, `${JSON.stringify(value)} is present`);
  }
  // Junk is present-but-unparseable, which is a different failure.
  assert.equal(numbers.isMissing('TBD'), false);
  assert.equal(numbers.isMissing({}), false);
});

test('requiredNumber distinguishes MISSING from NOT-A-NUMBER, because the fixes differ', () => {
  assert.equal(numbers.requiredNumber(0), 0, 'a real zero is a real measurement');
  assert.equal(numbers.requiredNumber('12.5'), 12.5);
  assert.equal(numbers.requiredNumber(-3), -3);

  // Missing: the message says so, and says why a blank cannot become 0.
  for (const value of [null, undefined, '', '  ', true]) {
    assert.throws(() => numbers.requiredNumber(value, { label: 'pointsAllowed' }),
      /pointsAllowed is .*, which is missing rather than zero.*zero is a real measurement/s,
      `${JSON.stringify(value)} is refused as missing`);
  }
  // Present but unparseable: a different message.
  assert.throws(() => numbers.requiredNumber('TBD', { label: 'pointsAllowed' }),
    /pointsAllowed is "TBD", which is not a finite number/);
  assert.throws(() => numbers.requiredNumber(Number.NaN), /not a finite number/);
  assert.throws(() => numbers.requiredNumber(Infinity), /not a finite number/);
  // The context rider names the row an operator has to go and look at.
  assert.throws(() => numbers.requiredNumber(null, { label: 'score', context: 'game 2025_03' }),
    /score \(game 2025_03\) is null/);
});

test('optionalNumber yields null for missing and never zero', () => {
  for (const value of [null, undefined, '', '   ', true]) {
    assert.equal(numbers.optionalNumber(value), null, `${JSON.stringify(value)} stays missing`);
  }
  assert.equal(numbers.optionalNumber(0), 0, 'a stored zero IS a measurement and survives');
  assert.equal(numbers.optionalNumber('42'), 42);
  assert.throws(() => numbers.optionalNumber('TBD', { label: 'yards' }),
    /yards is "TBD", which is not a finite number/);
});

test('countingNumber is the ONE place a zero-default is correct, and it is named', () => {
  // "No sacks recorded" really is no sacks.
  for (const value of [null, undefined, '', '  ']) {
    assert.equal(numbers.countingNumber(value), 0);
  }
  assert.equal(numbers.countingNumber(3), 3);
  assert.equal(numbers.countingNumber('2'), 2);
  // Junk is still junk, even here.
  assert.throws(() => numbers.countingNumber('lots', { label: 'defSacks' }),
    /defSacks is "lots", which is not a finite number/);
});

test('isFiniteNumber is the predicate form, and rejects everything isMissing does', () => {
  for (const value of [null, undefined, '', '  ', '\t', [], true, false, 'TBD', {}, NaN, Infinity]) {
    assert.equal(numbers.isFiniteNumber(value), false, `${JSON.stringify(value)} is not usable`);
  }
  for (const value of [0, -1, '0', '3.5', 42]) {
    assert.equal(numbers.isFiniteNumber(value), true);
  }
});

test('the tie precision is the preregistered 10 decimal places', () => {
  assert.equal(numbers.TIE_DECIMALS, 10);
  // A float artifact is not a difference.
  assert.equal(numbers.tiesWith(0.1 + 0.2, 0.3), true);
  assert.equal(numbers.roundToTie(0.1 + 0.2), 0.3);
  // A real difference at the tenth decimal still is one.
  assert.equal(numbers.tiesWith(5, 5.000000001), false);
  assert.equal(numbers.tiesWith(5, 5.00000000001), true, 'beyond ten places is a tie');
});

/**
 * The MIGRATION's one deliberate semantic change, pinned so it is a decision
 * rather than an accident.
 *
 * Three call sites previously used an empty-string-only rejection
 * (`v === '' || v === null || ...`), which let a WHITESPACE-ONLY string, an
 * empty array, and a boolean through to `Number()` - where they became 0 (or 1
 * for `true`). The unified predicate rejects all of them.
 *
 * At every one of those sites the value is already numeric by construction -
 * scoring output, `generateProjections` output, or a jsonb usage count - so no
 * reachable input changes. The direction is uniformly safer: the values that
 * now get rejected are exactly the ones that used to become a silent zero.
 */
test('the unified predicate rejects the shapes the old per-site checks let through', () => {
  const oldEmptyStringOnly = (v) => v === null || v === undefined || v === ''
    || typeof v === 'boolean' || !Number.isFinite(Number(v));
  const oldUsageBearing = (v) => v !== null && v !== undefined && v !== ''
    && Number.isFinite(Number(v));

  for (const sneaky of ['   ', '\t', []]) {
    assert.equal(oldEmptyStringOnly(sneaky), false,
      `the old check accepted ${JSON.stringify(sneaky)} and turned it into ${Number(sneaky)}`);
    assert.equal(numbers.isFiniteNumber(sneaky), false, 'the unified predicate rejects it');
  }
  for (const sneaky of ['   ', '\t', [], true, false]) {
    assert.equal(oldUsageBearing(sneaky), true,
      `the old usage check counted ${JSON.stringify(sneaky)} as a usage-bearing game`);
    assert.equal(numbers.isFiniteNumber(sneaky), false);
  }
  // And it changes nothing for every shape that actually reaches these sites.
  for (const real of [0, -1, 3.5, '0', '12', null, undefined]) {
    assert.equal(oldEmptyStringOnly(real), !numbers.isFiniteNumber(real),
      `${JSON.stringify(real)} is treated identically`);
  }
});
