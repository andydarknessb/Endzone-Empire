'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const mdeScript = require('../scripts/run-backtest-mde');
const canonicalJsonIo = require('../scripts/lib/canonicalJsonIo');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-canonical-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function environmentCheck(label) {
  return (token) => mdeScript.assertEnvironmentFree(token, { label });
}

test('streamed canonical bytes and digest are identical to canonicalJson for every supported value shape', (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'artifact.json');
  const value = {
    z: [{ nested: true, nil: null, exponent: 1.25e-7 }, 'quote " slash \\', false],
    a: new Date('2026-08-11T00:00:00.000Z'),
    middle: { b: 2, a: 1 },
  };
  const expected = `${canonicalJson(value)}\n`;
  const expectedDigest = crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

  canonicalJsonIo.writeCanonicalJsonFileSync(out, value, {
    trailingNewline: true,
    maxBufferedChars: 7,
  });

  assert.equal(fs.readFileSync(out, 'utf8'), expected);
  assert.equal(canonicalJsonIo.canonicalJsonSha256(value), expectedDigest);
});

test('streamed writer never depends on Array.map/join aggregation', (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'large-array.json');
  const values = Array.from({ length: 50_000 }, (_, index) => ({ index, value: `v${index}` }));
  Object.defineProperty(values, 'map', {
    value() { throw new Error('Array.map must not be called by the streaming writer'); },
  });

  canonicalJsonIo.writeCanonicalJsonFileSync(out, { values }, {
    trailingNewline: true,
    maxBufferedChars: 31,
  });

  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.values.length, 50_000);
  assert.deepEqual(parsed.values[49_999], { index: 49_999, value: 'v49999' });
});

test('incremental reader reconstructs JSON across deliberately tiny stream chunks', async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'tiny-chunks.json');
  const expected = {
    array: [null, true, false, -12.5e3, 'escaped " quote and \\ slash', { empty: '' }],
    object: { z: 3, a: 1 },
  };
  fs.writeFileSync(input, JSON.stringify(expected), 'utf8');

  const parsed = await canonicalJsonIo.readJsonFile(input, { highWaterMark: 3 });

  assert.deepEqual(parsed, expected);
});

test('streamed environment checks reject leaks atomically and leave no target or temporary file', (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'artifact.json');

  assert.throws(
    () => canonicalJsonIo.writeCanonicalJsonFileSync(out, {
      safe: 'value',
      leaked: 'C:\\Users\\someone\\snapshot',
    }, {
      assertToken: environmentCheck('streamed-artifact'),
      trailingNewline: true,
    }),
    /absolute-path-shaped substring/,
  );
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('incremental reader rejects malformed JSON', async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'malformed.json');
  fs.writeFileSync(input, '{"a":[1,2}', 'utf8');

  await assert.rejects(canonicalJsonIo.readJsonFile(input, { highWaterMark: 2 }));
});
