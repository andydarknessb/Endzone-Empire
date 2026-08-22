import { test as setup, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appOrigin, authStatePaths, fixtureTokens } from './fixtures/security-data';

function storageState(role: 'commissioner' | 'manager') {
  return {
    cookies: [],
    origins: [
      {
        origin: appOrigin,
        localStorage: [
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
    await writeFile(outputPath, JSON.stringify(storageState(role), null, 2));
  }

  expect(fixtureTokens.commissioner.split('.')).toHaveLength(3);
  expect(fixtureTokens.manager.split('.')).toHaveLength(3);
});
