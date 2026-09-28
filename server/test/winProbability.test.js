const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalCdf,
  gameFractionRemaining,
  starterSigma,
  varianceRemaining,
  winProbabilityV2,
} = require('../services/winProbability');

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

// --- The normal CDF (reference values from standard normal tables) ---

test('normalCdf matches standard normal table values to 1e-6', () => {
  close(normalCdf(0), 0.5, 1e-9, 'Phi(0)');
  close(normalCdf(1), 0.841345, 1e-6, 'Phi(1)');
  close(normalCdf(-1), 0.158655, 1e-6, 'Phi(-1)');
  close(normalCdf(1.959964), 0.975, 1e-6, 'Phi(1.96)');
  close(normalCdf(-3), 0.001350, 1e-6, 'Phi(-3)');
});

// --- How much of a starter's game is left ---

test('a game not yet started has all of it left, a final game none', () => {
  assert.equal(gameFractionRemaining({ gameState: 'scheduled' }), 1);
  assert.equal(gameFractionRemaining({ gameState: 'final' }), 0);
});

test('an in-progress game reads the quarter and clock ESPN writes', () => {
  close(gameFractionRemaining({ gameState: 'in_progress', quarter: 'Q3', timeRemaining: '6:42' }), 21.7 / 60, 1e-9, 'Q3 6:42');
  close(gameFractionRemaining({ gameState: 'in_progress', quarter: 'Q1', timeRemaining: '15:00' }), 1, 1e-9, 'Q1 15:00');
  close(gameFractionRemaining({ gameState: 'in_progress', quarter: 'Q4', timeRemaining: '0:30' }), 0.5 / 60, 1e-9, 'Q4 0:30');
  assert.equal(gameFractionRemaining({ gameState: 'in_progress', quarter: 'Half', timeRemaining: null }), 0.5);
});

test('overtime counts only the overtime clock', () => {
  close(gameFractionRemaining({ gameState: 'in_progress', quarter: 'OT', timeRemaining: '8:00' }), 8 / 60, 1e-9, 'OT 8:00');
});

test('a bare Tank01 period number reads like the quarter it names', () => {
  close(gameFractionRemaining({ gameState: 'in_progress', quarter: '2', timeRemaining: '7:30' }), 37.5 / 60, 1e-9, 'period 2');
});

test('an in-progress game with no readable clock counts as half left', () => {
  assert.equal(gameFractionRemaining({ gameState: 'in_progress', quarter: null, timeRemaining: null }), 0.5);
  assert.equal(gameFractionRemaining({ gameState: 'in_progress', quarter: 'Q9?', timeRemaining: 'soon' }), 0.5);
});

// --- A starter's spread and a team's remaining variance ---

test('a starter sigma is his 10th-to-90th band over 2.5631', () => {
  close(starterSigma({ p10: 4, p90: 22 }), 7.0228, 1e-4, '18-point band');
  assert.equal(starterSigma({ p10: 10, p90: 10 }), 0);
});

test('a starter with no distribution adds no spread', () => {
  assert.equal(starterSigma({ p10: null, p90: null }), 0);
  assert.equal(starterSigma(null), 0);
});

test('remaining variance sums each starter sigma squared, scaled by game time left', () => {
  const band18 = { p10: 4, p90: 22 };
  const s2 = (18 / 2.5631) ** 2;
  close(varianceRemaining([{ ...band18, gameFraction: 1 }, { ...band18, gameFraction: 0.5 }, { ...band18, gameFraction: 0 }]), 1.5 * s2, 1e-9, 'three starters');
  assert.equal(varianceRemaining([]), 0);
});

// --- v2 itself (worked examples from the spec board) ---

test('the live Winsconsota example: +14.5 with seven starters left reads 78.2%', () => {
  const s2 = (18 / 2.5631) ** 2;
  const result = winProbabilityV2({ homeExpectedFinal: 118.6, awayExpectedFinal: 104.1, homeVariance: 4 * s2, awayVariance: 3 * s2 });
  close(result.home, 0.782, 0.001, 'home');
  close(result.mu, 14.5, 1e-9, 'mu');
  close(result.sigma, Math.sqrt(7 * s2), 1e-9, 'sigma');
});

test('home and away always sum to one', () => {
  const result = winProbabilityV2({ homeExpectedFinal: 101, awayExpectedFinal: 99.2, homeVariance: 40, awayVariance: 55 });
  close(result.home + result.away, 1, 1e-12, 'sum');
});

test('with nothing left to play the result is certain: 1, 0 or a coin flip on a tie', () => {
  assert.equal(winProbabilityV2({ homeExpectedFinal: 112, awayExpectedFinal: 110, homeVariance: 0, awayVariance: 0 }).home, 1);
  assert.equal(winProbabilityV2({ homeExpectedFinal: 110, awayExpectedFinal: 112, homeVariance: 0, awayVariance: 0 }).home, 0);
  assert.equal(winProbabilityV2({ homeExpectedFinal: 110, awayExpectedFinal: 110, homeVariance: 0, awayVariance: 0 }).home, 0.5);
});

test('k widens the spread: a larger k pulls the same lead toward a coin flip', () => {
  const base = winProbabilityV2({ homeExpectedFinal: 110, awayExpectedFinal: 100, homeVariance: 100, awayVariance: 100 });
  const wider = winProbabilityV2({ homeExpectedFinal: 110, awayExpectedFinal: 100, homeVariance: 100, awayVariance: 100, k: 1.5 });
  assert.ok(wider.home < base.home && wider.home > 0.5);
});

test('an unknown expected final on either side gives no probability', () => {
  assert.equal(winProbabilityV2({ homeExpectedFinal: null, awayExpectedFinal: 100, homeVariance: 10, awayVariance: 10 }), null);
  assert.equal(winProbabilityV2({ homeExpectedFinal: 100, awayExpectedFinal: undefined, homeVariance: 10, awayVariance: 10 }), null);
});
