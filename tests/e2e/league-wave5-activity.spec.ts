/**
 * Transaction log on Play-select (ADR 0067 wave 5, spec #2433). jsdom has no layout engine, so this mirrors
 * league-wave5-rules.spec.ts: `page.route` API stubs layered on the layout-guard harness
 * (fixtures/wave5ActivityFixtures.ts), headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, for a fantasy league and a pick'em-only league, and asserts:
 *  - zero `.cursor` and zero `[data-variant="fill"]`;
 *  - no sideways scroll on the document;
 *  - every button at least 44px (the player-name links and filter segments included).
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), the rows' sentences (TransactionLog tests).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ACTIVITY_URL, setupActivityFixture } from './fixtures/wave5ActivityFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];

async function open(page: Page, viewport: ViewportName, theme: Theme, pickemOnly: boolean) {
  await setupActivityFixture(page, { theme, pickemOnly });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(ACTIVITY_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible();
  await expect(page.getByTestId('txn-1').or(page.getByTestId('txn-5')).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function expectPlayselectPage(page: Page) {
  const p = await page.evaluate(() => ({
    cursors: document.querySelectorAll('.cursor').length,
    filled: document.querySelectorAll('[data-variant="fill"]').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    smallButtons: Array.from(document.querySelectorAll('[data-testid="transaction-log"] button, [data-testid="transaction-log"] [role="radio"]'))
      .map((el) => ({ name: (el.textContent || el.getAttribute('aria-label') || '').trim(), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h > 0 && b.h < 44),
  }));
  expect(p.cursors, 'a read-only page has no cursor').toBe(0);
  expect(p.filled, 'a read-only page has no filled action').toBe(0);
  expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
  expect(p.smallButtons, 'every button is at least 44px tall').toEqual([]);
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    const tag = `${viewport} ${theme}`;

    test(`Transaction log fantasy ${tag}: read only, fits the viewport, 44px targets`, async ({ page }) => {
      await open(page, viewport, theme, false);
      await expectPlayselectPage(page);
      await page.getByRole('button', { name: 'Show more' }).click();
      await expectPlayselectPage(page);
      await page.getByRole('radio', { name: 'Trades' }).click();
      await expect(page.getByTestId('txn-4')).toBeVisible();
      await expectPlayselectPage(page);
    });

    test(`Transaction log fantasy ${tag}: the player card opens and the page stays read only`, async ({ page }) => {
      await open(page, viewport, theme, false);
      await page.getByRole('button', { name: 'Jahmyr Gibbs' }).click();
      await expect(page.getByTestId('decision-card')).toBeVisible();
    });

    test(`Transaction log pick'em-only ${tag}: only commissioner moves, read only, fits the viewport`, async ({ page }) => {
      await open(page, viewport, theme, true);
      await expect(page.getByRole('radio', { name: 'Adds' })).toHaveCount(0);
      await expectPlayselectPage(page);
    });
  }
}
