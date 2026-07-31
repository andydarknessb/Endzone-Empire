const test = require('node:test');
const assert = require('node:assert/strict');

const { validateValue, assertClosedSchema, collectDeclaredKeys } = require('../../scripts/backtest/lib/schemaGuard');

const STRING = { kind: 'string' };
const NUMBER = { kind: 'number' };
const BOOLEAN = { kind: 'boolean' };
const NULL = { kind: 'null' };
const NUMERIC_STRING = { kind: 'numeric-string' };
const NULLABLE_NUMBER = { oneOf: [NULL, NUMBER] };

test('primitive kinds accept their own type and reject every other observed type', () => {
  assert.doesNotThrow(() => validateValue('x', STRING, '$'));
  assert.throws(() => validateValue(1, STRING, '$'), /expected string, got number/);
  assert.doesNotThrow(() => validateValue(1, NUMBER, '$'));
  assert.throws(() => validateValue('1', NUMBER, '$'), /expected a finite number, got string/);
  assert.throws(() => validateValue(NaN, NUMBER, '$'), /expected a finite number/);
  assert.throws(() => validateValue(Infinity, NUMBER, '$'), /expected a finite number/);
  assert.doesNotThrow(() => validateValue(true, BOOLEAN, '$'));
  assert.throws(() => validateValue(0, BOOLEAN, '$'), /expected boolean, got number/);
  assert.doesNotThrow(() => validateValue(null, NULL, '$'));
  assert.throws(() => validateValue(undefined, NULL, '$'), /expected null, got undefined/);
  assert.doesNotThrow(() => validateValue('42', NUMERIC_STRING, '$'));
  assert.doesNotThrow(() => validateValue('-3.5', NUMERIC_STRING, '$'));
  assert.throws(() => validateValue('abc', NUMERIC_STRING, '$'), /expected a numeric string/);
  assert.throws(() => validateValue(42, NUMERIC_STRING, '$'), /expected a numeric string, got number/);
});

test('oneOf accepts any matching branch and reports failure only when none match', () => {
  assert.doesNotThrow(() => validateValue(null, NULLABLE_NUMBER, '$'));
  assert.doesNotThrow(() => validateValue(3, NULLABLE_NUMBER, '$'));
  assert.throws(() => validateValue('3', NULLABLE_NUMBER, '$'), /matched none of 2 allowed shape/);
  assert.throws(() => validateValue(1, { oneOf: [] }, '$'), /oneOf must not be empty/);
});

test('array validation applies the item spec to every element and reports the failing index', () => {
  const arraySpec = { kind: 'array', items: NUMBER };
  assert.doesNotThrow(() => validateValue([1, 2, 3], arraySpec, '$'));
  assert.doesNotThrow(() => validateValue([], arraySpec, '$'));
  assert.throws(() => validateValue([1, 'x', 3], arraySpec, '$'), /\$\[1\]: expected a finite number/);
  assert.throws(() => validateValue('not array', arraySpec, '$'), /expected array, got string/);
  assert.throws(() => validateValue([1], { kind: 'array' }, '$'), /no item spec/);
});

test('object mode "exact" requires every declared key present and rejects any extra key', () => {
  const spec = { kind: 'object', mode: 'exact', fields: { a: NUMBER, b: STRING } };
  assert.doesNotThrow(() => validateValue({ a: 1, b: 'x' }, spec, '$'));
  assert.throws(() => validateValue({ a: 1 }, spec, '$'), /missing declared key\(s\): b/);
  assert.throws(() => validateValue({ a: 1, b: 'x', c: 1 }, spec, '$'),
    /unexpected key\(s\) not on the closed allowlist: c/);
});

test('object mode "subset" allows a declared key to be absent but still rejects an undeclared one', () => {
  const spec = { kind: 'object', mode: 'subset', fields: { a: NUMBER, b: STRING } };
  assert.doesNotThrow(() => validateValue({}, spec, '$'), 'every declared key may be absent');
  assert.doesNotThrow(() => validateValue({ a: 1 }, spec, '$'));
  assert.throws(() => validateValue({ a: 1, c: 1 }, spec, '$'),
    /unexpected key\(s\) not on the closed allowlist: c/);
});

test('an unknown object mode is refused rather than silently defaulting', () => {
  const spec = { kind: 'object', mode: 'wildcard', fields: {} };
  assert.throws(() => validateValue({}, spec, '$'), /unknown object mode "wildcard"/);
});

test('object validation rejects a non-object value, including an array and null', () => {
  const spec = { kind: 'object', mode: 'exact', fields: { a: NUMBER } };
  assert.throws(() => validateValue(null, spec, '$'), /expected object, got null/);
  assert.throws(() => validateValue([1], spec, '$'), /expected object, got array/);
  assert.throws(() => validateValue('x', spec, '$'), /expected object, got string/);
});

test('nested object/array shapes are validated recursively, with a path that names the exact location', () => {
  const spec = {
    kind: 'object',
    mode: 'exact',
    fields: {
      factors: {
        kind: 'object', mode: 'exact', fields: { weather: { oneOf: [NULL, { kind: 'object', mode: 'subset', fields: { effect: NUMBER } }] } },
      },
    },
  };
  assert.doesNotThrow(() => validateValue({ factors: { weather: null } }, spec, '$'));
  assert.doesNotThrow(() => validateValue({ factors: { weather: { effect: 1 } } }, spec, '$'));
  assert.throws(
    () => validateValue({ factors: { weather: { effect: 1, extra: true } } }, spec, '$'),
    /\$\.factors\.weather: unexpected key\(s\) not on the closed allowlist: extra/
  );
});

test('an unknown schema kind is refused', () => {
  assert.throws(() => validateValue(1, { kind: 'mystery' }, '$'), /unknown kind "mystery"/);
  assert.throws(() => validateValue(1, null, '$'), /schema definition itself is malformed/);
});

test('assertClosedSchema validates every row and names the row index and dataset on the first violation', () => {
  const spec = { kind: 'object', mode: 'exact', fields: { id: NUMBER } };
  const result = assertClosedSchema([{ id: 1 }, { id: 2 }], spec, 'ds');
  assert.deepEqual(result, { dataset: 'ds', rows: 2, ok: true });
  assert.throws(
    () => assertClosedSchema([{ id: 1 }, { id: 2, extra: true }], spec, 'ds'),
    /closed-schema violation in dataset ds, row 1: \$: unexpected key\(s\) not on the closed allowlist: extra/
  );
});

test('assertClosedSchema requires an array and a registered schema', () => {
  assert.throws(() => assertClosedSchema('nope', {}, 'ds'), /requires an array of rows/);
  assert.throws(() => assertClosedSchema([], null, 'ds'), /no schema registered for dataset ds/);
});

test('collectDeclaredKeys walks every nesting level, including inside oneOf and array items', () => {
  const spec = {
    kind: 'object',
    mode: 'exact',
    fields: {
      a: NUMBER,
      b: { oneOf: [NULL, { kind: 'object', mode: 'subset', fields: { c: STRING } }] },
      d: { kind: 'array', items: { kind: 'object', mode: 'exact', fields: { e: NUMBER } } },
    },
  };
  const keys = collectDeclaredKeys(spec);
  assert.deepEqual([...keys].sort(), ['a', 'b', 'c', 'd', 'e']);
});
