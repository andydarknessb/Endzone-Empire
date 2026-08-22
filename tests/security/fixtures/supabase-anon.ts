type DenialMode = 'permission-denied' | 'empty-policy-result';

export function createMockAnonSupabase(mode: DenialMode = 'permission-denied') {
  const calls: Array<{ table: string; columns: string }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        return {
          async select(columns: string) {
            calls.push({ table, columns });
            if (mode === 'empty-policy-result') {
              return { data: [], error: null, status: 200 };
            }
            return {
              data: null,
              status: 403,
              error: {
                code: '42501',
                message: 'permission denied for table leagues',
                details: null,
                hint: null,
              },
            };
          },
        };
      },
    },
  };
}
