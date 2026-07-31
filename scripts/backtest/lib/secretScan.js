'use strict';

/**
 * Value-level secret/contact scan for the Gate-3 publication packager.
 *
 * The closed-schema guard (`schemaGuard.js`) proves every KEY and every
 * value's TYPE is one the sealed allowlist names. It says nothing about the
 * CONTENT of a string value - a `varchar` column or a free-text field inside
 * a JSONB blob could carry a credential, an email address, or a local
 * filesystem path just as easily as it carries a stat line, and the schema
 * guard would not notice because none of that is a shape violation.
 *
 * This module is the second, independent net: every STRING value reached
 * during packaging (recursively, through every nested object and array) is
 * tested against a fixed set of patterns. Only strings are scanned - numbers,
 * booleans and nulls cannot carry a secret shape, and scanning them would
 * only invite false positives from an unlucky numeric coincidence.
 *
 * A hit is recorded as `{ dataset, rowIndex, path, pattern }` and NEVER
 * carries the matched substring or the full value: the location is what a
 * reviewer needs to go look at the row directly (with proper access), and
 * echoing the match back into a log or a report would defeat the entire
 * purpose of scanning for one in the first place.
 *
 * No fs, no server/services, no process.env - pure pattern matching.
 */

/**
 * Patterns named exactly as the user's review specified, at minimum.
 * Each entry's `re` is tested against a single string value in isolation.
 */
const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ name: 'postgres-connection-url', re: /postgres(?:ql)?:\/\// }),
  Object.freeze({ name: 'password-literal', re: /password/i }),
  // Real JWTs are near-universally base64url(JSON header).base64url(payload)
  // .base64url(signature); the header segment for every common `alg`/`typ`
  // pair base64url-encodes to a prefix starting `eyJ` (the encoding of
  // `{"`). Anchoring on that prefix keeps this pattern from firing on an
  // unrelated three-segment dotted string (a version number, a compound stat
  // key) while still catching the shape the review named.
  Object.freeze({ name: 'jwt-shaped', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/ }),
  Object.freeze({ name: 'email-address', re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i }),
  // Separated 10-digit US-shaped phone numbers only (a dash/dot/space
  // separator or a leading country code is required): a bare run of 10
  // digits with no separator is indistinguishable from an ordinary numeric
  // identifier and scanning for it would produce nothing but false alarms
  // against a sports-stats dataset.
  Object.freeze({
    name: 'phone-number-shape',
    re: /(?:\+\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
  }),
  // ANY drive-letter path (not only C:\Users\...): D:\secrets\..., a bare
  // C:\ProgramData\... service-account profile, etc. all carry the same risk
  // of naming a real local machine/account, so the pattern is the drive
  // letter + colon + one literal backslash, with no further path segment
  // required. A UNC path (\\server\share\...) has no drive letter at all, so
  // it needs its own alternative: two leading literal backslashes, then a
  // host/share segment, then a separator into whatever follows.
  Object.freeze({ name: 'windows-local-path', re: /[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+/ }),
  Object.freeze({ name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ }),
]);

/**
 * Pure: every pattern name that matches `value`, in `SECRET_PATTERNS` order.
 * Non-string values never match anything.
 */
function matchingPatterns(value) {
  if (typeof value !== 'string') return [];
  return SECRET_PATTERNS.filter((p) => p.re.test(value)).map((p) => p.name);
}

/**
 * Recursively scan one value, appending `{ path, pattern }` hits (dataset and
 * rowIndex are added by the caller, once, at the top of the recursion).
 */
function scanValue(value, path, hits) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const pattern of matchingPatterns(value)) hits.push({ path, pattern });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => scanValue(entry, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) scanValue(value[key], `${path}.${key}`, hits);
  }
  // numbers and booleans: nothing to scan
}

/**
 * Scan every row of a dataset. Returns an array of hits, each
 * `{ dataset, rowIndex, path, pattern }` - a location, never a value.
 */
function scanRowsForSecrets(rows, datasetName) {
  if (!Array.isArray(rows)) throw new Error('scanRowsForSecrets requires an array of rows');
  const hits = [];
  rows.forEach((row, rowIndex) => {
    const rowHits = [];
    scanValue(row, '$', rowHits);
    for (const hit of rowHits) hits.push({ dataset: datasetName, rowIndex, ...hit });
  });
  return hits;
}

/**
 * Fail loud (fail closed) on any hit. The error names the dataset, the
 * count, and up to five `dataset/rowIndex/path/pattern` locations - never a
 * matched value, per the user's binding requirement.
 */
function assertNoSecrets(rows, datasetName) {
  const hits = scanRowsForSecrets(rows, datasetName);
  if (hits.length === 0) return { dataset: datasetName, hits: 0 };
  const sample = hits.slice(0, 5)
    .map((h) => `${h.dataset}[${h.rowIndex}].${h.path} (${h.pattern})`)
    .join('; ');
  throw new Error(
    `secret scan: ${hits.length} hit(s) in dataset ${datasetName} - refusing to package. ` +
    `Locations (values withheld): ${sample}${hits.length > 5 ? `, and ${hits.length - 5} more` : ''}`
  );
}

/**
 * Scan one blob of raw TEXT directly (no row/object structure - no parsing
 * of any kind), for a file that is copied verbatim rather than loaded as
 * rows: `dry-run-receipt.json` is JSON, but scanning it as JSON would mean
 * trusting it to parse, and the whole point of this second net is to not
 * depend on the first one. `matchingPatterns` already does a substring
 * search (no `^`/`$` anchors), so it works unchanged against a whole file's
 * text, not only a single field's value.
 */
function assertNoSecretsInText(text, label) {
  if (typeof text !== 'string') throw new Error('assertNoSecretsInText requires a string');
  const patterns = matchingPatterns(text);
  if (patterns.length === 0) return { label, hits: 0 };
  throw new Error(
    `secret scan: ${patterns.length} pattern(s) matched in ${label} - refusing to copy it. ` +
    `Patterns (values withheld): ${patterns.join(', ')}`
  );
}

module.exports = {
  SECRET_PATTERNS,
  matchingPatterns,
  scanValue,
  scanRowsForSecrets,
  assertNoSecrets,
  assertNoSecretsInText,
};
