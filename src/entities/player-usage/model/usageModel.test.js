import { usageFromResponse } from './usageModel';

test('reads usage off the wire body', () => {
  const usage = {
    weeks: [{ season: 2026, week: 4, targets: 8, carries: 0, airYards: 90, targetShare: 0.23, fantasyPoints: 12.4 }],
    seasonAverage: { targets: 6.5, carries: 0.5, airYards: 65, targetShare: 0.21, fantasyPoints: 10.2 },
  };
  expect(usageFromResponse({ usage })).toEqual(usage);
});

test('a null usage field on the body stays null', () => {
  expect(usageFromResponse({ line: {}, weather: {}, usage: null })).toBeNull();
});

test('a malformed or absent body defaults to null, never throws', () => {
  expect(usageFromResponse(null)).toBeNull();
  expect(usageFromResponse(undefined)).toBeNull();
  expect(usageFromResponse('nonsense')).toBeNull();
  expect(usageFromResponse({})).toBeNull();
});
