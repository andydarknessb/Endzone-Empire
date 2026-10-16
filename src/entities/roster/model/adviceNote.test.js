import { adviceNote } from './adviceNote';

const swap = (inName, outName, gain, out = false) => ({
  slot: 'WR',
  gain,
  current: { playerId: 1, name: outName, ...(out ? { startVerdict: { outcome: 'unavailable', reason: 'out' } } : null) },
  suggested: { playerId: 2, name: inName },
});

describe('adviceNote', () => {
  test('one swap names both players and the gain, as the dashboard lead card has always read', () => {
    expect(adviceNote({ suggestions: [swap('Jordan Addison', 'Puka Nacua', 23.04)] }))
      .toBe('Start Jordan Addison for Puka Nacua · +23.0 pts');
  });

  test('one open-slot fill names the slot', () => {
    expect(adviceNote({ openSlotFills: [{ slot: 'FLEX', name: 'Tyjae Spears', projection: 12.9 }] }))
      .toBe('Start Tyjae Spears at FLEX · +12.9 pts');
  });

  test('two moves name each one behind the summed gain, with the Out reason', () => {
    expect(adviceNote({
      suggestions: [swap('Jordan Addison', 'Puka Nacua', 10.1, true)],
      openSlotFills: [{ slot: 'FLEX', name: 'Tyjae Spears', projection: 12.9 }],
    })).toBe('Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX');
  });

  test('a move with no figure is named and adds nothing; no figure at all drops the gain', () => {
    expect(adviceNote({ suggestions: [swap('Jordan Addison', 'Puka Nacua', null)] }))
      .toBe('Start Jordan Addison for Puka Nacua');
  });

  test('no move, no note', () => {
    expect(adviceNote({ suggestions: [], openSlotFills: [] })).toBeNull();
    expect(adviceNote()).toBeNull();
  });
});
