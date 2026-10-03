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

test('at 390px the BENCH slot chip clears the avatar and a Bench name is not truncated', async ({ page }) => {
  await openLineup(page, PHONE);
  await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: /^Bench/ }).click();

  const row = page.getByTestId('slot-row-BENCH-201');
  await expect(row).toBeVisible();
  const chip = await box(row.getByTestId('ledger-slot-chip'));
  const avatar = await box(row.locator('.MuiAvatar-root'));
  expect(chip.x + chip.width, 'the slot chip must not overlap the avatar').toBeLessThanOrEqual(avatar.x);

  const name = row.getByRole('button', { name: 'Rachaad White', exact: true });
  const { scrollWidth, clientWidth } = await name.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, 'the name must not be ellipsized').toBeLessThanOrEqual(clientWidth);
});

for (const width of [600, 900]) {
  test(`at ${width}px the info column of a Starters row and a Bench row keeps at least 128px`, async ({ page }) => {
    await openLineup(page, { width, height: 900 });

    const infoWidth = (id: string) => page.getByTestId(id).getByTestId('ledger-info').evaluate((el) => el.getBoundingClientRect().width);
    expect(await infoWidth('slot-row-RB-0')).toBeGreaterThanOrEqual(128);
    expect(await infoWidth('slot-row-BENCH-201')).toBeGreaterThanOrEqual(128);
  });
}

// #1958 (spec #1956 L8): the page's move strip sits in the page's sticky footer,
// stacked above the phone Starters/Bench/Outlook bar. Two bottom-sticky siblings
// cannot stack from offsets alone (the one earlier in the DOM wins near the
// end of scroll), so this walks the whole scroll range and asserts, at every
// step, that the strip and the tab bar never intersect and every tab button is
// the topmost element at its own centre (nothing covers it).
test('at 390px the move strip never overlaps the tab bar at any scroll position', async ({ page }) => {
  await openLineup(page, PHONE);

  const selectRow = page.getByTestId('slot-row-RB-0-select');
  await expect(selectRow).toBeVisible();
  await selectRow.click({ position: { x: 6, y: 6 } });
  const strip = page.getByTestId('lineup-move-strip');
  await expect(strip).toBeVisible();
  const tabs = page.getByTestId('lineup-mobile-tabs');

  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(maxScroll, 'the page must scroll for this check to mean anything').toBeGreaterThan(0);

  for (let y = 0; y <= maxScroll + 25; y += 25) {
    await page.evaluate((top) => window.scrollTo(0, top), Math.min(y, maxScroll));
    const stripBox = await box(strip);
    const tabsBox = await box(tabs);
    const apart = stripBox.y + stripBox.height <= tabsBox.y + 0.5 || tabsBox.y + tabsBox.height <= stripBox.y + 0.5;
    expect(apart, `strip ${JSON.stringify(stripBox)} and tab bar ${JSON.stringify(tabsBox)} intersect at scrollY ${y}`).toBe(true);
    const covered = await tabs.getByRole('button').evaluateAll((buttons) =>
      buttons.filter((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !(hit && (hit === button || button.contains(hit)));
      }).length
    );
    expect(covered, `a tab button is covered at scrollY ${y}`).toBe(0);
  }
});

// #1965: one phone bar, Starters | Bench | Outlook, page-owned and pinned over
// either column. Measured at 390x844, scrolled to the bottom: the bar's bottom
// edge sits on the viewport's bottom edge on the Starters view and on the
// Outlook view (where the roster column, which a bar inside it would live in,
// is hidden), and the first starter row sits higher than it did at 330ede27,
// where the removed Roster/Outlook control above the grid took about 60px.
// The bar is fixed below `sm` (a sticky one rests above the app Footer at the
// end of the scroll), so a second case checks the last row is not left under
// the bar or the strip.
const FIRST_STARTER_TOP_AT_330EDE27 = 584.34;

test('at 390px the one bar sticks to the viewport bottom on Starters and Outlook, and the first starter sits higher', async ({ page }) => {
  await openLineup(page, PHONE);
  const tabs = page.getByTestId('lineup-mobile-tabs');
  await expect(tabs.getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('lineup-mobile-view')).toHaveCount(0);

  const firstStarter = await box(page.getByTestId('slot-row-QB-0'));
  expect(firstStarter.y, 'the removed control took about 60px').toBeLessThan(FIRST_STARTER_TOP_AT_330EDE27 - 50);

  const barBottomGap = async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = await box(tabs);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    return viewportHeight - (bar.y + bar.height);
  };

  expect(Math.abs(await barBottomGap())).toBeLessThanOrEqual(1);

  await tabs.getByRole('button', { name: 'Outlook' }).click();
  await expect(page.getByTestId('lineup-outlook-column')).toBeVisible();
  await expect(page.getByTestId('lineup-roster-column')).toBeHidden();
  expect(Math.abs(await barBottomGap())).toBeLessThanOrEqual(1);
});

test('at 390px the last Starters and Bench rows and the Footer links clear the bar and the strip at the end of the scroll', async ({ page }) => {
  await openLineup(page, PHONE);
  const tabs = page.getByTestId('lineup-mobile-tabs');
  const toEnd = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await toEnd();
  const starters = await box(page.getByTestId('ledger-starters'));
  const barTop = (await box(tabs)).y;
  expect(starters.y + starters.height).toBeLessThanOrEqual(barTop);
  // The app Footer's last link is not left under the bar either.
  const lastLink = await box(page.getByRole('link', { name: 'Acceptable Use' }));
  expect(lastLink.y + lastLink.height).toBeLessThanOrEqual(barTop);

  // Selecting a starter flips to Bench (#1425) and raises the strip over the bar.
  await page.getByTestId('slot-row-RB-0-select').click({ position: { x: 6, y: 6 } });
  const strip = page.getByTestId('lineup-move-strip');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('ledger-bench')).toBeVisible();
  await toEnd();
  const bench = await box(page.getByTestId('ledger-bench'));
  expect(bench.y + bench.height).toBeLessThanOrEqual((await box(strip)).y);
});

// #1965 review: the app Snackbar is bottom-anchored, so a toast would sit on top
// of the fixed bar (a save toast with Undo lingers 20s). A real swap, its PUT
// answered 200, raises the "Lineup saved" toast; its bottom edge must clear the
// bar's top. Same viewport: the root's scroll padding must leave room for the
// bar and a pending strip, so a Tab-focused row is not scrolled under them
// (WCAG 2.4.11).
test('at 390px a save toast sits above the bar and focused rows scroll clear of the bar and strip', async ({ page }) => {
  await openLineup(page, PHONE);
  await page.route('**/api/team/lineup', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.fallback()
  );

  const scrollPaddingBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom));
  expect(scrollPaddingBottom, 'bar (54) plus strip (78)').toBeGreaterThanOrEqual(132);

  await page.getByTestId('slot-row-RB-0-select').click({ position: { x: 6, y: 6 } });
  await expect(page.getByTestId('ledger-bench')).toBeVisible();
  await page.getByTestId('ledger-bench-rows').locator('[data-testid$="-select"]:not([disabled])').first().click({ position: { x: 6, y: 6 } });

  const toast = page.locator('.MuiSnackbar-root');
  await expect(toast).toContainText('Lineup saved');
  const toastBox = await box(toast);
  const barBox = await box(page.getByTestId('lineup-mobile-tabs'));
  expect(toastBox.y + toastBox.height, `toast ${JSON.stringify(toastBox)} over bar ${JSON.stringify(barBox)}`).toBeLessThanOrEqual(barBox.y);
});
