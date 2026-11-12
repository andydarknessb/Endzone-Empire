const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAnonSurface, main } = require('./check-anon-surface');

// Seams: checkAnonSurface with an injected fetch (no network), and main for
// the unset-config path. The expected statuses are ADR 0009's amendment.

function fakeFetch(statusByTable) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const table = new URL(url).pathname.split('/').pop();
    const status = statusByTable[table];
    if (status instanceof Error) throw status;
    return { status };
  };
  return { fetchImpl, calls };
}

const URL_BASE = 'https://example.supabase.co';
const KEY = 'anon-key-value';

test('checkAnonSurface: users 401, refresh_tokens 401, live_game_states 200 passes', async () => {
  const { fetchImpl } = fakeFetch({ users: 401, refresh_tokens: 401, live_game_states: 200 });
  assert.deepEqual(await checkAnonSurface({ url: URL_BASE, anonKey: KEY, fetchImpl }), []);
});

test('checkAnonSurface: a 200 from users fails and names the table', async () => {
  const { fetchImpl } = fakeFetch({ users: 200, refresh_tokens: 401, live_game_states: 200 });
  assert.deepEqual(await checkAnonSurface({ url: URL_BASE, anonKey: KEY, fetchImpl }), [
    'users: expected HTTP 401, got 200',
  ]);
});

test('checkAnonSurface: a network error fails and names the table', async () => {
  const { fetchImpl } = fakeFetch({
    users: 401,
    refresh_tokens: 401,
    live_game_states: new Error('socket hang up'),
  });
  assert.deepEqual(await checkAnonSurface({ url: URL_BASE, anonKey: KEY, fetchImpl }), [
    'live_game_states: network error: socket hang up',
  ]);
});

test('checkAnonSurface: sends the public key as apikey and bearer on each table', async () => {
  const { fetchImpl, calls } = fakeFetch({ users: 401, refresh_tokens: 401, live_game_states: 200 });
  await checkAnonSurface({ url: `${URL_BASE}/`, anonKey: KEY, fetchImpl });
  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.match(url, /^https:\/\/example\.supabase\.co\/rest\/v1\/[a-z_]+\?select=\*&limit=1$/);
    assert.equal(init.headers.apikey, KEY);
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  }
});

test('main: unset SUPABASE_URL or SUPABASE_ANON_KEY exits non-zero without a request', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await main({ SUPABASE_URL: URL_BASE }), 1);
    assert.equal(await main({ SUPABASE_ANON_KEY: KEY }), 1);
  } finally {
    console.error = originalError;
  }
});
