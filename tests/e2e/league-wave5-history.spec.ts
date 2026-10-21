/**
 * League history on Play-select (ADR 0067 wave 5, spec #2433). jsdom has no layout engine, so this mirrors
 * league-wave3-trades.spec.ts: a `page.route` stub of the history read on the layout-guard harness
 * (fixtures/wave5HistoryFixtures.ts), headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, on the Season History view and on the All-Time view,
 * and asserts:
 *  - zero `.cursor` and zero `[data-variant="fill"]` (the page has no cursor and no filled action);
 *  - no sideways scroll on the document.
 * The medal case reads the computed colour of each podium medal against its `ps-medal-*` token.
 *
 * Not covered here: colour pairs (src/theme/tokens.contrast.test.js), behaviour (LeagueHistoryPage.test.jsx).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HISTORY_URL, setupHistoryFixture } from './fixtures/wave5HistoryFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];

async function open(page: Page, viewport: ViewportName, theme: Theme) {
  await setupHistoryFixture(page, { theme });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(HISTORY_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'League History' })).toBeVisible();
  await expect(page.getByTestId('season-panel-2026')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

function probe(page: Page) {
  return page.evaluate(() => ({
    cursors: document.querySelectorAll('.cursor').length,
    filled: document.querySelectorAll('[data-variant="fill"]').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

function expectPlaySelect(p: Awaited<ReturnType<typeof probe>>) {
  expect(p.cursors, 'League history draws no cursor').toBe(0);
  expect(p.filled, 'League history draws no filled action').toBe(0);
  expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    const tag = `${viewport} ${theme}`;

    test(`League history seasons ${tag}: no cursor, no filled action, no sideways scroll`, async ({ page }) => {
      await open(page, viewport, theme);
      expectPlaySelect(await probe(page));
    });

    test(`League history All-Time ${tag}: no cursor, no filled action, no sideways scroll`, async ({ page }) => {
      await open(page, viewport, theme);
      await page.getByRole('radio', { name: 'All-Time' }).click();
      await expect(page.getByTestId('league-history-all-time')).toBeVisible();
      expectPlaySelect(await probe(page));
    });

    test(`League history ${tag}: the podium medals paint the ps-medal tokens`, async ({ page }) => {
      await open(page, viewport, theme);
      const painted = await page.evaluate(() => {
        const resolve = (token: string) => {
          const swatch = document.createElement('i');
          swatch.style.color = `var(--${token})`;
          document.body.appendChild(swatch);
          const color = getComputedStyle(swatch).color;
          swatch.remove();
          return color;
        };
        return ['gold', 'silver', 'bronze'].map((name, index) => {
          const medal = document.querySelector(`svg[data-medal="${index + 1}"]`) as SVGElement;
          return { got: getComputedStyle(medal).color, want: resolve(`ps-medal-${name}`) };
        });
      });
      painted.forEach(({ got, want }) => expect(got).toBe(want));
    });
  }
}

// Permanent negative control: a sideways-scrolling element must trip the width predicate, so a green run
// above cannot come from a probe that can never go red.
test('negative control: an overwide element trips the scrollWidth predicate', async ({ page }) => {
  await open(page, 'phone', 'dark');
  await page.evaluate(() => {
    const wide = document.createElement('div');
    wide.style.cssText = 'width:2000px;height:1px';
    document.body.appendChild(wide);
  });
  const p = await probe(page);
  expect(p.scrollWidth).toBeGreaterThan(p.innerWidth);
});
