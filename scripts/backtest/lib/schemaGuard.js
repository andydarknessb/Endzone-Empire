'use strict';

/**
 * Generic closed-schema validator for the Gate-3 publication packager.
 *
 * A schema here is a small tagged tree, never inherited or inferred from the
 * data it validates - every allowed key is named in `publicationSchema.js`,
 * by hand, once:
 *
 *   { kind: 'null' }
 *   { kind: 'string' }
 *   { kind: 'number' }                 // finite JS number
 *   { kind: 'boolean' }
 *   { kind: 'numeric-string' }         // PG numeric/bigint columns arrive as
 *                                       // strings through the driver; this
 *                                       // is a string shaped like one
 *   { kind: 'object', mode, fields }   // mode: 'exact' | 'subset'
 *   { kind: 'array', items }
 *   { oneOf: [spec, spec, ...] }       // a union - e.g. "string or null"
 *
 * Object modes are the one thing this validator is not naive about:
 *
 *   - 'exact': every key in `fields` MUST be present and every present key
 *     MUST be declared. This is the shape of every row this snapshot ever
 *     captures at the TOP level (`players`, `player_stats`'s outer envelope,
 *     the oracle `projection` object, ...) - each comes from a fixed SQL
 *     column list or a fixed piece of application code, so the key set is
 *     genuinely constant, and a row missing a declared key is exactly as
 *     wrong as a row carrying an extra one.
 *   - 'subset': every PRESENT key must be declared and correctly typed, but
 *     a declared key may be ABSENT. This is the true shape of a JSONB stat
 *     blob (`player_stats.stats`): a kicker's row simply has no
 *     `receivingYards` key, and requiring one would reject the entire
 *     dataset, not catch an anomaly. `subset` still rejects the thing a
 *     closed schema exists to catch - a key nobody declared.
 *
 * Both modes reject an unexpected key identically: there is no such thing as
 * an allowlist that "some keys are extra-fine to add", by design.
 *
 * Pure: no fs, no server/services, no process.env, matching the rest of
 * `scripts/backtest/`.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;

/**
 * Validate one value against one schema node. Throws with a path-qualified
 * message on the FIRST violation - fail closed, abort the run, per the
 * user's binding requirement. `path` is a JS-like accessor string
 * (`$.stats.passingYards`) built up by the caller as it recurses.
 */
function validateValue(value, spec, path) {
  if (!spec || typeof spec !== 'object') {
    throw new Error(`${path}: schema definition itself is malformed (${JSON.stringify(spec)})`);
  }
  if (Array.isArray(spec.oneOf)) {
    if (spec.oneOf.length === 0) throw new Error(`${path}: schema oneOf must not be empty`);
    const errors = [];
    for (const branch of spec.oneOf) {
      try {
        validateValue(value, branch, path);
        return;
      } catch (err) {
        errors.push(err.message);
      }
    }
    // Every branch's own failure is folded into the message (not just a
    // generic "no match"): a union like [null, {object...}] failing on an
    // UNEXPECTED KEY inside the object branch should say so, not just report
    // that oneOf as a whole could not place the value.
    throw new Error(
      `${path}: value (type ${typeOf(value)}) matched none of ${spec.oneOf.length} allowed shape(s) ` +
      `(attempts: ${errors.join(' | ')})`
    );
  }

  switch (spec.kind) {
    case 'null':
      if (value !== null) throw new Error(`${path}: expected null, got ${typeOf(value)}`);
      return;
    case 'string':
      if (typeof value !== 'string') throw new Error(`${path}: expected string, got ${typeOf(value)}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${path}: expected boolean, got ${typeOf(value)}`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${path}: expected a finite number, got ${typeOf(value)}`);
      }
      return;
    case 'numeric-string':
      if (typeof value !== 'string' || !NUMERIC_STRING.test(value)) {
        throw new Error(`${path}: expected a numeric string, got ${typeOf(value)}`);
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) throw new Error(`${path}: expected array, got ${typeOf(value)}`);
      if (!spec.items) throw new Error(`${path}: schema declares an array with no item spec`);
      value.forEach((item, i) => validateValue(item, spec.items, `${path}[${i}]`));
      return;
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path}: expected object, got ${typeOf(value)}`);
      }
      const mode = spec.mode || 'exact';
      if (mode !== 'exact' && mode !== 'subset') {
        throw new Error(`${path}: schema declares unknown object mode ${JSON.stringify(mode)}`);
      }
      const fields = spec.fields || {};
      const declaredKeys = Object.keys(fields);
      const actualKeys = Object.keys(value);
      const unexpected = actualKeys.filter((k) => !Object.prototype.hasOwnProperty.call(fields, k));
      if (unexpected.length > 0) {
        throw new Error(`${path}: unexpected key(s) not on the closed allowlist: ${unexpected.join(', ')}`);
      }
      if (mode === 'exact') {
        const missing = declaredKeys.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
        if (missing.length > 0) {
          throw new Error(`${path}: missing declared key(s): ${missing.join(', ')}`);
        }
      }
      for (const key of actualKeys) {
        validateValue(value[key], fields[key], `${path}.${key}`);
      }
      return;
    }
    default:
      throw new Error(`${path}: schema declares unknown kind ${JSON.stringify(spec.kind)}`);
  }
}

/**
 * Validate every row of a dataset against its top-level row schema. Throws
 * on the first violation, naming the dataset and row index (never the
 * value).
 */
function assertClosedSchema(rows, schema, datasetName) {
  if (!Array.isArray(rows)) throw new Error('assertClosedSchema requires an array of rows');
  if (!schema) throw new Error(`assertClosedSchema: no schema registered for dataset ${datasetName}`);
  rows.forEach((row, i) => {
    try {
      validateValue(row, schema, '$');
    } catch (err) {
      throw new Error(`closed-schema violation in dataset ${datasetName}, row ${i}: ${err.message}`);
    }
  });
  return { dataset: datasetName, rows: rows.length, ok: true };
}

/**
 * Every key name a schema node declares, at every depth - used only for the
 * static external_id self-check in `publicationSchema.js` (never for
 * validating row data, which goes through `assertClosedSchema` above).
 */
function collectDeclaredKeys(spec, out = new Set()) {
  if (!spec || typeof spec !== 'object') return out;
  if (Array.isArray(spec.oneOf)) {
    for (const branch of spec.oneOf) collectDeclaredKeys(branch, out);
    return out;
  }
  if (spec.kind === 'object') {
    const fields = spec.fields || {};
    for (const [key, child] of Object.entries(fields)) {
      out.add(key);
      collectDeclaredKeys(child, out);
    }
  } else if (spec.kind === 'array' && spec.items) {
    collectDeclaredKeys(spec.items, out);
  }
  return out;
}

module.exports = {
  validateValue,
  assertClosedSchema,
  collectDeclaredKeys,
  typeOf,
  NUMERIC_STRING,
};
