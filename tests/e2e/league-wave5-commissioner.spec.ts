/**
 * Commissioner console on Play-select (ADR 0067 wave 5, spec #2433). jsdom has no layout engine, so this mirrors
 * league-wave5-rules.spec.ts: `page.route` API stubs layered on the layout-guard harness
 * (fixtures/wave5CommissionerFixtures.ts), headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, on every one of the tools' six tabs, and asserts:
 *  - two pending requests: one `.cursor` and one `[data-variant="fill"]` outside a dialog (the queue's lead row);
 *  - no pending requests: zero of each;
 *  - no sideways scroll on the document, and every button in `main` (the page header's Advance control included) at least 44px.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), the tools' behaviour (CommissionerTools tests).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { COMMISSIONER_URL, setupCommissionerFixture } from './fixtures/wave5CommissionerFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const TABS = ['General Settings', 'Roster Settings', 'Scoring Settings', 'Playoffs & Schedule', 'Waivers & Trades', 'System Overrides'];

async function open(page: Page, viewport: ViewportName, theme: Theme, pending: boolean) {
  await setupCommissionerFixture(page, { theme, pending });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(COMMISSIONER_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Commissioner console' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Commissioner tools sections' })).toBeVisible();
  // The queue's read lands after first paint; probe only once it has.
  await expect(page.getByTestId(pending ? 'join-requests-row-11' : 'join-requests-empty')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function probe(page: Page) {
  return page.evaluate(() => {
    // Every button in the routed page (the `main` landmark), page header included. The app shell's Nav sits outside it.
    const main = document.querySelector('main');
    const small = Array.from(main ? main.querySelectorAll('button, [role="button"]') : [])
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5))
      .map(({ el, box }) => `${el.tagName} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
    return {
      cursors: document.querySelectorAll('.cursor').length,
      filled: Array.from(document.querySelectorAll('[data-variant="fill"]')).filter((el) => !el.closest('[role="dialog"]')).length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      small,
    };
  });
}

async function expectFits(page: Page) {
  const advance = page.getByRole('button', { name: /Advance to Week/ });
  await expect(advance).toBeVisible();
  const box = await advance.boundingBox();
  expect(box?.height ?? 0, `Advance to Week is ${box?.height}px tall, want at least 44`).toBeGreaterThanOrEqual(43.5);
  const p = await probe(page);
  expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
  expect(p.small, 'every button is at least 44px').toEqual([]);
  return p;
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    const tag = `${viewport} ${theme}`;

    test(`Commissioner console ${tag}: two pending requests give one cursor and one filled action`, async ({ page }) => {
      await open(page, viewport, theme, true);
      for (const name of TABS) {
        await page.getByRole('tab', { name }).click();
        await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
        const p = await expectFits(page);
        expect(p.cursors, `${name}: the queue's lead row is the one cursor`).toBe(1);
        expect(p.filled, `${name}: the queue's Approve is the one filled action`).toBe(1);
      }
    });

    test(`Commissioner console ${tag}: no pending requests give no cursor and no filled action`, async ({ page }) => {
      await open(page, viewport, theme, false);
      for (const name of TABS) {
        await page.getByRole('tab', { name }).click();
        await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
        const p = await expectFits(page);
        expect(p.cursors, `${name}: no cursor`).toBe(0);
        expect(p.filled, `${name}: no filled action`).toBe(0);
      }
    });
  }
}
