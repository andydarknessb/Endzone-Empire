import { expect, test } from '@playwright/test';
import { mockAnonymousApi } from './fixtures/anonymousApi';

// Weeks 4 to 8 each keep a private FaabLadder. Its rows are 0.85rem on the same em columns as the
// axis row, so the 0% / 10% / 20% labels must resolve the rows' size, not 0.72rem.
const SLUGS = [
  'week4-waiver-wire-darkness-report',
  'week5-waiver-wire-darkness-report',
  'week6-waiver-wire-darkness-report',
  'week7-waiver-wire-darkness-report',
  'week8-waiver-wire-darkness-report',
];

// Guard (b): the first bar track sits one name column past the chart's left edge. The name column is
// 8.5em (xs) or 11em (sm) at the rows' 0.85rem (13.6px at the 16px root), then one 8px gap.
const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, trackOffset: 8.5 * 13.6 + 8 },
  { label: '1280x800', width: 1280, height: 800, trackOffset: 11 * 13.6 + 8 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`FAAB ladder axis at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const slug of SLUGS) {
      test(`${slug}: axis labels line up with the bar tracks`, async ({ page }) => {
        await mockAnonymousApi(page);
        await page.goto(`/strategy/${slug}`);
        const chart = page.getByRole('img', { name: /^Recommended bids as a percent of budget/ });
        await expect(chart).toBeVisible();
        await page.waitForLoadState('networkidle');

        // Rows are [name, bar track, bid]; the axis row is the chart's last child, its middle child the labels.
        const m = await chart.evaluate((el) => {
          const children = Array.from(el.children) as HTMLElement[];
          const axisRow = children[children.length - 1];
          const track = children[0].children[1] as HTMLElement;
          const labels = axisRow.children[1] as HTMLElement;
          const chartBox = el.getBoundingClientRect();
          const trackBox = track.getBoundingClientRect();
          const labelsBox = labels.getBoundingClientRect();
          return {
            rows: children.length - 1,
            trackOffset: trackBox.left - chartBox.left,
            trackLeft: trackBox.left,
            trackRight: trackBox.right,
            labelsLeft: labelsBox.left,
            labelsRight: labelsBox.right,
            labelsText: labels.textContent ?? '',
            labelsFontSize: getComputedStyle(labels).fontSize,
          };
        });

        expect.soft(m.rows, 'ladder rows above the axis row').toBeGreaterThan(0);
        expect.soft(m.labelsText, 'axis labels').toBe('0%10%20%');
        expect.soft(m.labelsFontSize, 'axis labels stay 0.72rem').toBe('11.52px');
        expect.soft(Math.abs(m.labelsLeft - m.trackLeft), 'axis left edge against the bar track').toBeLessThanOrEqual(1);
        expect.soft(Math.abs(m.labelsRight - m.trackRight), 'axis right edge against the bar track').toBeLessThanOrEqual(1);
        expect.soft(Math.abs(m.trackOffset - viewport.trackOffset), 'bar track offset from the chart edge (guard b)').toBeLessThanOrEqual(1);
      });
    }
  });
}
