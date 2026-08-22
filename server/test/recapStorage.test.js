const { test } = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../modules/recapStorage');

test('recap storage exports one private, versioned table identifier', () => {
  assert.equal(storage.RECAPS_SCHEMA, 'private');
  assert.equal(storage.RECAPS_TABLE_NAME, 'game_recaps');
  assert.equal(storage.RECAPS_TABLE, 'private.game_recaps');
  assert.equal(storage.RECAPS_TABLE_SQL, '"private"."game_recaps"');
  assert.equal(storage.DATA_VERSION, 1);
  assert.equal(storage.GENERATOR_VERSION, '1.0.0');
});

test('only absent schema/table errors are classified as missing recap storage', () => {
  assert.equal(storage.isMissingRecapStorage({ code: '42P01' }), true);
  assert.equal(storage.isMissingRecapStorage({ code: '3F000' }), true);
  assert.equal(storage.isMissingRecapStorage({ code: '42501' }), false);
  assert.equal(storage.isMissingRecapStorage(new Error('network failure')), false);
  assert.equal(storage.isMissingRecapStorage(null), false);
});
