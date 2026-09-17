const test = require('node:test');
const assert = require('node:assert/strict');
const { detectScoringEvents, attributePlayPoints } = require('../services/boxScoreApply.service');

test('detects a new rushing touchdown from a stat delta', () => {
  const prev = { rushingYards: 40, rushingTDs: 0 };
  const next = { rushingYards: 62, rushingTDs: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'rushing', statKey: 'rushingTDs', tdDelta: 1, isTouchdown: true });
});

test('first observation of the week (no prior row) counts as a TD', () => {
  const events = detectScoringEvents(null, { receivingTDs: 1, receptions: 3 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'receiving');
});

test('yardage-only change produces no event', () => {
  const prev = { rushingYards: 40, rushingTDs: 1 };
  const next = { rushingYards: 88, rushingTDs: 1 };
  assert.deepEqual(detectScoringEvents(prev, next), []);
});

test('a stat correction that moves points without a TD increment fires nothing', () => {
  // e.g. receptions corrected upward (+points) but the TD count is unchanged.
  const prev = { receptions: 4, receivingYards: 50, receivingTDs: 1 };
  const next = { receptions: 6, receivingYards: 71, receivingTDs: 1 };
  assert.deepEqual(detectScoringEvents(prev, next), []);
});

test('re-running with identical stats is idempotent (no events)', () => {
  const stats = { passingYards: 300, passingTDs: 3 };
  assert.deepEqual(detectScoringEvents(stats, stats), []);
});

test('multiple TD stats incrementing in one window yield one event each', () => {
  const prev = { passingTDs: 1, rushingTDs: 0 };
  const next = { passingTDs: 2, rushingTDs: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['passing', 'rushing']);
});

test('a multi-TD jump reports the delta, not just a boolean', () => {
  const events = detectScoringEvents({ rushingTDs: 1 }, { rushingTDs: 3 });
  assert.equal(events.length, 1);
  assert.equal(events[0].tdDelta, 2);
});

test('a defensive touchdown is typed as defensive', () => {
  const events = detectScoringEvents({ defensiveTD: 0 }, { defensiveTD: 1 });
  assert.equal(events[0].type, 'defensive');
  assert.equal(events[0].isTouchdown, true);
});

test('a sack is a non-touchdown moment event', () => {
  const events = detectScoringEvents({ sack: 0 }, { sack: 1 });
  assert.equal(events[0].type, 'sack');
  assert.equal(events[0].isTouchdown, false);
});

// The following moved from scoring.service.test.js (#1506, spec #1492): same
// module (boxScoreApply.service's detectScoringEvents) as the rest of this file.

test('detectScoringEvents fires a touchdown-caliber event for a new passing TD', () => {
  const events = detectScoringEvents({ passingTDs: 1 }, { passingTDs: 2 });
  assert.deepEqual(events, [{ type: 'passing', statKey: 'passingTDs', tdDelta: 1, isTouchdown: true }]);
});

test('detectScoringEvents fires a non-touchdown event for a new sack/field goal/fumble recovery', () => {
  const events = detectScoringEvents(
    { sack: 0, fieldGoal: 0, fumbleRecovery: 0 },
    { sack: 1, fieldGoal: 1, fumbleRecovery: 1 }
  );
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['fieldGoal', 'fumble', 'sack']);
  assert(events.every((e) => e.isTouchdown === false));
});

test('detectScoringEvents produces nothing for yardage-only changes or unchanged stats', () => {
  assert.deepEqual(detectScoringEvents({ passingYards: 100 }, { passingYards: 300 }), []);
  assert.deepEqual(detectScoringEvents({ sack: 2 }, { sack: 2 }), []);
});

// --- attributePlayPoints ------------------------------------------------
//
// One score event can carry plays from more than one live sync for the same
// player (liveBoxPoll's rescore gate buckets a league's plays across 30s
// engine ticks and flushes on a 60s floor), so a client must SUM a player's
// plays within one event, never dedupe them. That means the plays THEMSELVES
// have to add up to the whole change: this is the pricer that splits one
// sync's whole points change across the several tracked stat events it
// produced, so `sum(plays[].pointsDelta) === wholeDelta` always holds.

