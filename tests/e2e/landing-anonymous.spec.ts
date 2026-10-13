import { expect, test, type Page } from '@playwright/test';
import { json } from './fixtures/jsonRoute';

// An anonymous first visit to the landing page: nothing is signed in, so the
// refresh cookie is absent and the API answers "no session" without a body.
async function mockAnonymousApi(page: Page) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/api/auth/refresh') {
      return route.fulfill({ status: 204 });
    }
    if (request.method() === 'GET' && path === '/api/public/rankings') {
      return json(route, 200, {
        rankings: [
          { playerId: 101, rank: 1, name: 'Josh Allen', projectedPoints: 24.8 },
          { playerId: 102, rank: 2, name: 'Christian McCaffrey', projectedPoints: 22.1 },
          { playerId: 103, rank: 3, name: 'Justin Jefferson', projectedPoints: 20.4 },
        ],
      });
    }
    if (request.method() === 'GET' && path === '/api/public/recaps') {
      return json(route, 200, {
        recaps: [
          {
            gameId: '20260112_KC@BUF',
            awayTeam: 'KC',
            awayScore: 27,
            homeScore: 24,
            homeTeam: 'BUF',
            week: 5,
            hook: 'Mahomes answers late to steal one in Buffalo.',
          },
        ],
      });
    }
    return json(route, 404, { error: 'not found' });
  });
}

test.describe('anonymous landing page', () => {
  test.use({ viewport: { width: 412, height: 823 } });

  test('cold visit to / has no layout shift', async ({ page }) => {
    await mockAnonymousApi(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node }[];
        }[]) {
          if (entry.hadRecentInput) continue;
          w.__shifts.push({
            value: entry.value,
            sources: (entry.sources || []).map((s) => (s.node as Element | undefined)?.nodeName || '?'),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Let any shift from the last paints reach the observer.
    await page.waitForTimeout(500);

    const shifts = await page.evaluate(
      () => (window as unknown as { __shifts: { value: number; sources: string[] }[] }).__shifts,
    );
    const total = shifts.reduce((sum, s) => sum + s.value, 0);
    expect(total, `layout shifts: ${JSON.stringify(shifts)}`).toBe(0);
  });

  test('anonymous visit makes no /api/user request and logs no console errors', async ({ page }) => {
    await mockAnonymousApi(page);
    const consoleErrors: string[] = [];
    const requestPaths: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => requestPaths.push(new URL(request.url()).pathname));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(requestPaths).not.toContain('/api/user');
    expect(consoleErrors).toEqual([]);
  });
});
