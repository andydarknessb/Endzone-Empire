import { positionKey, positionLabel } from './PosChip';

test('an unknown slot label reads as a flex place, never as a position hue', () => {
  expect(positionKey('BN')).toBe('flex');
  expect(positionKey(null)).toBe('flex');
  expect(positionLabel('DEF')).toBe('D/ST');
  expect(positionLabel('QB')).toBe('QB');
});
