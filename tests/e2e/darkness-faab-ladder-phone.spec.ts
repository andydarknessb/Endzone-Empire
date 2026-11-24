import { expect, test } from '@playwright/test';
import { mockAnonymousApi } from './fixtures/anonymousApi';

// Names in LADDER order, from src/content/articles/week12-waiver-wire-darkness-report.jsx.
const LADDER_NAMES = [
  'Jacory Croskey-Merritt',
  'Antonio Williams',
  'Jack Bech',
  'Fernando Mendoza',
  'Deshaun Watson',
  'Justice Hill',
  'Kaleb Johnson',
  'Cam Ward',
  'Geno Smith',
  'Baker Mayfield',
];

test.describe('Darkness Report FAAB ladder at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('names are shown in full, bids stay on one line, and the page does not overflow sideways', async ({ page }) => {
    await mockAnonymousApi(page);
    await page.goto('/strategy/week12-waiver-wire-darkness-report');
    const chart = page.getByRole('img', { name: /^Recommended bids as a percent of budget/ });
    await expect(chart).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Each row is [name, bar track, bid]; the axis row under the ladder is the last child.
    const rows = chart.locator(':scope > div:not(:last-child)');
    await expect(rows).toHaveCount(LADDER_NAMES.length);
    const metrics = await rows.evaluateAll((rowEls) =>
      rowEls.map((row) => {
        const [name, track, bid] = Array.from(row.children) as HTMLElement[];
        return {
          name: name.textContent ?? '',
          nameScrollWidth: name.scrollWidth,
          nameClientWidth: name.clientWidth,
          trackWidth: track.getBoundingClientRect().width,
          bidHeight: bid.getBoundingClientRect().height,
        };
      }),
    );

    expect(metrics.map((m) => m.name)).toEqual(LADDER_NAMES);
    const oneLineBidHeight = metrics[metrics.length - 1].bidHeight;
    for (const m of metrics) {
      expect(m.nameScrollWidth, `${m.name} is clipped`).toBeLessThanOrEqual(m.nameClientWidth);
      expect(m.trackWidth, `${m.name} bar track`).toBeGreaterThanOrEqual(80);
      expect(m.bidHeight, `${m.name} bid wraps`).toBe(oneLineBidHeight);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal page overflow at 390px').toBe(0);
  });
});
