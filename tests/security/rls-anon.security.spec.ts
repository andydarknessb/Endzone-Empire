import { test, expect } from '@playwright/test';
import { createMockAnonSupabase } from './fixtures/supabase-anon';

for (const denialMode of ['permission-denied', 'empty-policy-result'] as const) {
  test(`anonymous leagues.invite_code probe is denied via ${denialMode}`, async () => {
    const { client, calls } = createMockAnonSupabase(denialMode);

    const { data, error, status } = await client.from('leagues').select('invite_code');

    const strictPostgrestDenial =
      status === 403 &&
      error?.code === '42501' &&
      /permission denied|row.level security/i.test(error.message);
    const emptyRlsResult = status === 200 && error === null && Array.isArray(data) && data.length === 0;

    expect(strictPostgrestDenial || emptyRlsResult).toBe(true);
    if (data == null) expect(data).toBeNull();
    else expect(data).toEqual([]);
    expect(calls).toEqual([{ table: 'leagues', columns: 'invite_code' }]);
  });
}
