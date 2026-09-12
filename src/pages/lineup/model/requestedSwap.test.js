import { readRequestedSwap, resolveRequestedSwap } from './requestedSwap';

test('reads a valid swapOut/swapIn pair', () => {
  const params = new URLSearchParams({ swapOut: '11', swapIn: '12' });
  expect(readRequestedSwap(params)).toEqual({ outId: 11, inId: 12 });
});

test('a missing param, a non-integer, or a self-referring pair all read as null', () => {
  expect(readRequestedSwap(new URLSearchParams({ swapOut: '11' }))).toBeNull();
  expect(readRequestedSwap(new URLSearchParams({ swapOut: 'x', swapIn: '12' }))).toBeNull();
  expect(readRequestedSwap(new URLSearchParams({ swapOut: '11', swapIn: '11' }))).toBeNull();
  expect(readRequestedSwap(new URLSearchParams())).toBeNull();
});

const entry = (overrides = {}) => ({ playerId: 1, locked: false, spent: false, ...overrides });

test('resolves both entries when they exist and are movable', () => {
  const out = entry({ playerId: 11 });
  const inn = entry({ playerId: 12 });
  const resolved = resolveRequestedSwap({ outId: 11, inId: 12 }, [out, inn]);
  expect(resolved).toEqual({ outEntry: out, inEntry: inn });
});

test('a missing entry, a locked entry, or a spent entry all refuse the offer', () => {
  const out = entry({ playerId: 11 });
  const inn = entry({ playerId: 12 });
  expect(resolveRequestedSwap({ outId: 11, inId: 99 }, [out, inn])).toBeNull();
  expect(resolveRequestedSwap({ outId: 11, inId: 12 }, [{ ...out, locked: true }, inn])).toBeNull();
  expect(resolveRequestedSwap({ outId: 11, inId: 12 }, [out, { ...inn, spent: true }])).toBeNull();
});

test('a null requestedSwap or entries never throws', () => {
  expect(resolveRequestedSwap(null, [])).toBeNull();
  expect(resolveRequestedSwap({ outId: 1, inId: 2 }, null)).toBeNull();
});
