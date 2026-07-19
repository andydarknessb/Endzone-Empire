const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNewsItems, MAX_ITEMS } = require('../services/news.service');

test('normalizeNewsItems keeps only title and link', () => {
  const out = normalizeNewsItems([
    { title: 'Headline one', link: 'https://example.com/one', extra: 'ignored' },
    { title: 'Headline two', link: 'https://example.com/two' },
  ]);
  assert.deepEqual(out, [
    { title: 'Headline one', link: 'https://example.com/one' },
    { title: 'Headline two', link: 'https://example.com/two' },
  ]);
});

test('normalizeNewsItems caps the list at MAX_ITEMS', () => {
  const items = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({
    title: `Headline ${i}`,
    link: `https://example.com/${i}`,
  }));
  assert.equal(normalizeNewsItems(items).length, MAX_ITEMS);
});

test('normalizeNewsItems tolerates a missing/empty payload', () => {
  assert.deepEqual(normalizeNewsItems(null), []);
  assert.deepEqual(normalizeNewsItems(undefined), []);
  assert.deepEqual(normalizeNewsItems([]), []);
});
