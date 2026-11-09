#!/usr/bin/env node
// ADR 0009 (2026-11-09 amendment): the anon key ships in the public bundle, so
// table grants are the control. Probe PostgREST with the public key: users and
// refresh_tokens must refuse (401), live_game_states must answer (200). Any
// other status, or a network error, names the table and exits non-zero.

const EXPECTED = [
  { table: 'users', status: 401 },
  { table: 'refresh_tokens', status: 401 },
  { table: 'live_game_states', status: 200 },
];

async function checkAnonSurface({ url, anonKey, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  const failures = [];
  for (const { table, status } of EXPECTED) {
    let got;
    try {
      const res = await fetchImpl(`${base}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(20000),
      });
      got = res.status;
    } catch (err) {
      failures.push(`${table}: network error: ${err.message}`);
      continue;
    }
    if (got !== status) failures.push(`${table}: expected HTTP ${status}, got ${got}`);
  }
  return failures;
}

async function main(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const anonKey = env.SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    console.error('check-anon-surface: SUPABASE_URL and SUPABASE_ANON_KEY must both be set');
    return 1;
  }
  const failures = await checkAnonSurface({ url, anonKey });
  for (const failure of failures) console.error(`check-anon-surface: FAIL ${failure}`);
  if (failures.length) return 1;
  console.log(`check-anon-surface: ok (${EXPECTED.map((e) => `${e.table} ${e.status}`).join(', ')})`);
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { EXPECTED, checkAnonSurface, main };
