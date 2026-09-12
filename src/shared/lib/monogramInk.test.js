import { monogramInk } from './monogramInk';
import { NFL_TEAM_COLORS, FALLBACK_KIT } from '../../lib/nflTeamColors';

test('white ink for a jersey that clears 4.5:1 against white', () => {
  expect(monogramInk(NFL_TEAM_COLORS.DET.jersey)).toBe('#ffffff');
});

test('black ink for each of the four jerseys that fall below 4.5:1 against white', () => {
  expect(monogramInk(NFL_TEAM_COLORS.CIN.jersey)).toBe('#000000');
  expect(monogramInk(NFL_TEAM_COLORS.MIA.jersey)).toBe('#000000');
  expect(monogramInk(NFL_TEAM_COLORS.CAR.jersey)).toBe('#000000');
  expect(monogramInk(NFL_TEAM_COLORS.LAC.jersey)).toBe('#000000');
});

test('black ink for the neutral fallback kit, which fails white by a wide margin', () => {
  expect(monogramInk(FALLBACK_KIT.jersey)).toBe('#000000');
});
