const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function unsignedFixtureJwt(payload: object): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.security-fixture-signature`;
}

export const appOrigin = new URL(
  process.env.SECURITY_BASE_URL || 'http://127.0.0.1:4173'
).origin;

export const fixtureTokens = {
  commissioner:
    process.env.SECURITY_COMMISSIONER_TOKEN ||
    unsignedFixtureJwt({ sub: 1001, username: 'security-commissioner', role: 'commissioner' }),
  manager:
    process.env.SECURITY_MANAGER_TOKEN ||
    unsignedFixtureJwt({ sub: 1002, username: 'security-manager', role: 'manager' }),
};

export const securityData = {
  league: {
    id: 7001,
    currentSeason: 2026,
    currentWeek: 12,
  },
  staleMatchup: {
    id: 8101,
    season: 2026,
    week: 9,
    playerId: 9101,
    originalScore: 17.25,
    maliciousScore: 42.5,
  },
  trade: {
    id: 8201,
    originalStatus: 'PENDING_REVIEW',
    maliciousStatus: 'APPROVED',
  },
};

export const authStatePaths = {
  commissioner: 'test-results/security/.auth/commissioner.json',
  manager: 'test-results/security/.auth/manager.json',
};
