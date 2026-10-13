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

// LoginForm.css, RegisterForm.css and App.css all define a global .formPanel
// and .alert. App.css must win (as it did when they shared one stylesheet), so
// a cold load of either route must show App's panel, not the lazy chunk's.
test.describe('cold /login and /registration keep the App.css form panel', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ['registration', 'login']) {
    test(`/#/${route} does not overflow sideways and uses App.css's .formPanel`, async ({ page }) => {
      await mockAnonymousApi(page);
      await page.goto(`/#/${route}`);
      const panel = page.locator('.formPanel');
      await expect(panel).toBeVisible();
      await page.waitForLoadState('networkidle');

      const m = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.formPanel') as Element);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          maxWidth: cs.maxWidth,
          paddingTop: cs.paddingTop,
          marginTop: cs.marginTop,
        };
      });
      expect(m.scrollWidth, JSON.stringify(m)).toBeLessThanOrEqual(m.innerWidth);
      // App.css: max-width: 100%; padding: 25px; margin: 0 auto 20px.
      expect(m.maxWidth).toBe('100%');
      expect(m.paddingTop).toBe('25px');
      expect(m.marginTop).toBe('0px');
    });
  }
});

test.describe('landing to registration', () => {
  test.use({ viewport: { width: 412, height: 823 } });

  test('the Create Your League Now CTA opens the form without a page spinner', async ({ page }) => {
    await mockAnonymousApi(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __spinnerSeen: boolean };
      w.__spinnerSeen = false;
      const check = () => {
        if (document.querySelector('[role="status"][aria-label="Loading page"]')) w.__spinnerSeen = true;
      };
      new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Preloading runs on idle after first paint; give it the same breathing room a visitor's read gives it.
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');

    await page.locator('a[href="#/registration"]', { hasText: 'Create Your League Now' }).click();
    await expect(page.locator('.formPanel')).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __spinnerSeen: boolean }).__spinnerSeen);
    expect(seen, 'the Loading page spinner appeared between landing and registration').toBe(false);
  });
});
