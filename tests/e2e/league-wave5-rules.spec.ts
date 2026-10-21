/**
 * League rules on Play-select (ADR 0067 wave 5, spec #2433). jsdom has no layout engine, so this mirrors
 * league-wave3-trades.spec.ts: `page.route` API stubs layered on the layout-guard harness
 * (fixtures/wave5RulesFixtures.ts), headless Chromium, DOM probes.
 *
 * The page is read only, so every case runs at 1440 and 390, in both themes, for a fantasy league (on every
 * rules tab) and a pick'em-only league, and asserts:
 *  - zero `.cursor` and zero `[data-variant="fill"]`;
 *  - no sideways scroll on the document.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), the views' content (LeagueRules tests).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RULES_URL, setupRulesFixture } from './fixtures/wave5RulesFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const TABS = ['Scoring', 'Roster', 'Waivers & Trades', 'Playoffs & Season'];

async function open(page: Page, viewport: ViewportName, theme: Theme, pickemOnly: boolean) {
  await setupRulesFixture(page, { theme, pickemOnly });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(RULES_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'League Rules' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function expectReadOnly(page: Page) {
  const p = await page.evaluate(() => ({
    cursors: document.querySelectorAll('.cursor').length,
    filled: document.querySelectorAll('[data-variant="fill"]').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(p.cursors, 'a read-only page has no cursor').toBe(0);
  expect(p.filled, 'a read-only page has no filled action').toBe(0);
  expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    const tag = `${viewport} ${theme}`;

    test(`League rules fantasy ${tag}: every tab is read only and fits the viewport`, async ({ page }) => {
      await open(page, viewport, theme, false);
      for (const name of TABS) {
        await page.getByRole('tab', { name }).click();
        await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
        await expectReadOnly(page);
      }
    });

    test(`League rules pick'em-only ${tag}: only the pick'em rules, read only, fits the viewport`, async ({ page }) => {
      await open(page, viewport, theme, true);
      await expect(page.getByRole('heading', { name: 'Picks' })).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(0);
      await expectReadOnly(page);
    });
  }
}
