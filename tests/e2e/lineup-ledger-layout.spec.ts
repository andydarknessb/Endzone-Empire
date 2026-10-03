/**
 * Layout guard for the Lineup Ledger (#1957, spec #1956 L10): jsdom has no
 * layout engine, so the one-column stack, the aligned numbers column and the
 * selected-row ring are measured in headless Chromium over the real Team
 * Lineup page, fed a fixture (fixtures/lineupLedgerFixtures.ts) that carries a
 * long player name, a Questionable and an Out starter, an empty FLEX seat, a
 * five-player Bench and one IR stash. It runs in `npm run test:e2e`, which
 * collects every spec under tests/e2e.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LINEUP_URL, LONG_NAME, setupLineupLedgerFixture } from './fixtures/lineupLedgerFixtures';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function openLineup(page: Page, viewport: { width: number; height: number }) {
  await setupLineupLedgerFixture(page);
  await page.setViewportSize(viewport);
  await page.goto(LINEUP_URL);
  await expect(page.getByTestId('ledger-starters')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  expect(b, 'element must be laid out').not.toBeNull();
  return b as { x: number; y: number; width: number; height: number };
};

test('one column at 1280: Bench sits below Starters at the same left edge and width, and does not scroll inside itself', async ({ page }) => {
  await openLineup(page, DESKTOP);
  await expect(page.getByTestId('ledger-bench')).toBeVisible();

  const starters = await box(page.getByTestId('ledger-starters'));
  const bench = await box(page.getByTestId('ledger-bench'));
  expect(bench.y).toBeGreaterThanOrEqual(starters.y + starters.height - 1);
  expect(Math.abs(bench.x - starters.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bench.width - starters.width)).toBeLessThanOrEqual(1);

  const overflowY = await page.getByTestId('ledger-bench-rows').evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe('visible');
});

for (const viewport of [PHONE, DESKTOP]) {
  test(`the projection column shares one right edge on every starter row at ${viewport.width}px, long name included`, async ({ page }) => {
    await openLineup(page, viewport);

    const edges = await page.getByTestId('ledger-starters').getByTestId('ledger-projection').evaluateAll((els) =>
      els.map((el) => {
        const row = el.closest('[data-testid^="slot-row-"]');
        return { row: row ? row.getAttribute('data-testid') : null, text: row ? row.textContent || '' : '', right: el.getBoundingClientRect().right };
      })
    );
    // Eight of the nine seats are filled (FLEX is empty and carries no numbers).
    expect(edges).toHaveLength(8);
    expect(edges.some((e) => e.text.includes(LONG_NAME)), 'the long-name row is among the measured rows').toBe(true);
    const rights = edges.map((e) => e.right);
    const spread = Math.max(...rights) - Math.min(...rights);
    expect(spread, `right edges ${JSON.stringify(edges.map((e) => [e.row, Math.round(e.right * 10) / 10]))}`).toBeLessThanOrEqual(1);
  });
}

test('at 390px the selected row wears a ring and an eligible Bench row does not', async ({ page }) => {
  await openLineup(page, PHONE);

  const boxShadowOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).boxShadow);
  const tabs = page.getByTestId('lineup-mobile-tabs');

  // The top-left corner of the covering button, clear of the name link.
  const selectRow = page.getByTestId('slot-row-RB-0-select');
  await expect(selectRow).toBeVisible();
  await selectRow.click({ position: { x: 6, y: 6 } });
  await expect(selectRow).toHaveAttribute('aria-pressed', 'true');

  // Selecting a starter with a Bench target flips the phone to the Bench tab
  // (#1425); read the eligible Bench row there, then flip back to read the
  // selected row while it is on screen.
  const benchRows = page.getByTestId('ledger-bench-rows');
  await expect(benchRows).toBeVisible();
  const eligible = benchRows.locator('[data-testid$="-select"]:not([disabled])').first();
  await expect(eligible).toBeVisible();
  const eligibleRow = eligible.locator('xpath=..');
  expect(await boxShadowOf(eligibleRow)).toBe('none');

  await tabs.getByRole('button', { name: /^Starters/ }).click();
  const selectedRow = page.getByTestId('slot-row-RB-0');
  await expect(selectedRow).toBeVisible();
  expect(await boxShadowOf(selectedRow)).not.toBe('none');
});

test('at 390px a short name is not truncated and the info column keeps at least 128px', async ({ page }) => {
  await openLineup(page, PHONE);

  const row = page.getByTestId('slot-row-QB-0');
  const name = row.getByRole('button', { name: 'Josh Allen', exact: true });
  const { scrollWidth, clientWidth } = await name.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, 'the name must not be ellipsized').toBeLessThanOrEqual(clientWidth);

  const infoWidth = await row.getByTestId('ledger-info').evaluate((el) => el.getBoundingClientRect().width);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_INFO_WIDTH_390 ${infoWidth}`);
  expect(infoWidth).toBeGreaterThanOrEqual(128);
});

test('at 390px the BENCH slot chip clears the avatar and the Bench info column keeps at least 128px', async ({ page }) => {
  await openLineup(page, PHONE);
  await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: /^Bench/ }).click();

  const row = page.getByTestId('slot-row-BENCH-201');
  await expect(row).toBeVisible();
  const chip = await box(row.getByTestId('ledger-slot-chip'));
  const avatar = await box(row.locator('.MuiAvatar-root'));
  expect(chip.x + chip.width, 'the slot chip must not overlap the avatar').toBeLessThanOrEqual(avatar.x);

  const infoWidth = await row.getByTestId('ledger-info').evaluate((el) => el.getBoundingClientRect().width);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_BENCH_INFO_WIDTH_390 ${infoWidth}`);
  expect(infoWidth).toBeGreaterThanOrEqual(128);
});

for (const width of [600, 900]) {
  test(`at ${width}px the info column of a Starters row and a Bench row keeps at least 128px`, async ({ page }) => {
    await openLineup(page, { width, height: 900 });

    const infoWidth = (id: string) => page.getByTestId(id).getByTestId('ledger-info').evaluate((el) => el.getBoundingClientRect().width);
    expect(await infoWidth('slot-row-RB-0')).toBeGreaterThanOrEqual(128);
    expect(await infoWidth('slot-row-BENCH-201')).toBeGreaterThanOrEqual(128);
  });
}
