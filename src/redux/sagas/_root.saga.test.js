import rootSaga from './_root.saga';

test('forks exactly the three feature sagas via a single ALL effect', () => {
  const gen = rootSaga();
  const result = gen.next();

  expect(result.done).toBe(false);
  expect(result.value.type).toBe('ALL');
  expect(result.value.payload).toHaveLength(3);
  // Each entry is an already-invoked generator/iterator (loginSaga(), etc.)
  result.value.payload.forEach((forkedIterator) => {
    expect(typeof forkedIterator.next).toBe('function');
  });
});

test('completes after yielding the single ALL effect', () => {
  const gen = rootSaga();
  gen.next();
  expect(gen.next().done).toBe(true);
});
