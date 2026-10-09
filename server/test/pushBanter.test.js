const test = require('node:test');
const assert = require('node:assert/strict');
const { SITUATIONS, LINES, banterFor } = require('../services/pushBanter');

// The same forbidden-name pattern the Draft assistant's voice test decodes
// (src/lib/draftAssistant/voices/polkHighLegend.test.js), carried as base64 so
// this file is not a hit for the shell guard's own grep.
const FORBIDDEN_NAME_PATTERN = new RegExp(
  Buffer.from(
    'YnVuZHl8XGJwZWdcYnxtYXJjeXxiaWcuP3Vuc3xwc3ljaG8gZGFkfHNwYXJlIHRpcmV8XGJidWRcYnxrZWxseQ==',
    'base64'
  ).toString('utf8'),
  'i'
);
const PLACEHOLDERS = new Set(['mine', 'theirs', 'player', 'event', 'points', 'count', 'margin', 'week', 'league']);

test('the bank covers exactly the twelve situations', () => {
  assert.equal(SITUATIONS.length, 12);
  assert.deepEqual(Object.keys(LINES).sort(), [...SITUATIONS].sort());
});

test('every situation has at least five distinct lines', () => {
  for (const situation of SITUATIONS) {
    assert.ok(new Set(LINES[situation]).size >= 5, `${situation} has fewer than five distinct lines`);
  }
});

test('no line carries a borrowed name or an em dash, and every placeholder is a known fact', () => {
  for (const situation of SITUATIONS) {
    for (const line of LINES[situation]) {
      assert.doesNotMatch(line, FORBIDDEN_NAME_PATTERN, `${situation}: ${line}`);
      assert.ok(!line.includes('\u2014'), `${situation} has an em dash: ${line}`);
      for (const [, key] of line.matchAll(/\{(\w+)\}/g)) {
        assert.ok(PLACEHOLDERS.has(key), `${situation} uses unknown placeholder {${key}}`);
      }
    }
  }
});

test('banterFor is deterministic over (situation, seed) and pins a line', () => {
  const facts = { theirs: 'Away FC' };
  const first = banterFor('leadLost', 'score-lead:7:away:1', facts);
  assert.equal(first, banterFor('leadLost', 'score-lead:7:away:1', facts));
  assert.equal(first, 'The lead is gone, like my hairline and my 1966 trophy. One of those came back. Not the trophy.');
});

test('a different seed can pick a different line, and placeholders are filled from the facts', () => {
  const other = banterFor('leadLost', 'score-lead:7:away:1:b', { theirs: 'Away FC' });
  assert.equal(other, 'Away FC just went ahead. I have watched a lot of things slip away from the couch. Add this to the pile.');
  const seeds = new Set();
  for (let i = 0; i < 40; i += 1) seeds.add(banterFor('leadLost', `seed:${i}`, { theirs: 'Away FC' }));
  assert.ok(seeds.size > 1);
});

test('a missing fact renders empty and an unknown situation is null', () => {
  assert.doesNotMatch(banterFor('closeMatchup', 'x'), /\{/);
  assert.equal(banterFor('nope', 'score-lead:7:away:1'), null);
});
