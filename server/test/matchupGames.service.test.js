const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeGameIds } = require('../services/matchupGames.service');

test('dedupeGameIds: collapses repeated tank01_game_id rows (two players on the same real game)', () => {
  const rows = [
    { tank01_game_id: '20260910_BUF@KC' },
    { tank01_game_id: '20260913_SF@LAR' },
    { tank01_game_id: '20260910_BUF@KC' }, // second Chiefs/Bills player rostered
  ];
  assert.deepEqual(dedupeGameIds(rows), ['20260910_BUF@KC', '20260913_SF@LAR']);
});

test('dedupeGameIds: sorts the result for a stable response', () => {
  const rows = [{ tank01_game_id: 'zzz' }, { tank01_game_id: 'aaa' }];
  assert.deepEqual(dedupeGameIds(rows), ['aaa', 'zzz']);
});

test('dedupeGameIds: empty input yields an empty array', () => {
  assert.deepEqual(dedupeGameIds([]), []);
  assert.deepEqual(dedupeGameIds(null), []);
  assert.deepEqual(dedupeGameIds(undefined), []);
});

test('dedupeGameIds: a single row round-trips unchanged', () => {
  assert.deepEqual(dedupeGameIds([{ tank01_game_id: 'only1' }]), ['only1']);
});
