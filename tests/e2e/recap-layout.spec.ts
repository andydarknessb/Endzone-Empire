/**
 * Layout guard for the League Dashboard Weekly Recap (#1988, spec #1979
 * L20 to L23).
 *
 * jsdom has no layout engine, so what the recap costs on screen is measured in
 * headless Chromium and bound here, the same split as league-dashboard-layout.spec.ts:
 * the jsdom tests (RecapCard.test.jsx, LeagueDashboardPage.test.jsx) bind the
 * rules, this spec binds the rendered result. The dashboard guard's fixture has
 * no recap, so the card self-hides there and was never measured; this spec routes
 * a busy-week recap in (fixtures/recapFixtures.ts: ten sentences, four facts) on
 * top of `setupLayoutGuard`. The recap route is registered AFTER setupLayoutGuard
 * so it wins over the guard's catch-all API handler.
 *
 * Measured before this ticket (integration 34fc950a): at 390x844 the card was
 * 1003px tall and the matchup card started at y=2309; at 1440x900 the card was
 * 430px and pushed the hero to y=851, below the fold.
 *
 * Negative controls: the placement bound is proved able to fail by moving the
 * recap back above the hero in the live DOM (the matchup top must then move),
 * and the height bound by the expanded card, which must exceed the collapsed
 * bound at the phone width.
 *
 * Chromium-only (the e2e config declares no projects); picked up by
 * `npm run test:e2e` with no workflow edit.
 */
import { expect, test, type Page } from '@playwright/test';
import { setupLayoutGuard, DASHBOARD_URL } from './fixtures/layoutGuardFixtures';
import { RECAP_PAYLOAD, RECAP_URL_PATTERN } from './fixtures/recapFixtures';

const PHONE = { width: 390, height: 844, maxCollapsed: 480 };
const DESKTOP = { width: 1440, height: 900, maxCollapsed: 380 };
const TOP_TOLERANCE = 2;

type Recap = 'present' | 'missing';

async function openDashboard(page: Page, viewport: { width: number; height: number }, recap: Recap) {
  await setupLayoutGuard(page);
  // Registered after the guard's catch-all so it is matched first.
  await page.route(RECAP_URL_PATTERN, (route) =>
    recap === 'present'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RECAP_PAYLOAD) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) })
  );
  await page.setViewportSize(viewport);
  await page.goto(DASHBOARD_URL);
  await page.getByTestId('commissioner-strip-facts').waitFor({ state: 'attached' });
  await page.getByTestId('my-team-summary').waitFor();
  await page.getByTestId('matchup-preview').waitFor();
  await page.getByTestId('around-the-league-tile').first().waitFor();
  await page.getByTestId('recent-activity-row').first().waitFor();
  if (recap === 'present') await page.getByTestId('recap-card').waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/** Document-space top of a card, and its height. */
function probeBox(testId: string) {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { top: rect.top + window.scrollY, height: rect.height };
}

function probeDocumentWidth() {
  const el = document.documentElement;
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}

for (const vp of [PHONE, DESKTOP]) {
  const label = `${vp.width}x${vp.height}`;

  test(`Recap @ ${label}: the matchup card sits where it does with no recap`, async ({ page, context }) => {
    await openDashboard(page, vp, 'missing');
    const without = await page.evaluate(probeBox, 'matchup-preview');
    expect(without, 'matchup-preview must render without a recap').not.toBeNull();

    const withRecapPage = await context.newPage();
    await openDashboard(withRecapPage, vp, 'present');
    const withRecap = await withRecapPage.evaluate(probeBox, 'matchup-preview');
    const card = await withRecapPage.evaluate(probeBox, 'recap-card');
    console.log(`[recap-layout] @ ${label}: matchup top ${without!.top} (no recap) vs ${withRecap!.top} (recap); recap card top=${card!.top} height=${card!.height}`);

    expect(
      Math.abs(withRecap!.top - without!.top),
      `@ ${label}: matchup top ${withRecap!.top} with the recap vs ${without!.top} without`
    ).toBeLessThanOrEqual(TOP_TOLERANCE);
    // The recap follows the hero, never precedes it.
    expect(card!.top).toBeGreaterThan(withRecap!.top);
  });

  test(`Recap @ ${label}: collapsed it stays within ${vp.maxCollapsed}px, and expanding makes it taller`, async ({ page }) => {
    await openDashboard(page, vp, 'present');

    const toggle = page.getByTestId('recap-toggle');
    await expect(toggle, 'a ten-sentence recap overflows 3 lines, so the toggle must render').toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const collapsed = await page.evaluate(probeBox, 'recap-card');
    console.log(`[recap-layout] @ ${label}: recap card collapsed height=${collapsed!.height}`);
    expect(collapsed!.height, `@ ${label}: collapsed recap card height`).toBeLessThanOrEqual(vp.maxCollapsed);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const expanded = await page.evaluate(probeBox, 'recap-card');
    console.log(`[recap-layout] @ ${label}: recap card expanded height=${expanded!.height}`);
    expect(expanded!.height).toBeGreaterThan(collapsed!.height);

    // Negative control for the height bound: left open at the phone width the
    // narrative is what blows the bound, so the bound is able to fail.
    if (vp === PHONE) expect(expanded!.height).toBeGreaterThan(vp.maxCollapsed);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
}

test('Recap @ 320: the document never scrolls horizontally, collapsed or expanded', async ({ page }) => {
  await openDashboard(page, { width: 320, height: 800 }, 'present');
  for (const state of ['collapsed', 'expanded']) {
    if (state === 'expanded') await page.getByTestId('recap-toggle').click();
    const doc = await page.evaluate(probeDocumentWidth);
    expect(doc.scrollWidth, `@ 320 ${state}: scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
    const card = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="recap-card"]');
      return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
    });
    expect(card, 'recap-card must render').not.toBeNull();
    expect(card!.scrollWidth, `@ 320 ${state}: recap card overflows itself`).toBeLessThanOrEqual(card!.clientWidth + 1);
  }
});

test('Recap negative control: the placement probe fails when the recap sits above the hero', async ({ page }) => {
  await openDashboard(page, PHONE, 'present');
  const before = await page.evaluate(probeBox, 'matchup-preview');
  // Reproduce the pre-#1988 order in the live DOM: recap slot ahead of the hero.
  await page.evaluate(() => {
    const recap = document.querySelector('[data-testid="slot-recap"]');
    const hero = document.querySelector('[data-testid="dashboard-hero"]');
    hero?.parentNode?.insertBefore(recap as Node, hero);
  });
  const after = await page.evaluate(probeBox, 'matchup-preview');
  expect(
    after!.top - before!.top,
    'moving the recap above the hero must push the matchup card down by more than the tolerance'
  ).toBeGreaterThan(TOP_TOLERANCE);
});
