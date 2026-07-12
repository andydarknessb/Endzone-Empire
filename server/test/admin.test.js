const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlatformAdmin } = require('../modules/auth');

test('isPlatformAdmin matches ids from PLATFORM_ADMIN_IDS', () => {
  const prev = process.env.PLATFORM_ADMIN_IDS;
  try {
    process.env.PLATFORM_ADMIN_IDS = '1, 42,7';
    assert.equal(isPlatformAdmin(1), true);
    assert.equal(isPlatformAdmin(42), true);
    assert.equal(isPlatformAdmin('42'), true); // JWT sub may arrive stringly
    assert.equal(isPlatformAdmin(2), false);
  } finally {
    process.env.PLATFORM_ADMIN_IDS = prev;
  }
});

test('isPlatformAdmin denies everyone when unset, empty, or malformed', () => {
  const prev = process.env.PLATFORM_ADMIN_IDS;
  try {
    delete process.env.PLATFORM_ADMIN_IDS;
    assert.equal(isPlatformAdmin(1), false);
    process.env.PLATFORM_ADMIN_IDS = '';
    assert.equal(isPlatformAdmin(1), false);
    process.env.PLATFORM_ADMIN_IDS = 'abc, ,NaN';
    assert.equal(isPlatformAdmin(1), false);
    assert.equal(isPlatformAdmin(NaN), false);
  } finally {
    if (prev === undefined) delete process.env.PLATFORM_ADMIN_IDS;
    else process.env.PLATFORM_ADMIN_IDS = prev;
  }
});
