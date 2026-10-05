import { matchupWinProbability as clientV1 } from './winProbability';
import { matchupWinProbability as serverV1 } from '../../../server/services/winProbabilityV1';

// Win probability v2's evaluation (server/services/winProbabilityEvaluation.js)
// scores v1 against the real results, and v1 is not stored on a shadow row: it
// is recomputed from the row's scores and Expected finals. The client's v1
// lives here in src/shared/lib as an ES module the server cannot require, so
// the server carries a port (server/services/winProbabilityV1.js). This pins
// the two to the SAME number, bit for bit, over a grid of inputs, so the
// evaluation can never grade a v1 the browser does not actually show. Editing
// either copy alone (the scale, the floored remaining points, the null
// handling) turns this red.
//
// The grid covers what a shadow row can carry: pg hands decimals back as
// strings, a score can be null before the first sync, an Expected final can
// sit below the score (points on the board beyond the projection), and a side
// can be far ahead or behind.
const SCORES = [null, 0, 12.5, 71.2, '87.40', 140];
const EXPECTED_FINALS = [null, 0, 60, 95, '104.10', 118.6, 180.25];
const STATUSES = [null, 'scheduled', 'live', 'played', 'final'];

test('the server v1 port equals the client matchupWinProbability over a grid of inputs', () => {
  let compared = 0;
  for (const homeScore of SCORES) {
    for (const awayScore of SCORES) {
      for (const homeExpectedFinal of EXPECTED_FINALS) {
        for (const awayExpectedFinal of EXPECTED_FINALS) {
          for (const status of STATUSES) {
            const input = { homeScore, awayScore, homeExpectedFinal, awayExpectedFinal, status };
            const client = clientV1(input);
            const server = serverV1(input);
            expect(server.home).toBe(client.home);
            expect(server.away).toBe(client.away);
            compared += 1;
          }
        }
      }
    }
  }
  expect(compared).toBe(SCORES.length ** 2 * EXPECTED_FINALS.length ** 2 * STATUSES.length);
});

test('the port is the logistic of the Expected final margin at scale 24', () => {
  // Hand-checked anchor so the pair cannot drift together: 110 vs 100 with
  // 50 and 40 on the board is a 10-point expected margin, 1 / (1 + e^(-10/24))
  // = 0.60268533797849...
  const input = { homeScore: 50, awayScore: 40, homeExpectedFinal: 110, awayExpectedFinal: 100 };
  expect(serverV1(input).home).toBeCloseTo(0.6026853379784917, 12);
  expect(clientV1(input).home).toBeCloseTo(0.6026853379784917, 12);
});

test('a played or final matchup matches and resolves to the result by the scores', () => {
  const cases = [
    [{ homeScore: 115.9, awayScore: 109.7, homeExpectedFinal: 115.9, awayExpectedFinal: 109.7 }, 1],
    [{ homeScore: 109.7, awayScore: 115.9, homeExpectedFinal: 109.7, awayExpectedFinal: 115.9 }, 0],
    [{ homeScore: 100, awayScore: 100, homeExpectedFinal: 100, awayExpectedFinal: 100 }, 0.5],
    // pg strings and nulls: the scores still decide it.
    [{ homeScore: '87.40', awayScore: 80, homeExpectedFinal: null, awayExpectedFinal: null }, 1],
    [{ homeScore: '87.40', awayScore: 87.4, homeExpectedFinal: 150, awayExpectedFinal: null }, 0.5],
  ];
  for (const status of ['played', 'final']) {
    for (const [scores, home] of cases) {
      const input = { ...scores, status };
      expect(clientV1(input).home).toBe(home);
      expect(serverV1(input).home).toBe(home);
      expect(serverV1(input).away).toBe(1 - home);
    }
  }
});

test('a live matchup with no Expected finals stays below 1 in both copies', () => {
  const input = { homeScore: 60, awayScore: 40, homeExpectedFinal: null, awayExpectedFinal: null, status: 'live' };
  expect(clientV1(input).home).toBeLessThan(1);
  expect(serverV1(input).home).toBe(clientV1(input).home);
});
