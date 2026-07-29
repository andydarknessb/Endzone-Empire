'use strict';

/**
 * Minimal, dependency-free CSV reader for the reconstructed-historical-backtest
 * tooling.
 *
 * This DELIBERATELY does not reuse `server/services/nflverseSync.service.js`'s
 * `parseCsv`, even though the two agree on RFC4180 semantics: that module
 * requires `server/modules/pool` at load, which constructs a pg.Pool out of
 * process.env at module-evaluation time. Phase 0 tooling is network-only and
 * must be structurally incapable of reaching a database, so it carries its own
 * parser instead. The two are held in agreement by test, not by sharing code.
 *
 * Fail-loud choices, all of which the pinned nflverse files satisfy today and
 * any of which failing means the file is not what the pin says it is:
 *   - a record whose field count differs from the header's is an error, not a
 *     row padded with undefined (a silently short row would quietly become a
 *     null feature later);
 *   - an unterminated quoted field is an error;
 *   - a file with no header line is an error;
 *   - a quoted field must END the field: `"abc"def` is an error rather than
 *     the silent concatenation `abcdef` that a permissive parser produces.
 *     RFC4180 has no such form, so encountering one means the bytes are not
 *     the CSV they claim to be, and quietly inventing a value for it is
 *     exactly the kind of silent repair this harness exists to eliminate.
 *
 * Embedded newlines inside quoted fields ARE supported (unlike the service's
 * split-on-newline shortcut) so that a future source revision which introduces
 * one is parsed correctly rather than silently mangled.
 */

/**
 * Pure: split CSV text into records of raw string fields, RFC4180 quoting,
 * tolerating LF and CRLF line endings and a single trailing newline.
 * Returns an array of arrays.
 */
function parseCsvRecords(text) {
  const src = String(text == null ? '' : text);
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let sawAnyChar = false;
  // True once a field's closing quote has been seen: from that point only a
  // delimiter, a line break, or end-of-input is legal in that field.
  let quoteClosed = false;
  let line = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      sawAnyChar = true;
      continue;
    }
    if (quoteClosed && ch !== ',' && ch !== '\n' && ch !== '\r') {
      throw new Error(
        `csv parse failed: line ${line}, character after a closing quote must end the field ` +
        `(found ${JSON.stringify(ch)}); RFC4180 has no "abc"def form`
      );
    }
    if (ch === '"') {
      if (field.length > 0 || quoteClosed) {
        throw new Error(
          `csv parse failed: line ${line}, a quote may only open a field at its start`
        );
      }
      inQuotes = true;
      sawAnyChar = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
      quoteClosed = false;
      sawAnyChar = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      quoteClosed = false;
      sawAnyChar = false;
      line++;
    } else {
      field += ch;
      sawAnyChar = true;
    }
  }
  if (inQuotes) {
    throw new Error('csv parse failed: unterminated quoted field at end of input');
  }
  if (sawAnyChar || field.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** Pure: the header field list of CSV text. Throws on empty input. */
function parseCsvHeader(text) {
  const records = parseCsvRecords(text);
  if (records.length === 0) throw new Error('csv parse failed: no header line');
  return records[0];
}

/**
 * Pure: read only the named columns out of CSV text.
 *
 * Returns `{ header, columns, rows, rowCount }` where `rows` is an array of
 * plain objects carrying ONLY `columns`. Projecting during the parse keeps the
 * inspection pass from materializing a hundred-column object per row for files
 * with tens of thousands of rows.
 *
 * A requested column that the file does not have is an error: every mapping
 * this tooling seals depends on a column existing, and a source that quietly
 * renamed one must stop the run rather than produce an all-undefined report.
 */
function collectColumns(text, columns, { label = 'csv' } = {}) {
  const records = parseCsvRecords(text);
  if (records.length === 0) throw new Error(`${label}: no header line`);
  const header = records[0];
  const index = new Map();
  header.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i);
  });
  const missing = columns.filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new Error(`${label}: missing required column(s) ${missing.join(', ')}`);
  }
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const fields = records[r];
    if (fields.length !== header.length) {
      throw new Error(
        `${label}: record ${r} has ${fields.length} fields, header has ${header.length} ` +
        '(refusing to guess which column is missing)'
      );
    }
    const row = {};
    for (const name of columns) row[name] = fields[index.get(name)];
    rows.push(row);
  }
  return { header, columns: [...columns], rows, rowCount: rows.length };
}

module.exports = { parseCsvRecords, parseCsvHeader, collectColumns };
