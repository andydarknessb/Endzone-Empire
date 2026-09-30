import { FIELD_GREEN, colorDistance, CONTRAST_THRESHOLD } from '../../../shared/lib';
import { kitForTeam, TEAM_KITS } from './teamKit';

test('the same Team id always gets the same kit', () => {
  expect(kitForTeam(42)).toBe(kitForTeam(42));
  expect(kitForTeam('42')).toBe(kitForTeam(42));
  expect(kitForTeam(7, TEAM_KITS[1])).toBe(kitForTeam(7, TEAM_KITS[1]));
});

test('different Team ids spread across the palette', () => {
  const jerseys = new Set(Array.from({ length: 60 }, (_, id) => kitForTeam(id + 1).jersey));
  expect(jerseys.size).toBeGreaterThan(4);
});

test('a kit too close to the field green is moved to one that reads against it', () => {
  const ids = Array.from({ length: 200 }, (_, id) => id + 1);
  ids.forEach((id) => {
    expect(colorDistance(kitForTeam(id).jersey, FIELD_GREEN)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
  });
  // The palette holds a green kit, so at least one id hashed onto it and moved.
  expect(TEAM_KITS.some((k) => colorDistance(k.jersey, FIELD_GREEN) < CONTRAST_THRESHOLD)).toBe(true);
});

test('a kit that matches the opponent jersey is moved away from it', () => {
  const ids = Array.from({ length: 200 }, (_, id) => id + 1);
  const moved = ids.filter((id) => kitForTeam(id) === TEAM_KITS[0]);
  expect(moved.length).toBeGreaterThan(0);
  moved.forEach((id) => {
    const kit = kitForTeam(id, TEAM_KITS[0]);
    expect(kit).not.toBe(TEAM_KITS[0]);
    expect(colorDistance(kit.jersey, TEAM_KITS[0].jersey)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
  });
});

test('every kit carries the four sprite roles', () => {
  TEAM_KITS.forEach((kit) => {
    ['helmet', 'jersey', 'pants', 'accent'].forEach((role) => expect(kit[role]).toMatch(/^#[0-9a-f]{6}$/));
  });
});
