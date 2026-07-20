import { test as setup, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appOrigin, authStatePaths, fixtureTokens } from './fixtures/security-data';

function storageState(token: string, role: 'commissioner' | 'manager') {
  return {
    cookies: [],
    origins: [
      {
        origin: appOrigin,
        localStorage: [
          { name: 'endzone_token', value: token },
          { name: 'endzone_refresh', value: `fixture-refresh-${role}` },
          { name: 'endzone_security_role', value: role },
        ],
      },
    ],
  };
}

setup('write pre-baked commissioner and manager storage states', async () => {
  for (const role of ['commissioner', 'manager'] as const) {
    const outputPath = authStatePaths[role];
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(storageState(fixtureTokens[role], role), null, 2));
  }

  expect(fixtureTokens.commissioner.split('.')).toHaveLength(3);
  expect(fixtureTokens.manager.split('.')).toHaveLength(3);
});
