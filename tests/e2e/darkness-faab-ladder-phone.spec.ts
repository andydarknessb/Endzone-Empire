import { expect, test, type Locator, type Page } from '@playwright/test';
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

const PHONE_390 = { width: 390, height: 844 };
const PHONE_320 = { width: 320, height: 568 };
const DESKTOP_1280 = { width: 1280, height: 800 };

async function openLadder(page: Page): Promise<Locator> {
  await mockAnonymousApi(page);
  await page.goto('/strategy/week12-waiver-wire-darkness-report');
  const chart = page.getByRole('img', { name: /^Recommended bids as a percent of budget/ });
  await expect(chart).toBeVisible();
  await page.waitForLoadState('networkidle');
  return chart;
}

// Each row is [name, bar track, bid]; the axis row under the ladder is the last child.
function ladderRows(chart: Locator): Locator {
  return chart.locator(':scope > div:not(:last-child)');
}

test.describe('Darkness Report FAAB ladder at phone width', () => {
  for (const viewport of [PHONE_390, PHONE_320]) {
    test.describe(`at ${viewport.width}px`, () => {
      test.use({ viewport });

      test('names are shown in full, bids stay on one line, and the page does not overflow sideways', async ({ page }) => {
        const chart = await openLadder(page);

        const rows = ladderRows(chart);
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
        expect(overflow, `horizontal page overflow at ${viewport.width}px`).toBe(0);
      });
    });
  }

  test.describe('at 320px', () => {
    test.use({ viewport: PHONE_320 });

    // Positive control: a name that wraps is taller than one bid line, so a reverted nowrap shows here.
    test('at least one long name wraps onto a second line', async ({ page }) => {
      const chart = await openLadder(page);

      const { nameHeights, oneLineBidHeight } = await ladderRows(chart).evaluateAll((rowEls) => {
        const cells = rowEls.map((row) => Array.from(row.children) as HTMLElement[]);
        return {
          nameHeights: cells.map(([name]) => name.getBoundingClientRect().height),
          oneLineBidHeight: cells[cells.length - 1][2].getBoundingClientRect().height,
        };
      });

      expect(Math.max(...nameHeights)).toBeGreaterThan(oneLineBidHeight);
    });
  });
});

test.describe('Darkness Report FAAB ladder axis', () => {
  for (const viewport of [PHONE_390, PHONE_320, DESKTOP_1280]) {
    test.describe(`at ${viewport.width}px`, () => {
      test.use({ viewport });

      test('the 0% 10% 20% labels sit on the bar track edges', async ({ page }) => {
        const chart = await openLadder(page);

        const axisRow = chart.locator(':scope > :last-child');
        await expect(axisRow).toHaveText('0%10%20%');
        const labels = axisRow.locator(':scope > *').nth(1);
        await expect(labels).toHaveText('0%10%20%');
        const track = ladderRows(chart).first().locator(':scope > *').nth(1);

        const [t, l] = await Promise.all([track.boundingBox(), labels.boundingBox()]);
        if (!t || !l) throw new Error('axis labels or bar track has no box');
        expect(Math.abs(l.x - t.x), 'axis labels left edge vs bar track').toBeLessThanOrEqual(1);
        expect(
          Math.abs(l.x + l.width - (t.x + t.width)),
          'axis labels right edge vs bar track',
        ).toBeLessThanOrEqual(1);
      });
    });
  }
});
