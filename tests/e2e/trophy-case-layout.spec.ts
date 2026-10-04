/**
 * Layout guard for the League Dashboard Trophy Case (#1986, spec #1979 L16 to L19).
 *
 * The audit fixture had no trophies, so the card self-hid and was never
 * rendered. At Week 17 it listed every award of the season as a pill: 3644px
 * tall at 390 (1280px at 1440). jsdom has no layout engine, so the bound on
 * the RENDERED height lives here, in headless Chromium: collapsed (6 award
 * rows), the card stays within a phone's two screens, and expanding all rows
 * (the negative control) is what makes the predicate go red.
 *
 * Fixture: `layoutGuardFixtures`' `setupLayoutGuard` plus a routed
 * `/api/league/4200/trophies` (trophyCaseFixtures.ts) registered after it so
 * it wins over the guard's catch-all.
 *
 * What this does NOT cover: the card's colors in either theme (the tokens
 * contrast test owns pairings) and the other dashboard cards' geometry
 * (league-dashboard-layout.spec.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { setupLayoutGuard, DASHBOARD_URL } from './fixtures/layoutGuardFixtures';
import { routeWeek17Trophies } from './fixtures/trophyCaseFixtures';

const PHONE = { width: 390, height: 844, maxCardHeight: 820 };
const DESKTOP = { width: 1440, height: 900, maxCardHeight: 640 };

async function gotoTrophyCase(page: Page, width: number, height: number) {
  await setupLayoutGuard(page);
  await routeWeek17Trophies(page);
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD_URL);
  await page.getByTestId('trophy-case').waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/** The card's bounding-box height, or null when it is absent. */
function probeCardHeight() {
  const el = document.querySelector('[data-testid="trophy-case"]');
  return el ? el.getBoundingClientRect().height : null;
}

function probeDocumentWidth() {
  const el = document.documentElement;
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}

for (const { width, height, maxCardHeight } of [PHONE, DESKTOP]) {
  test(`Trophy Case @ ${width}x${height}: collapsed, the card is ${maxCardHeight}px tall or less`, async ({ page }) => {
    await gotoTrophyCase(page, width, height);
    const h = await page.evaluate(probeCardHeight);
    expect(h, 'trophy-case must be found').not.toBeNull();
    expect(h as number, `@ ${width}: trophy-case height=${h}`).toBeLessThanOrEqual(maxCardHeight);
  });
}

for (const width of [320, 390]) {
  test(`Trophy Case @ ${width}: the document has no horizontal scroll`, async ({ page }) => {
    await gotoTrophyCase(page, width, 844);
    const doc = await page.evaluate(probeDocumentWidth);
    expect(doc.scrollWidth, `@ ${width}: scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
  });
}

// Permanent negative control: expanding every award row must push the card past
// the phone bound, proving the height predicate can still go red on every run.
test('negative control: expanding all awards trips the height predicate', async ({ page }) => {
  await gotoTrophyCase(page, PHONE.width, PHONE.height);
  const collapsed = await page.evaluate(probeCardHeight);
  expect(collapsed as number, `collapsed height=${collapsed}`).toBeLessThanOrEqual(PHONE.maxCardHeight);

  await page.getByTestId('trophy-show-all').click();
  const expanded = await page.evaluate(probeCardHeight);
  expect(expanded as number, `expanded height=${expanded}`).toBeGreaterThan(PHONE.maxCardHeight);
});
