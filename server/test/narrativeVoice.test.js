const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_BLOCK, DENY } = require('../services/voices/polkHighLegend');
const { voiceBlockFor, withVoice, deniedTerm, hasTerm } = require('../services/narrativeVoice');

/**
 * Voice (ADR 0069): the block, the deny list and where the Voice may reach.
 * The service suites (recap, matchupNarrative) prove the wiring; this file
 * proves the module and the fence around it.
 */

const SERVICES = path.join(__dirname, '..', 'services');
const ROUTES = path.join(__dirname, '..', 'routes');
const source = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

test('voiceBlockFor returns the block for a known Voice and nothing for null or unknown', () => {
  assert.equal(voiceBlockFor('polk_high_legend'), VOICE_BLOCK);
  assert.equal(voiceBlockFor(null), '');
  assert.equal(voiceBlockFor(undefined), '');
  assert.equal(voiceBlockFor('mystery'), '');
});

test('withVoice puts the block first and leaves a neutral system untouched', () => {
  assert.equal(withVoice('SYS', null), 'SYS');
  assert.equal(withVoice('SYS', 'mystery'), 'SYS');
  assert.equal(withVoice('SYS', 'polk_high_legend'), `${VOICE_BLOCK}\n\nSYS`);
});

test('the block keeps its rules, its four examples and no em dash', () => {
  assert.match(VOICE_BLOCK, /^VOICE\. You are writing as the Polk High Legend/);
  assert.match(VOICE_BLOCK, /Every instruction after this block still applies and wins over the voice\./);
  assert.equal(VOICE_BLOCK.match(/^\d\. /gm).length, 4);
  assert.equal(VOICE_BLOCK.includes(String.fromCharCode(0x2014)), false);
});

test('every deny term is caught whole, in any case, and passes when the facts carry it', () => {
  for (const term of DENY) {
    assert.equal(deniedTerm(`He said ${term.toUpperCase()} twice.`, ''), term, `${term} caught`);
    assert.equal(deniedTerm(`He said ${term.toLowerCase()} twice.`, '{}'), term);
    assert.equal(deniedTerm(`He said ${term} twice.`, `facts: ${term.toLowerCase()}`), null, `${term} exempt when in facts`);
  }
});

test('a deny term is a whole word: longer words and the plain word "married" pass', () => {
  assert.equal(deniedTerm('A budget for budding, bundled kellys.', ''), null);
  assert.equal(deniedTerm('They are married to the waiver wire.', ''), null);
  assert.equal(deniedTerm('Kelly\u2019s lineup flopped.', ''), 'Kelly');
});

test('the first denied term wins, and a facts-carried term does not mask a later one', () => {
  assert.equal(deniedTerm('Peggy and Bundy', 'bundy'), 'Peggy');
  assert.equal(deniedTerm('Justin Jefferson and Hooters', 'Justin Jefferson'), 'Hooters');
  assert.equal(deniedTerm('Justin Jefferson caught nine.', '{"name":"Justin Jefferson"}'), null);
});

test('hasTerm matches a phrase with its punctuation', () => {
  assert.equal(hasTerm("Welcome to Gary's Shoes today", "Gary's Shoes"), true);
  assert.equal(hasTerm('Married... with Children', 'Married... with Children'), true);
  assert.equal(hasTerm('Married with kids', 'Married with Children'), false);
});

test('only recap and matchupNarrative reach for the Voice; the game recap and Projection explanation never do', () => {
  assert.doesNotMatch(source(SERVICES, 'gameRecap.service.js'), /narrativeVoice|voices\//);
  assert.doesNotMatch(source(SERVICES, 'projectionExplanation.service.js'), /narrativeVoice|voices\//);
  assert.doesNotMatch(source(SERVICES, 'claude.js'), /narrativeVoice|voices\//);
  assert.match(source(SERVICES, 'recap.service.js'), /require\('\.\/narrativeVoice'\)/);
  assert.match(source(SERVICES, 'matchupNarrative.service.js'), /require\('\.\/narrativeVoice'\)/);
});

test('no server service or route outside the Voice module carries a deny term (Kelly, Bud and Jefferson are ordinary names)', () => {
  const ordinary = new Set(['Kelly', 'Bud', 'Jefferson']);
  const files = [SERVICES, ROUTES].flatMap((dir) =>
    fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => path.join(e.parentPath || e.path, e.name)));
  assert.ok(files.length > 50, 'the scan found the server files');
  const voiceModule = path.join(SERVICES, 'voices', 'polkHighLegend.js');
  for (const file of files.filter((f) => f !== voiceModule)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const term of DENY.filter((d) => !ordinary.has(d))) {
      assert.equal(hasTerm(text, term), false, `${path.relative(SERVICES, file)} carries "${term}"`);
    }
  }
});
