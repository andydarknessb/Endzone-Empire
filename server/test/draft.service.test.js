const test = require('node:test');
const assert = require('node:assert/strict');
const { teamIndexForPick } = require('../services/draft.service');

test('teamIndexForPick: 4 teams, round 1 (picks 0-3)', () => {
  assert.equal(teamIndexForPick(0, 4), 0);
  assert.equal(teamIndexForPick(1, 4), 1);
  assert.equal(teamIndexForPick(2, 4), 2);
  assert.equal(teamIndexForPick(3, 4), 3);
});

test('teamIndexForPick: 4 teams, round 2 reversed (picks 4-7)', () => {
  assert.equal(teamIndexForPick(4, 4), 3);
  assert.equal(teamIndexForPick(5, 4), 2);
  assert.equal(teamIndexForPick(6, 4), 1);
  assert.equal(teamIndexForPick(7, 4), 0);
});

test('teamIndexForPick: 4 teams, round 3 (pick 8)', () => {
  assert.equal(teamIndexForPick(8, 4), 0);
});

test('teamIndexForPick: 2 teams snake draft', () => {
  assert.equal(teamIndexForPick(0, 2), 0);
  assert.equal(teamIndexForPick(1, 2), 1);
  assert.equal(teamIndexForPick(2, 2), 1);
  assert.equal(teamIndexForPick(3, 2), 0);
});

test('teamIndexForPick: 1 team always returns 0', () => {
  assert.equal(teamIndexForPick(0, 1), 0);
  assert.equal(teamIndexForPick(1, 1), 0);
  assert.equal(teamIndexForPick(2, 1), 0);
  assert.equal(teamIndexForPick(100, 1), 0);
});

test('teamIndexForPick: 6 teams, full example', () => {
  // Round 0 (even): 0,1,2,3,4,5 → 0,1,2,3,4,5
  assert.equal(teamIndexForPick(0, 6), 0);
  assert.equal(teamIndexForPick(1, 6), 1);
  assert.equal(teamIndexForPick(2, 6), 2);
  assert.equal(teamIndexForPick(3, 6), 3);
  assert.equal(teamIndexForPick(4, 6), 4);
  assert.equal(teamIndexForPick(5, 6), 5);
  // Round 1 (odd): 6,7,8,9,10,11 → 5,4,3,2,1,0
  assert.equal(teamIndexForPick(6, 6), 5);
  assert.equal(teamIndexForPick(7, 6), 4);
  assert.equal(teamIndexForPick(8, 6), 3);
  assert.equal(teamIndexForPick(9, 6), 2);
  assert.equal(teamIndexForPick(10, 6), 1);
  assert.equal(teamIndexForPick(11, 6), 0);
  // Round 2 (even): 12,13,14,15,16,17 → 0,1,2,3,4,5
  assert.equal(teamIndexForPick(12, 6), 0);
  assert.equal(teamIndexForPick(13, 6), 1);
  assert.equal(teamIndexForPick(14, 6), 2);
  assert.equal(teamIndexForPick(15, 6), 3);
  assert.equal(teamIndexForPick(16, 6), 4);
  assert.equal(teamIndexForPick(17, 6), 5);
});

test('teamIndexForPick: 3 teams snake draft', () => {
  // Round 0: 0,1,2 → 0,1,2
  assert.equal(teamIndexForPick(0, 3), 0);
  assert.equal(teamIndexForPick(1, 3), 1);
  assert.equal(teamIndexForPick(2, 3), 2);
  // Round 1: 3,4,5 → 2,1,0
  assert.equal(teamIndexForPick(3, 3), 2);
  assert.equal(teamIndexForPick(4, 3), 1);
  assert.equal(teamIndexForPick(5, 3), 0);
  // Round 2: 6,7,8 → 0,1,2
  assert.equal(teamIndexForPick(6, 3), 0);
  assert.equal(teamIndexForPick(7, 3), 1);
  assert.equal(teamIndexForPick(8, 3), 2);
});

test('teamIndexForPick: 12 teams snake draft', () => {
  // Round 0 (even): first pick → team 0
  assert.equal(teamIndexForPick(0, 12), 0);
  // Round 0 (even): last pick of round → team 11
  assert.equal(teamIndexForPick(11, 12), 11);
  // Round 1 (odd): first pick → team 11
  assert.equal(teamIndexForPick(12, 12), 11);
  // Round 1 (odd): last pick → team 0
  assert.equal(teamIndexForPick(23, 12), 0);
  // Round 2 (even): first pick → team 0
  assert.equal(teamIndexForPick(24, 12), 0);
});
