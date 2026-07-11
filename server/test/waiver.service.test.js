const test = require('node:test');
const assert = require('node:assert/strict');
const { orderClaims } = require('../services/waiver.service');

const claim = (id, teamId, bid = 0, createdAt = '2026-07-11T00:00:00Z') => ({
  id,
  team_id: teamId,
  bid,
  created_at: createdAt,
});

test('orderClaims priority mode: lower waiver_priority number claims first', () => {
  const priorities = new Map([[10, 3], [20, 1], [30, 2]]);
  const ordered = orderClaims([claim(1, 10), claim(2, 20), claim(3, 30)], priorities, 'priority');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 30, 10]);
});

test('orderClaims priority mode: ties broken by earliest claim', () => {
  const priorities = new Map([[10, 1], [20, 1]]);
  const ordered = orderClaims(
    [claim(2, 20, 0, '2026-07-11T01:00:00Z'), claim(1, 10, 0, '2026-07-11T00:00:00Z')],
    priorities,
    'priority'
  );
  assert.deepEqual(ordered.map((c) => c.id), [1, 2]);
});

test('orderClaims faab mode: highest bid wins', () => {
  const priorities = new Map([[10, 1], [20, 2], [30, 3]]);
  const ordered = orderClaims(
    [claim(1, 10, 5), claim(2, 20, 25), claim(3, 30, 10)],
    priorities,
    'faab'
  );
  assert.deepEqual(ordered.map((c) => c.bid), [25, 10, 5]);
});

test('orderClaims faab mode: bid ties fall back to waiver priority', () => {
  const priorities = new Map([[10, 2], [20, 1]]);
  const ordered = orderClaims([claim(1, 10, 15), claim(2, 20, 15)], priorities, 'faab');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 10]);
});

test('orderClaims faab mode: zero bids still resolve by priority', () => {
  const priorities = new Map([[10, 3], [20, 1]]);
  const ordered = orderClaims([claim(1, 10, 0), claim(2, 20, 0)], priorities, 'faab');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 10]);
});

test('orderClaims: teams missing a priority sort last', () => {
  const priorities = new Map([[10, 1]]);
  const ordered = orderClaims([claim(1, 99), claim(2, 10)], priorities, 'priority');
  assert.deepEqual(ordered.map((c) => c.team_id), [10, 99]);
});

test('orderClaims does not mutate its input', () => {
  const priorities = new Map([[10, 2], [20, 1]]);
  const input = [claim(1, 10), claim(2, 20)];
  orderClaims(input, priorities, 'priority');
  assert.deepEqual(input.map((c) => c.id), [1, 2]);
});
