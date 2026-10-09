/**
 * Layout guard for the Players page's first screen (#1975, spec #1973 P3 P4
 * P6-P9): the compact header and two-row filter bar put the table head high on
 * the page, rows stay 72px or less, the head sticks to the viewport top from
 * `lg`, and a phone card is short enough that the first card sits above the
 * fold. jsdom has no layout engine, so this mirrors tests/e2e/players-list.spec.ts:
 * `page.route` API stubs, headless Chromium, bounding-box probes. It runs in
 * the `browser-security` job (`npm run test:e2e`), which collects every spec
 * under tests/e2e with no file argument.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupPlayersPageLayout, PLAYERS_LAYOUT_URL, PLAYERS_LAYOUT_LEAGUE_NAME } from './fixtures/playersPageLayoutFixtures';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const HEAD_TOP_MAX = 330;
const ROW_HEIGHT_MAX = 72;
const CARD_TOP_MAX = 360;
const CARD_HEIGHT_MAX = 220;
const ACCENT = 'rgb(30, 91, 184)';

/** Table head top and every body row's height, in CSS px. */
function probeTable() {
  const head = document.querySelector('table thead th');
  const rows = Array.from(document.querySelectorAll('[data-testid="player-row"]'));
  return {
    headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
    rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
  };
}

/** The first th's top and computed background. */
function probeHead() {
  const th = document.querySelector('table thead th') as HTMLElement | null;
  if (!th) return { top: null, background: null };
  return { top: th.getBoundingClientRect().top, background: getComputedStyle(th).backgroundColor };
}

/** Largest row height; the predicate the desktop assertion and its negative control share. */
const tallestRow = (heights: number[]) => Math.max(0, ...heights);

async function openDesktop(page: Page) {
  await setupPlayersPageLayout(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

test('1440x900: the table head starts at or above y=330 and every row is 72px or less', async ({ page }) => {
  await openDesktop(page);
  const { headTop, rowHeights } = await page.evaluate(probeTable);
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_DESKTOP ${JSON.stringify({ headTop, rowHeights })}`);
  expect(headTop, 'the table head must render').not.toBeNull();
  expect(headTop!, `table head top ${headTop}`).toBeLessThanOrEqual(HEAD_TOP_MAX);
  expect(rowHeights.length).toBe(10);
  expect(tallestRow(rowHeights), `row heights ${JSON.stringify(rowHeights)}`).toBeLessThanOrEqual(ROW_HEIGHT_MAX);
});

test('1440x900: the head sticks to the viewport top after scrolling and is not the accent fill', async ({ page }) => {
  await openDesktop(page);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))));
  const head = await page.evaluate(probeHead);
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_STICKY ${JSON.stringify(head)}`);
  expect(head.top, 'the first th must render').not.toBeNull();
  expect(head.top!, `first th top ${head.top} after scrollTo(0, 900)`).toBeGreaterThanOrEqual(0);
  expect(head.top!, `first th top ${head.top} after scrollTo(0, 900)`).toBeLessThanOrEqual(2);
  expect(head.background, `head background ${head.background}`).not.toBe(ACCENT);
});

test('390x844: the league is named, the first card starts at or above y=360, is 220px or less, and nothing scrolls sideways', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize(PHONE);
  await page.goto(PLAYERS_LAYOUT_URL);
  const card = page.getByTestId('player-row-card').first();
  await expect(card).toBeVisible();
  // The League select lives in the Filters drawer on a phone, so the header names the league.
  await expect(page.getByRole('main').getByText(PLAYERS_LAYOUT_LEAGUE_NAME, { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const box = await card.boundingBox();
  expect(box, 'the first card must have a measurable box').not.toBeNull();
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_PHONE ${JSON.stringify({ top: box!.y, height: box!.height, ...doc })}`);
  expect(box!.y, `first card top ${box!.y}`).toBeLessThanOrEqual(CARD_TOP_MAX);
  expect(box!.height, `first card height ${box!.height}`).toBeLessThanOrEqual(CARD_HEIGHT_MAX);
  expect(doc.scrollWidth, `document scrollWidth ${doc.scrollWidth} vs clientWidth ${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
});

/**
 * Each body row's Weeks strip: the span from its first week column's left
 * edge to its last one's right edge (the strip box itself fills whatever
 * spare width the table hands the cell).
 */
function probeWeeks() {
  const strips = Array.from(document.querySelectorAll('[data-testid="player-row"] [data-testid="weekly-points-bars"]'));
  const container = document.querySelector('table')?.parentElement as HTMLElement | null;
  const span = (strip: Element) => {
    const columns = Array.from(strip.children).map((column) => column.getBoundingClientRect());
    return Math.round(Math.max(...columns.map((c) => c.right)) - Math.min(...columns.map((c) => c.left)));
  };
  return {
    strips: strips.map((strip) => ({ width: span(strip) })),
    container: container ? { scrollWidth: container.scrollWidth, clientWidth: container.clientWidth } : null,
  };
}

const WEEKS_STRIP_MAX = 160;

test('1440x900: a player Unavailable every week keeps the Weeks strip as narrow as a points row', async ({ page }) => {
  await setupPlayersPageLayout(page, { seasonUnavailable: true });
  await page.setViewportSize(DESKTOP);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const { strips, container } = await page.evaluate(probeWeeks);
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_WEEKS ${JSON.stringify({ strips, container })}`);
  expect(strips.length).toBe(10);
  for (const strip of strips) expect(strip.width, `strips ${JSON.stringify(strips)}`).toBeLessThanOrEqual(WEEKS_STRIP_MAX);
  expect(container!.scrollWidth, `table container ${JSON.stringify(container)}`).toBeLessThanOrEqual(container!.clientWidth + 1);
});

// Permanent negative control (the pattern players-list.spec.ts uses for
// width): proves the row height predicate can still go red, so a quietly
// broken assertion doesn't read as a clean pass forever.
test('negative control: the row height predicate reports a forced tall row', async ({ page }) => {
  await openDesktop(page);

  const before = await page.evaluate(probeTable);
  expect(tallestRow(before.rowHeights)).toBeLessThanOrEqual(ROW_HEIGHT_MAX);

  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="player-row"]') as HTMLElement;
    row.style.height = '200px';
  });
  const during = await page.evaluate(probeTable);
  expect(tallestRow(during.rowHeights)).toBeGreaterThan(ROW_HEIGHT_MAX);

  await page.evaluate(() => {
    (document.querySelector('[data-testid="player-row"]') as HTMLElement).style.height = '';
  });
  const after = await page.evaluate(probeTable);
  expect(tallestRow(after.rowHeights)).toBeLessThanOrEqual(ROW_HEIGHT_MAX);
});

// The card's metrics and bars share one line that must not wrap, so the card
// height does not depend on the font (CI's fallback font is wider than a dev
// machine's). 320 is the narrowest phone the app supports.
test('320x700: the first card is 220px or less and nothing scrolls sideways', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(PLAYERS_LAYOUT_URL);
  const card = page.getByTestId('player-row-card').first();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const box = await card.boundingBox();
  expect(box, 'the first card must have a measurable box').not.toBeNull();
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_PHONE_320 ${JSON.stringify({ top: box!.y, height: box!.height, ...doc })}`);
  expect(box!.height, `first card height ${box!.height} at 320`).toBeLessThanOrEqual(CARD_HEIGHT_MAX);
  expect(doc.scrollWidth, `document scrollWidth ${doc.scrollWidth} vs clientWidth ${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
});
