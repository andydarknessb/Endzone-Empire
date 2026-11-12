// Play-select's two faces are asked for at boot on a signed-in visit (warmFonts, src/shared/ui/playselect/type.js),
// so they are in before the first Play-select page paints. An anonymous visit to / uses neither face and asks for none.
import { expect, test, type Page } from '@playwright/test';
import { json } from './fixtures/jsonRoute';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from './fixtures/wave3LineupFixtures';

const PIXEL_FACE = /PressStart2P.*\.woff2/;
const BODY_FACE = /Archivo.*\.woff2/;

// Mirrors landing-anonymous.spec.ts's routing so the anonymous landing renders the way it does there.
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

test.describe('Play-select font warm-up', () => {
  test('a signed-in visit asks for both faces before /api/user is answered', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('endzone_session_hint', '1'));
    await setupWave3Lineup(page, 'pre', 'dark');
    let userAnswered = false;
    await page.route('**/api/user', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      userAnswered = true;
      await route.fallback();
    });
    const startedBeforeAnswer = { pixel: false, body: false };
    page.on('request', (request) => {
      const url = request.url();
      if (PIXEL_FACE.test(url)) startedBeforeAnswer.pixel ||= !userAnswered;
      if (BODY_FACE.test(url)) startedBeforeAnswer.body ||= !userAnswered;
    });

    await page.goto(WAVE3_LINEUP_URL);
    await expect(page.getByTestId('ledger-starters')).toBeVisible();

    expect(startedBeforeAnswer.pixel, 'Press Start 2P requested before /api/user answered').toBe(true);
    expect(startedBeforeAnswer.body, 'Archivo requested before /api/user answered').toBe(true);
  });

  test.describe('anonymous landing', () => {
    test.use({ viewport: { width: 412, height: 823 } });

    test('an anonymous visit to / requests neither face', async ({ page }) => {
      await mockAnonymousApi(page);
      const faceRequests: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (PIXEL_FACE.test(url) || BODY_FACE.test(url)) faceRequests.push(url);
      });

      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      expect(faceRequests).toEqual([]);
    });
  });
});
