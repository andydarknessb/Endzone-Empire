import { favoriteFromLine, gameDetailModel, recordsDisplayModel, weatherDisplayModel } from './gameDetailModel';

describe('favoriteFromLine', () => {
  test('a negative spread favors the home team', () => {
    expect(favoriteFromLine({ spread: -3.5 }, 'DAL', 'WAS')).toBe('DAL');
  });

  test('a positive spread favors the away team', () => {
    expect(favoriteFromLine({ spread: 3.5 }, 'DAL', 'WAS')).toBe('WAS');
  });

  test('a zero spread is a pick\'em: no favorite', () => {
    expect(favoriteFromLine({ spread: 0 }, 'DAL', 'WAS')).toBeNull();
  });

  test('no line at all: no favorite', () => {
    expect(favoriteFromLine(null, 'DAL', 'WAS')).toBeNull();
  });
});

describe('weatherDisplayModel', () => {
  test('wind under 15 mph is hidden', () => {
    const model = weatherDisplayModel({ temperatureF: 60, windSpeedMph: 9, precipitationProbability: 50 });
    expect(model.windSpeedMph).toBeNull();
  });

  test('wind at or above 15 mph is shown', () => {
    const model = weatherDisplayModel({ temperatureF: 60, windSpeedMph: 15, precipitationProbability: 50 });
    expect(model.windSpeedMph).toBe(15);
  });

  test('precipitation chance under 30% is hidden', () => {
    const model = weatherDisplayModel({ temperatureF: 60, windSpeedMph: 20, precipitationProbability: 10 });
    expect(model.precipitationProbability).toBeNull();
  });

  test('precipitation chance at or above 30% is shown', () => {
    const model = weatherDisplayModel({ temperatureF: 60, windSpeedMph: 20, precipitationProbability: 30 });
    expect(model.precipitationProbability).toBe(30);
  });

  // ADR 0038: indoor games carry no weather at all; the server already models
  // that as a null `weather`, so the detail model has nothing to hide - it
  // reads through as no weather at all rather than an object of nulls.
  test('indoor hides weather entirely (a null weather field reads through as null)', () => {
    expect(weatherDisplayModel(null)).toBeNull();
  });
});

describe('recordsDisplayModel', () => {
  const records = {
    home: { total: '8-2', home: '5-0' },
    away: { total: '3-7', road: '1-5' },
  };

  test('a normal (non-neutral) site shows the split each team is about to play in', () => {
    const model = recordsDisplayModel(records, { neutralSite: false });
    expect(model.home).toBe('5-0');
    expect(model.away).toBe('1-5');
  });

  test('a neutral site drops the split and keeps the total', () => {
    const model = recordsDisplayModel(records, { neutralSite: true });
    expect(model.home).toBe('8-2');
    expect(model.away).toBe('3-7');
  });

  test('no records at all reads as null', () => {
    expect(recordsDisplayModel(null, { neutralSite: false })).toBeNull();
  });
});

describe('gameDetailModel', () => {
  test('composes the favorite, weather, records, and passes venue/broadcast/situation/linescores/headline through', () => {
    const game = {
      homeTeam: 'DAL',
      awayTeam: 'WAS',
      line: { spread: -3, total: 45 },
      weather: { temperatureF: 70, windSpeedMph: 5, precipitationProbability: 0 },
      venue: { name: 'AT&T Stadium', neutralSite: false, indoor: true },
      broadcast: 'FOX',
      records: { home: { total: '8-2', home: '5-0' }, away: { total: '3-7', road: '1-5' } },
      situation: { possession: 'DAL', downDistance: '2nd & 7' },
      linescores: { home: [7, 7, 0, 0], away: [0, 3, 0, 0] },
      headline: 'DAL wins in a blowout',
    };
    const detail = gameDetailModel(game);
    expect(detail.favorite).toBe('DAL');
    expect(detail.weather.windSpeedMph).toBeNull(); // under 15 mph
    expect(detail.records).toEqual({ home: '5-0', away: '1-5' });
    expect(detail.venue).toEqual(game.venue);
    expect(detail.broadcast).toBe('FOX');
    expect(detail.situation).toEqual(game.situation);
    expect(detail.linescores).toEqual(game.linescores);
    expect(detail.headline).toBe(game.headline);
  });

  test('a game with none of the optional detail fields resolves every field to null', () => {
    const detail = gameDetailModel({ homeTeam: 'DAL', awayTeam: 'WAS' });
    expect(detail).toEqual({
      favorite: null,
      line: null,
      weather: null,
      venue: null,
      broadcast: null,
      records: null,
      situation: null,
      linescores: null,
      headline: null,
    });
  });
});
