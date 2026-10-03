/**
 * Layout guard for the Lineup Ledger (#1957, spec #1956 L1, L2, L4, L10):
 * jsdom has no layout engine, so "one column, no inner scroll", "the numbers
 * line up" and "the selected row is distinct" are measured in headless
 * Chromium over the real Lineup page, with `/api/**` stubbed through
 * `page.route` (fixtures/lineupLedgerFixtures.ts). It runs in the
 * `browser-security` job (`npm run test:e2e`), which collects every spec under
 * tests/e2e, so it needs no workflow edit.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  BENCH_RB_ID,
  LINEUP_URL,
  LONG_NAME,
  STARTER_RB_TEST_ID,
  setupLineupLedgerLayout,
} from './fixtures/lineupLedgerFixtures';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function openLineup(page: Page, viewport: { width: number; height: number }) {
  await setupLineupLedgerLayout(page);
  await page.setViewportSize(viewport);
  await page.goto(LINEUP_URL);
  await expect(page.getByTestId(STARTER_RB_TEST_ID)).toContainText(LONG_NAME);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

const box = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  });

test('at 1280 the Bench card stacks below the Starters card at the same left edge and width, with no inner scroll', async ({ page }) => {
  await openLineup(page, DESKTOP);

  const starters = await box(page, 'ledger-starters');
  const bench = await box(page, 'ledger-bench');
  expect(bench.top, `bench top ${bench.top} is above the starters bottom ${starters.bottom}`).toBeGreaterThanOrEqual(starters.bottom);
  expect(Math.abs(bench.left - starters.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(bench.width - starters.width)).toBeLessThanOrEqual(1);

  // The Bench rows container is the card's last child: no scroll of its own.
  const overflowY = await page.getByTestId('ledger-bench').evaluate((el) => getComputedStyle(el.lastElementChild as Element).overflowY);
  expect(overflowY).toBe('visible');
});

for (const [label, viewport] of [['1280x900', DESKTOP], ['390x844', PHONE]] as const) {
  test(`at ${label} every starter row's projection ends on the same right edge, the long name included`, async ({ page }) => {
    await openLineup(page, viewport);

    const rights = await page
      .getByTestId('ledger-starters')
      .getByTestId('ledger-projection')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
    // 8 occupied starters of 9 slots (the empty FLEX has no numbers).
    expect(rights).toHaveLength(8);
    for (const right of rights) {
      expect(Math.abs(right - rights[0]), `right edges ${JSON.stringify(rights)}`).toBeLessThanOrEqual(1);
    }
  });
}

test('at 390 the selected starter draws the accent ring and an eligible Bench row does not', async ({ page }) => {
  await openLineup(page, PHONE);

  await page.getByTestId(`${STARTER_RB_TEST_ID}-select`).click();

  // The row wrapper is the visible box (the covering button is transparent).
  // Selecting a starter with an eligible target flips the phone to the Bench
  // tab (#1425), so read the computed style rather than waiting for the
  // Starters section to be on screen.
  const shadow = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => getComputedStyle(el).boxShadow);
  await expect(page.getByTestId(`slot-row-BENCH-${BENCH_RB_ID}`)).toBeVisible();
  expect(await shadow(STARTER_RB_TEST_ID)).not.toBe('none');
  expect(await shadow(`slot-row-BENCH-${BENCH_RB_ID}`)).toBe('none');
});

// WCAG 1.4.10 reflow reaches 320px: the avatar column gives way so the name
// keeps room, the numbers stay aligned and nothing scrolls sideways.
test('at 320 the info block keeps room, the numbers stay aligned and the page does not scroll sideways', async ({ page }) => {
  await openLineup(page, { width: 320, height: 640 });

  const infoWidths = await page.getByTestId('ledger-starters').getByTestId('ledger-info').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().width)
  );
  for (const width of infoWidths) expect(width, `info widths ${JSON.stringify(infoWidths)}`).toBeGreaterThanOrEqual(60);

  const rights = await page
    .getByTestId('ledger-starters')
    .getByTestId('ledger-projection')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  for (const right of rights) expect(Math.abs(right - rights[0])).toBeLessThanOrEqual(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
