/**
 * Power rankings on Play-select (ADR 0067 wave 5, spec #2433). jsdom has no layout engine, so this mirrors
 * league-wave5-rules.spec.ts: `page.route` API stubs layered on the layout-guard harness
 * (fixtures/wave5PowerRankingsFixtures.ts), headless Chromium, DOM probes.
 *
 * The page is read only, so every case runs at 1440 and 390, in both themes, and asserts:
 *  - zero `.cursor` and zero `[data-variant="fill"]`;
 *  - no sideways scroll on the document;
 *  - a team that rose and a team that fell draw their movement in Ink, not green or red.
 *
 * Not covered here: colours of the tokens (src/theme/tokens.contrast.test.js), the table's content (PowerRankings tests).
 */
import { expect, test } from '@playwright/test';
import { POWER_RANKINGS_URL, setupPowerRankingsFixture } from './fixtures/wave5PowerRankingsFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
const THEMES = ['dark', 'light'] as const;

for (const [viewport, size] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test(`Power rankings ${viewport} ${theme}: read only, fits the viewport, movement in Ink`, async ({ page }) => {
      await setupPowerRankingsFixture(page, theme);
      await page.setViewportSize(size);
      await page.goto(POWER_RANKINGS_URL);
      await expect(page.getByRole('heading', { level: 1, name: 'Power Rankings' })).toBeVisible();
      await expect(page.getByTestId('movement')).toHaveCount(4); // two rows plus two callouts
      await page.evaluate(() => document.fonts.ready.then(() => true));

      const p = await page.evaluate(() => {
        const root = document.querySelector('.ps-root') as HTMLElement;
        const probe = document.createElement('span');
        probe.style.color = 'var(--ps-ink)';
        root.appendChild(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        const colorOf = (el: Element | null) => (el ? getComputedStyle(el).color : null);
        const rows = Array.from(document.querySelectorAll('[data-testid^="power-ranking-row-"]'));
        const moveIn = (i: number) => rows[i]?.querySelector('[data-testid="movement"]') ?? null;
        return {
          ink,
          rose: colorOf(moveIn(0)),
          fell: colorOf(moveIn(1)),
          cursors: document.querySelectorAll('.cursor').length,
          filled: document.querySelectorAll('[data-variant="fill"]').length,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      expect(p.rose, 'a team that rose draws its movement in Ink').toBe(p.ink);
      expect(p.fell, 'a team that fell draws its movement in Ink').toBe(p.ink);
      expect(p.cursors, 'a read-only page has no cursor').toBe(0);
      expect(p.filled, 'a read-only page has no filled action').toBe(0);
      expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
    });
  }
}
