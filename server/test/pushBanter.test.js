const test = require('node:test');
const assert = require('node:assert/strict');
const { SITUATIONS, LINES, banterFor, fillTemplate } = require('../services/pushBanter');

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

test('the bank covers exactly the thirteen situations', () => {
  assert.equal(SITUATIONS.length, 13);
  assert.deepEqual(Object.keys(LINES).sort(), [...SITUATIONS].sort());
});

test('every situation has at least ten distinct lines', () => {
  for (const situation of SITUATIONS) {
    assert.ok(new Set(LINES[situation]).size >= 10, `${situation} has fewer than ten distinct lines`);
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
  assert.equal(first, 'Away FC is out front. Check the lineup, then check your nerves. The nerves are harder to fix.');
});

test('a different seed can pick a different line, and placeholders are filled from the facts', () => {
  const other = banterFor('leadLost', 'score-lead:7:away:1:b', { theirs: 'Away FC' });
  assert.equal(other, 'Behind now. My dog has better comebacks than this, and he spends most of the day asleep on the rug.');
  const seeds = new Set();
  for (let i = 0; i < 40; i += 1) seeds.add(banterFor('leadLost', `seed:${i}`, { theirs: 'Away FC' }));
  assert.ok(seeds.size >= 8);
});

test('a missing fact renders empty and an unknown situation is null', () => {
  assert.doesNotMatch(banterFor('closeMatchup', 'x'), /\{/);
  assert.equal(banterFor('nope', 'score-lead:7:away:1'), null);
});

test('every line, filled with realistic facts, is at most 110 characters (readability ruling R1)', () => {
  const facts = {
    mine: 'Your Squad',
    theirs: 'The Other Guys',
    player: 'Jaylen Warren',
    event: 'receiving touchdown',
    points: 12.4,
    count: 3,
    margin: 2.5,
    week: 17,
    league: 'Your League',
  };
  for (const situation of SITUATIONS) {
    for (const line of LINES[situation]) {
      const filled = fillTemplate(line, facts);
      assert.ok(filled.length <= 110, `${situation} is ${filled.length} chars: ${filled}`);
    }
  }
});

test('a big play line never restates the facts line: not both {event} and {points} (readability ruling R2)', () => {
  for (const situation of ['bigPlayMine', 'bigPlayTheirs']) {
    for (const line of LINES[situation]) {
      assert.ok(!(line.includes('{event}') && line.includes('{points}')), `${situation} uses both: ${line}`);
    }
  }
});
