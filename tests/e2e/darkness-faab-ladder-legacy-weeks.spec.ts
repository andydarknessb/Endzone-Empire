import { expect, test, type Page } from '@playwright/test';
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

// The shared ladder (week 12) is the reference for the phone-width name column and track.
const SHARED_PATH = '/strategy/week12-waiver-wire-darkness-report';

const PHONE_VIEWPORTS = [
  { label: '390x844', width: 390, height: 844 },
  { label: '320x568', width: 320, height: 568 },
];

const AXIS_VIEWPORTS = [
  { label: '390x844', width: 390, height: 844 },
  { label: '320x568', width: 320, height: 568 },
  { label: '1280x800', width: 1280, height: 800 },
];

// Guard (c): at sm and up the name column is 11em at the rows' 0.85rem (13.6px at the 16px root), then one 8px gap.
const SM_TRACK_OFFSET = 11 * 13.6 + 8;

type LadderRow = {
  name: string;
  nameScrollWidth: number;
  nameClientWidth: number;
  nameWhiteSpace: string;
  nameOverflowWrap: string;
  nameTextOverflow: string;
  trackWidth: number;
  trackOffset: number;
  bidHeight: number;
  bidWhiteSpace: string;
};

type Ladder = { rows: LadderRow[]; documentOverflow: number };

async function readLadder(page: Page, path: string): Promise<Ladder> {
  await page.goto(path);
  const chart = page.getByRole('img', { name: /^Recommended bids as a percent of budget/ });
  await expect(chart).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Rows are [name, bar track, bid]; the axis row is the chart's last child.
  const rows = await chart.evaluate((el) => {
    const chartLeft = el.getBoundingClientRect().left;
    const rowEls = Array.from(el.children).slice(0, -1) as HTMLElement[];
    return rowEls.map((row) => {
      const [name, track, bid] = Array.from(row.children) as HTMLElement[];
      const nameStyle = getComputedStyle(name);
      return {
        name: name.textContent?.trim() ?? '',
        nameScrollWidth: name.scrollWidth,
        nameClientWidth: name.clientWidth,
        nameWhiteSpace: nameStyle.whiteSpace,
        nameOverflowWrap: nameStyle.overflowWrap,
        nameTextOverflow: nameStyle.textOverflow,
        trackWidth: track.getBoundingClientRect().width,
        trackOffset: track.getBoundingClientRect().left - chartLeft,
        bidHeight: bid.getBoundingClientRect().height,
        bidWhiteSpace: getComputedStyle(bid).whiteSpace,
      };
    });
  });

  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  return { rows, documentOverflow };
}

for (const viewport of AXIS_VIEWPORTS) {
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
          const trackBox = track.getBoundingClientRect();
          const labelsBox = labels.getBoundingClientRect();
          return {
            rows: children.length - 1,
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
      });
    }
  });
}

for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`FAAB ladder names at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const slug of SLUGS) {
      test(`${slug}: names shown in full, bids on one line, track lines up with the shared ladder`, async ({ page }) => {
        await mockAnonymousApi(page);
        const legacy = await readLadder(page, `/strategy/${slug}`);
        const shared = await readLadder(page, SHARED_PATH);

        // Guard (a): the rows, read as the shared ladder's phone spec reads them, plus the computed style.
        expect(legacy.rows.length, 'ladder rows').toBeGreaterThan(0);
        const oneLineBidHeight = legacy.rows[legacy.rows.length - 1].bidHeight;
        for (const row of legacy.rows) {
          expect.soft(row.nameScrollWidth, `${row.name} is clipped`).toBeLessThanOrEqual(row.nameClientWidth);
          expect.soft(row.nameWhiteSpace, `${row.name} name white-space`).toBe('normal');
          expect.soft(row.nameOverflowWrap, `${row.name} name overflow-wrap`).toBe('anywhere');
          expect.soft(row.nameTextOverflow, `${row.name} name text-overflow`).toBe('clip');
          expect.soft(row.trackWidth, `${row.name} bar track`).toBeGreaterThanOrEqual(80);
          expect.soft(row.bidWhiteSpace, `${row.name} bid white-space`).toBe('nowrap');
          expect.soft(row.bidHeight, `${row.name} bid wraps`).toBe(oneLineBidHeight);
        }
        expect.soft(legacy.documentOverflow, `horizontal page overflow at ${viewport.width}px`).toBe(0);

        // Guard (b): the first bar track sits where the shared ladder's first bar track sits at this viewport.
        expect
          .soft(Math.abs(legacy.rows[0].trackOffset - shared.rows[0].trackOffset), 'bar track offset against the shared ladder (guard b)')
          .toBeLessThanOrEqual(1);
      });
    }
  });
}

test.describe('FAAB ladder name column at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const slug of SLUGS) {
    // Guard (c): sm is as published, so the name column stays 11em with an ellipsis.
    test(`${slug}: the name column keeps the sm layout`, async ({ page }) => {
      await mockAnonymousApi(page);
      const legacy = await readLadder(page, `/strategy/${slug}`);

      expect.soft(Math.abs(legacy.rows[0].trackOffset - SM_TRACK_OFFSET), 'bar track offset from the chart edge (guard c)').toBeLessThanOrEqual(1);
      for (const row of legacy.rows) {
        expect.soft(row.nameWhiteSpace, `${row.name} name white-space at sm`).toBe('nowrap');
        expect.soft(row.nameTextOverflow, `${row.name} name text-overflow at sm`).toBe('ellipsis');
      }
    });
  }
});
