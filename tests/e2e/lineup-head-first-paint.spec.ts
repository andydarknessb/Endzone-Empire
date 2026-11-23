// The Lineup head holds its size when the pixel face arrives (#3021). Its team name is the Press Start 2P h1: a phone
// visit whose head paints before that face lands lays the name out in the fallback monospace (one line), then re-wraps
// it to two lines when the face arrives, and the head grows. The face's response is held back here so the race happens
// on every run; a hinted visit warms the face at load but still paints first when the face is slow.
import { expect, test } from '@playwright/test';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from './fixtures/wave3LineupFixtures';

// The head paints at about 1.2 s on the wave-3 fixture; the face is held past that so the race happens on every run.
const FACE_DELAY_MS = 3000;
const FACE = /PressStart2P.*\.woff2/;
const TEAM_NAME = { level: 1, name: 'Darkness Falls' } as const;

// The head's box and its team-name h1 at this moment.
const headBox = () => {
  const head = document.querySelector('[data-testid="lineup-head"]');
  const h1 = head?.querySelector('h1');
  if (!head || !h1) return null;
  const headRect = head.getBoundingClientRect();
  const h1Rect = h1.getBoundingClientRect();
  return { headTop: headRect.top, headHeight: headRect.height, h1Top: h1Rect.top, h1Height: h1Rect.height };
};

test.describe('Lineup head on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const hinted of [false, true]) {
    test(`holds its size when the pixel face arrives (${hinted ? 'with' : 'without'} the session hint)`, async ({ page }) => {
      if (hinted) await page.addInitScript(() => localStorage.setItem('endzone_session_hint', '1'));
      await setupWave3Lineup(page, 'pre', 'light');
      let before: ReturnType<typeof headBox> | undefined;
      await page.route(FACE, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, FACE_DELAY_MS));
        before = await page.evaluate(headBox);
        await route.continue();
      });
      const faceArrived = page.waitForResponse(FACE);

      await page.goto(WAVE3_LINEUP_URL);
      await faceArrived;
      await page.waitForTimeout(300);

      expect(before, 'head measured before the face arrived').toBeTruthy();
      expect(await page.evaluate(headBox), 'head after the face arrived').toEqual(before);
    });
  }
});
