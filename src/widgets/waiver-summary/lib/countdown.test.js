import { countdownText } from './countdown';

const NOW = new Date('2026-09-24T12:00:00Z');
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const H = 3600 * 1000;
const M = 60 * 1000;

test.each([
  [14 * H + 22 * M, '14h 22m'],
  [5 * M, '0h 5m'],
  [26 * H + 10 * M, '1d 2h'],
  [30 * 1000, 'Under 1m'],
  [-M, 'Clearing now'],
])('%p ms out reads %p', (ms, text) => {
  expect(countdownText(at(ms), NOW)).toBe(text);
});

test('null or unparseable is null', () => {
  expect(countdownText(null, NOW)).toBeNull();
  expect(countdownText('nope', NOW)).toBeNull();
});
