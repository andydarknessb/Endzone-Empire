// On a signed-in visit the Play-select faces are asked for before /api/user answers, so before the user is known
// (warmFonts, src/shared/ui/playselect/type.js). Anonymous visits to / and to a public path request neither.
import { expect, test } from '@playwright/test';
import { mockAnonymousApi } from './fixtures/anonymousApi';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from './fixtures/wave3LineupFixtures';

const PIXEL_FACE = /PressStart2P.*\.woff2/;
const BODY_FACE = /Archivo.*\.woff2/;

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

    expect(userAnswered, 'the /api/user hold never ran').toBe(true);
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

  test.describe('hinted visit to a public path', () => {
    test.use({ viewport: { width: 412, height: 823 } });

    test('a hinted visit to /rankings requests neither face', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('endzone_session_hint', '1'));
      await mockAnonymousApi(page);
      const faceRequests: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (PIXEL_FACE.test(url) || BODY_FACE.test(url)) faceRequests.push(url);
      });

      await page.goto('/rankings');
      await expect(page.getByText('Josh Allen', { exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      expect(faceRequests).toEqual([]);
    });
  });
});