const sum2 = (arr) => Math.round(arr.reduce((s, n) => s + n, 0) * 100) / 100;

test('a kicker\'s FG + XP in one sync price separately and sum to the whole, not [whole, whole]', () => {
  const prev = {};
  const next = { fieldGoal: 1, fieldGoalDistances: [15], extraPoint: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2, 'fieldGoal and extraPoint each fired');
  const wholeDelta = 4; // 3 (0-19yd FG tier) + 1 (XP)
  const deltas = attributePlayPoints(prev, next, events, wholeDelta);
  assert.deepEqual(deltas, [3, 1]);
  assert.equal(sum2(deltas), wholeDelta);
});

test('a QB\'s passing TD + rushing TD + yardage in one sync sum to the whole, with the yardage residual on the LAST event', () => {
  const prev = { passingYards: 200, passingTDs: 1, rushingYards: 20, rushingTDs: 0 };
  const next = { passingYards: 220, passingTDs: 2, rushingYards: 25, rushingTDs: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2);
  const wholeDelta = 11.3; // 4 (passing TD) + 6 (rushing TD) + 0.8 (pass yds) + 0.5 (rush yds)
  const deltas = attributePlayPoints(prev, next, events, wholeDelta);
  // Residual (1.3, the two yardage bonuses) rides the LAST event (rushingTDs),
  // not the first: the passing TD keeps its clean marginal.
  assert.deepEqual(deltas, [4, 7.3]);
  assert.equal(sum2(deltas), wholeDelta);
});

test('a DEF fumbleRecovery + defensiveTD with a points-allowed tier change sum to the whole, residual on the LAST event', () => {
  const prev = { fumbleRecovery: 0, defensiveTD: 0, pointsAllowed: 3 }; // tier 1-6 -> 7 pts
  const next = { fumbleRecovery: 1, defensiveTD: 1, pointsAllowed: 10 }; // tier 7-13 -> 4 pts
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2);
  const wholeDelta = 5; // (2 + 6 + 4) - (0 + 0 + 7)
  const deltas = attributePlayPoints(prev, next, events, wholeDelta);
  // events = [defensiveTD, fumbleRecovery] (PLAY_STAT_EVENTS order); the tier
  // drop's residual (-3) rides fumbleRecovery, the last event, leaving the
  // touchdown play's own marginal (6) untouched.
  assert.deepEqual(deltas, [6, -1]);
  assert.equal(sum2(deltas), wholeDelta);
});

// Regression for the QA fuzz finding: with the residual on the FIRST event,
// PLAY_STAT_EVENTS' touchdown-keys-first ordering meant a touchdown play
// routinely carried the fuzzy (or, on a big enough residual, negative) leftover
// - a QB's passing TD showing "+0.8" instead of its clean +4, say. The two
// thrown INTs here have no tracked event of their own (only a defensive
// interception RETURN is tracked), so their -4 is pure residual; with the
// residual on the LAST event it lands on rushingTDs instead, and the passing
// TD keeps its clean marginal.
test('a touchdown play keeps its clean marginal when a later non-touchdown-priced residual exists', () => {
  const prev = { passingTDs: 1, rushingTDs: 0, interceptions: 0 };
  const next = { passingTDs: 2, rushingTDs: 1, interceptions: 2 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2);
  const wholeDelta = 6; // 4 (passing TD) + 6 (rushing TD) - 4 (2 thrown INTs)
  const deltas = attributePlayPoints(prev, next, events, wholeDelta);
  assert.deepEqual(deltas, [4, 2], 'the passing TD is untouched at its clean +4');
  assert.equal(sum2(deltas), wholeDelta);
});

test('a single event returns [wholeDelta] unchanged (today\'s one-play-per-sync behavior)', () => {
  const events = [{ type: 'rushing', statKey: 'rushingTDs', tdDelta: 1, isTouchdown: true }];
  assert.deepEqual(attributePlayPoints({ rushingTDs: 0 }, { rushingTDs: 1 }, events, 6.5), [6.5]);
});

test('zero events returns an empty array', () => {
  assert.deepEqual(attributePlayPoints({}, {}, [], 0), []);
});
