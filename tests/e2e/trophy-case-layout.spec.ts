/**
 * Layout guard for the League Dashboard Trophy Case (#1986, spec #1979 L16 to L19).
 *
 * The audit fixture had no trophies, so the card self-hid and was never
 * rendered. At Week 17 it listed every award of the season as a pill: 3644px
 * tall at 390 (1280px at 1440). jsdom has no layout engine, so the bound on
 * the RENDERED height lives here, in headless Chromium: collapsed, the card
 * stays within a phone's two screens, and expanding everything (the negative
 * control) is what makes the predicate go red.
 *
 * Ruling (#2330, ADR 0067): the dashboard's trophy room is the completed season's frame. Collapsed it
 * lists the first rows of the season's awards (COLLAPSED_ROWS) and "Show all N awards" opens the rest, so
 * the frame does not grow with the season. Mid-season the room is one link row to the trophy case page, which
 * is not measured here. The per-team tally the old card carried (top five by total, the viewer's row kept)
 * is not part of the trophy room on the boards, so its bound is gone. The 12-team variant (six Teams only
 * the trophies know about) holds the same bounds as the 6-team league.
 *
 * Fixture: `leagueDashboardPlayselectFixtures`' `setupDashboard(page, 'complete')` (the completed-season
 * league row, so the room is a frame) plus a routed `/api/league/4200/trophies` (trophyCaseFixtures.ts)
 * registered after it so it wins.
 *
 * What this does NOT cover: the card's colors in either theme (the tokens
 * contrast test owns pairings) and the other dashboard cards' geometry
 * (league-dashboard-layout.spec.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { setupDashboard, DASH_URL } from './fixtures/leagueDashboardPlayselectFixtures';
import { routeWeek17Trophies } from './fixtures/trophyCaseFixtures';

// The phone bound is 940 (was 820): the Play-select frame lists six awards one to a row, each a pixel
// cup or star beside two lines, which measures 912 at 360 and 888 at 390. A frame of every award is more
// than three times that, so the bound still goes red (the negative control below).
const PHONE_SMALL = { width: 360, height: 800, maxCardHeight: 940 };
const PHONE = { width: 390, height: 844, maxCardHeight: 940 };
const DESKTOP = { width: 1440, height: 900, maxCardHeight: 640 };

async function gotoTrophyCase(page: Page, width: number, height: number, teamCount = 6) {
  await setupDashboard(page, 'complete');
  await routeWeek17Trophies(page, teamCount);
  await page.setViewportSize({ width, height });
  await page.goto(DASH_URL);
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

for (const teamCount of [6, 12]) {
  for (const { width, height, maxCardHeight } of [PHONE_SMALL, PHONE, DESKTOP]) {
    test(`Trophy Case, ${teamCount} teams @ ${width}x${height}: collapsed, the card is ${maxCardHeight}px tall or less`, async ({ page }) => {
      await gotoTrophyCase(page, width, height, teamCount);
      const h = await page.evaluate(probeCardHeight);
      expect(h, 'trophy-case must be found').not.toBeNull();
      expect(h as number, `${teamCount} teams @ ${width}: trophy-case height=${h}`).toBeLessThanOrEqual(maxCardHeight);
    });
  }
}

for (const width of [320, 360, 390]) {
  test(`Trophy Case @ ${width}: the document has no horizontal scroll`, async ({ page }) => {
    await gotoTrophyCase(page, width, 844);
    const doc = await page.evaluate(probeDocumentWidth);
    expect(doc.scrollWidth, `@ ${width}: scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
  });
}

// Permanent negative control: expanding every award row must push the card past
// the phone bound, proving the height predicate can still go red on every run.
test('negative control: expanding both lists trips the height predicate', async ({ page }) => {
  await gotoTrophyCase(page, PHONE.width, PHONE.height, 12);
  const collapsed = await page.evaluate(probeCardHeight);
  expect(collapsed as number, `collapsed height=${collapsed}`).toBeLessThanOrEqual(PHONE.maxCardHeight);

  await page.getByTestId('trophy-show-all').click();
  const expanded = await page.evaluate(probeCardHeight);
  expect(expanded as number, `expanded height=${expanded}`).toBeGreaterThan(PHONE.maxCardHeight);
});
