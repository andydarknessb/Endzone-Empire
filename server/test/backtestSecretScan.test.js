const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SECRET_PATTERNS,
  matchingPatterns,
  scanRowsForSecrets,
  assertNoSecrets,
  assertNoSecretsInText,
} = require('../../scripts/backtest/lib/secretScan');

// All values below are FABRICATED for this test only - never real snapshot
// data, real credentials, or real personal information.

test('every named pattern fires on a fabricated example of its own shape', () => {
  const examples = {
    'postgres-connection-url': 'postgres://fake_user:fakepw123@127.0.0.1:5432/db',
    'password-literal': 'the temporary Password is fake123',
    'jwt-shaped': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.fakefakefakefakefakefake',
    'email-address': 'nobody@example.invalid',
    'phone-number-shape': '+1 555-010-1234',
    'windows-local-path': 'C:\\Users\\fakeuser\\secrets.txt',
    'aws-access-key': 'AKIAABCDEFGHIJKLMNOP',
  };
  for (const pattern of SECRET_PATTERNS) {
    const example = examples[pattern.name];
    assert.ok(example, `no fabricated example registered for pattern ${pattern.name}`);
    assert.ok(pattern.re.test(example), `pattern ${pattern.name} did not match its own example`);
    assert.deepEqual(matchingPatterns(example), [pattern.name],
      `matchingPatterns should identify exactly ${pattern.name} for its own example`);
  }
});

test('windows-local-path fires on ANY drive letter and on a UNC share path, not only C:\\Users\\...', () => {
  const shapes = [
    'D:\\secrets\\keys.pem',
    'C:\\ProgramData\\App\\config.json',
    'E:\\backups\\dump.sql',
    '\\\\fileserver\\shared\\creds.txt',
    '\\\\10.0.0.5\\c$\\Windows\\System32',
  ];
  for (const shape of shapes) {
    assert.deepEqual(matchingPatterns(shape), ['windows-local-path'], `${JSON.stringify(shape)} should match`);
  }
});

test('ordinary sports-stat and identifier strings never match any pattern', () => {
  const benign = [
    'Aaron Quarterback', 'KC', 'passingYards', '2025-09-05T00:20:00.000Z',
    '00-0000001', 'REG', 'Home', 'Neutral', 'free_baseline_v3.1', '3.14',
    '192.168.1.1', // an IP shape, not a phone shape - no separator match required here
  ];
  for (const value of benign) {
    assert.deepEqual(matchingPatterns(value), [], `${JSON.stringify(value)} unexpectedly matched a pattern`);
  }
});

test('a bare 10-digit run with no separator is NOT flagged as a phone number', () => {
  // Distinguishes a real phone shape from an ordinary numeric identifier
  // (e.g. a database id or a stat total) that happens to be 10 digits long.
  assert.deepEqual(matchingPatterns('5551234567'), []);
});

test('matchingPatterns never matches a non-string value', () => {
  for (const value of [42, true, false, null, undefined, {}, []]) {
    assert.deepEqual(matchingPatterns(value), []);
  }
});

test('scanRowsForSecrets walks nested objects and arrays and records a location, never the value', () => {
  const rows = [
    { id: 1, stats: { note: 'clean value' } },
    { id: 2, stats: { note: 'contact nobody@example.invalid for details' } },
    { id: 3, tags: ['fine', 'still fine', 'reach me at nobody@example.invalid'] },
  ];
  const hits = scanRowsForSecrets(rows, 'fixture_dataset');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { dataset: 'fixture_dataset', rowIndex: 1, path: '$.stats.note', pattern: 'email-address' });
  assert.deepEqual(hits[1], { dataset: 'fixture_dataset', rowIndex: 2, path: '$.tags[2]', pattern: 'email-address' });
  for (const hit of hits) {
    assert.ok(!('value' in hit), 'a hit must never carry the matched value');
    for (const key of Object.keys(hit)) {
      assert.ok(!String(hit[key]).includes('nobody@example.invalid'), 'a hit must never echo the match');
    }
  }
});

test('assertNoSecrets passes silently on a clean dataset and reports the dataset name', () => {
  const result = assertNoSecrets([{ a: 1, b: 'clean' }], 'clean_dataset');
  assert.deepEqual(result, { dataset: 'clean_dataset', hits: 0 });
});

test('assertNoSecrets aborts (fail closed) on any hit, naming the dataset, the count, and locations - never the value', () => {
  const rows = [
    { a: 'fine' },
    { a: 'password: fakeSuperSecret123' },
    { nested: { deep: 'AKIAABCDEFGHIJKLMNOP' } },
  ];
  assert.throws(
    () => assertNoSecrets(rows, 'poisoned_dataset'),
    (err) => {
      assert.match(err.message, /2 hit\(s\) in dataset poisoned_dataset/);
      assert.match(err.message, /poisoned_dataset\[1\]\.\$\.a \(password-literal\)/);
      assert.match(err.message, /poisoned_dataset\[2\]\.\$\.nested\.deep \(aws-access-key\)/);
      assert.ok(!err.message.includes('fakeSuperSecret123'), 'the thrown message must never echo the matched value');
      assert.ok(!err.message.includes('AKIAABCDEFGHIJKLMNOP'), 'the thrown message must never echo the matched value');
      return true;
    }
  );
});

test('assertNoSecrets truncates the location sample and reports "and N more" past five hits', () => {
  const rows = Array.from({ length: 8 }, () => ({ a: 'nobody@example.invalid' }));
  assert.throws(() => assertNoSecrets(rows, 'many'), /8 hit\(s\).*and 3 more/s);
});

test('scanRowsForSecrets requires an array', () => {
  assert.throws(() => scanRowsForSecrets('not an array', 'x'), /requires an array of rows/);
});

// ---------------------------------------------------------------------------
// assertNoSecretsInText - raw-text scan for a file copied verbatim (no
// row/object structure), e.g. dry-run-receipt.json before it is copied
// ---------------------------------------------------------------------------

test('assertNoSecretsInText passes on clean raw text and reports the label', () => {
  const clean = '{"studyId":"pit-sweep-2024-2025","planDigest":"abc123"}';
  assert.deepEqual(assertNoSecretsInText(clean, 'dry-run-receipt.json'), { label: 'dry-run-receipt.json', hits: 0 });
});

test('assertNoSecretsInText aborts on a hit anywhere in the text and never echoes the match', () => {
  const poisoned = '{"note":"reach me at nobody@example.invalid for questions"}';
  assert.throws(
    () => assertNoSecretsInText(poisoned, 'dry-run-receipt.json'),
    (err) => {
      assert.match(err.message, /1 pattern\(s\) matched in dry-run-receipt\.json/);
      assert.match(err.message, /email-address/);
      assert.ok(!err.message.includes('nobody@example.invalid'));
      return true;
    }
  );
});

test('assertNoSecretsInText requires a string', () => {
  assert.throws(() => assertNoSecretsInText(42, 'x'), /requires a string/);
});
