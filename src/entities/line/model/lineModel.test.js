import { lineContextFromResponse } from './lineModel';

test('reads line and weather off the wire body', () => {
  const data = {
    line: { spread: -3, total: 47, observedAt: '2026-10-01T12:00:00.000Z', impliedTeamTotal: 22 },
    weather: { indoor: false, temperatureF: 45, windSpeedMph: 10, windGustMph: 18, precipitationProbability: 20, shortForecast: 'Partly Cloudy' },
  };
  const { line, weather } = lineContextFromResponse(data);
  expect(line).toEqual(data.line);
  expect(weather).toEqual(data.weather);
});

test('a null line or weather field on the body stays null', () => {
  const { line, weather } = lineContextFromResponse({ line: null, weather: null, usage: {} });
  expect(line).toBeNull();
  expect(weather).toBeNull();
});

test('a malformed or absent body defaults both fields to null, never throws', () => {
  expect(lineContextFromResponse(null)).toEqual({ line: null, weather: null });
  expect(lineContextFromResponse(undefined)).toEqual({ line: null, weather: null });
  expect(lineContextFromResponse('nonsense')).toEqual({ line: null, weather: null });
  expect(lineContextFromResponse({})).toEqual({ line: null, weather: null });
});
