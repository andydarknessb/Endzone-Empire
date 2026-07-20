import { test, expect } from '@playwright/test';
import { browserJsonRequest, installIsolatedNetwork } from './fixtures/network-isolation';
import { fixtureTokens, securityData } from './fixtures/security-data';

test('regular manager cannot escalate a trade from PENDING_REVIEW to APPROVED', async ({ page }) => {
  const tradeState = { status: securityData.trade.originalStatus };
  const rejectEscalation = ({ headers }: { headers: Record<string, string> }) => {
    if (headers.authorization !== `Bearer ${fixtureTokens.manager}`) {
      return { status: 401, body: { error: 'invalid manager session' } };
    }
    return { status: 403, body: { error: 'commissioner authorization required' } };
  };
  const tradePath = `/api/trades/${securityData.trade.id}`;
  const network = await installIsolatedNetwork(page, [
    { method: 'PATCH', path: tradePath, handle: rejectEscalation },
    { method: 'PUT', path: tradePath, handle: rejectEscalation },
  ]);

  for (const method of ['PATCH', 'PUT']) {
    const response = await browserJsonRequest(page, tradePath, method, {
      status: securityData.trade.maliciousStatus,
      previousStatus: securityData.trade.originalStatus,
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'commissioner authorization required' });
    expect(tradeState.status).toBe('PENDING_REVIEW');
  }

  expect(network.calls.map(({ method }) => method)).toEqual(['PATCH', 'PUT']);
  expect(network.blocked).toEqual([]);
  expect(network.websocketAttempts).toEqual([]);
});
