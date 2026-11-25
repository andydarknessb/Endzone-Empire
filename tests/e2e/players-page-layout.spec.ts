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
import { setTheme } from './fixtures/draftHarness';
import {
  setupPlayersPageLayout, PLAYERS_LAYOUT_URL, PLAYERS_LAYOUT_LEAGUE_ID, PLAYERS_LAYOUT_LEAGUE_NAME,
} from './fixtures/playersPageLayoutFixtures';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const HEAD_TOP_MAX = 504;
const ROW_HEIGHT_MAX = 72;
const CARD_TOP_MAX = 407;
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

test('1440x900: the table head starts at or above y=504 and every row is 72px or less', async ({ page }) => {
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

test('390x844: the league is named, the first card starts at or above y=407, is 220px or less, and nothing scrolls sideways', async ({ page }) => {
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
  const strips = Array.from(document.querySelectorAll('[data-testid="player-row"] [data-testid="player-row-weeks"]'));
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
  // Relative to the first (points) row, so a gap or column-width tweak moves
  // every row together; the floor catches a probe that measured nothing.
  const pointsRow = strips[0].width;
  expect(pointsRow, `strips ${JSON.stringify(strips)}`).toBeGreaterThan(100);
  for (const strip of strips) expect(strip.width, `strips ${JSON.stringify(strips)}`).toBeLessThanOrEqual(pointsRow + 1);
  expect(container!.scrollWidth, `table container ${JSON.stringify(container)}`).toBeLessThanOrEqual(container!.clientWidth + 1);
});

// #3055: in the table at 900 to 1199px a long name or team line truncates inside the Player column, and the
// same long name is whole at 1440. The Player cell predicate is the one the negative control below shares.
const LONG_NAME = 'Marquez Valdes-Scantling';

/** Each body row's Player cell: elements under it that stick out past its right edge, and injury tags outside it. */
function probePlayerCells() {
  const rows = Array.from(document.querySelectorAll('[data-testid="player-row"]'));
  const overflowing: string[] = [];
  const tagsOutside: string[] = [];
  let tags = 0;
  for (const row of rows) {
    const cell = row.firstElementChild as HTMLElement;
    const edge = cell.getBoundingClientRect();
    for (const el of Array.from(cell.querySelectorAll('*'))) {
      if (el.getBoundingClientRect().right > edge.right + 1) overflowing.push(`${el.tagName} ${(el.textContent || '').trim().slice(0, 30)}`);
    }
    for (const tag of Array.from(cell.querySelectorAll('[data-status]'))) {
      tags += 1;
      const box = tag.getBoundingClientRect();
      if (box.left < edge.left - 1 || box.right > edge.right + 1) tagsOutside.push(tag.getAttribute('data-status') || '');
    }
  }
  return { rows: rows.length, tags, overflowing, tagsOutside };
}

async function openLongNames(page: Page, width: number) {
  await setupPlayersPageLayout(page, { longNames: true });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

test('1024x900: a long name, a team line with no NFL team and injury tags stay inside the Player cell', async ({ page }) => {
  await openLongNames(page, 1024);
  const probe = await page.evaluate(probePlayerCells);
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_PLAYER_CELL ${JSON.stringify(probe)}`);
  expect(probe.rows).toBe(10);
  expect(probe.tags, 'the Q and O injury tags are measured').toBe(2);
  expect(probe.overflowing, 'elements past the Player cell edge').toEqual([]);
  expect(probe.tagsOutside, 'injury tags outside the Player cell').toEqual([]);
});

test('negative control: forcing overflow visible on one long name turns the Player cell predicate red, then green again', async ({ page }) => {
  await openLongNames(page, 1024);
  expect((await page.evaluate(probePlayerCells)).overflowing).toEqual([]);

  await page.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('[data-testid="player-row"]')).find((r) => r.textContent?.includes(name));
    const button = row?.querySelector('th button') as HTMLElement;
    button.style.overflow = 'visible';
    button.style.textOverflow = 'clip';
  }, LONG_NAME);
  const during = await page.evaluate(probePlayerCells);
  expect(during.overflowing.length, 'the forced name sticks out of its cell').toBeGreaterThan(0);

  await page.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('[data-testid="player-row"]')).find((r) => r.textContent?.includes(name));
    const button = row?.querySelector('th button') as HTMLElement;
    button.style.overflow = '';
    button.style.textOverflow = '';
  }, LONG_NAME);
  expect((await page.evaluate(probePlayerCells)).overflowing).toEqual([]);
});

test('1440x900: the long name is not truncated (its button scrolls no wider than it is)', async ({ page }) => {
  await openLongNames(page, 1440);
  const name = await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll('[data-testid="player-row"] th button')).find((b) => b.textContent === text) as HTMLElement | undefined;
    return button ? { scrollWidth: button.scrollWidth, clientWidth: button.clientWidth } : null;
  }, LONG_NAME);
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LAYOUT_LONG_NAME_1440 ${JSON.stringify(name)}`);
  expect(name, 'the long name renders as a button').not.toBeNull();
  expect(name!.scrollWidth, `name scrollWidth ${name!.scrollWidth} vs clientWidth ${name!.clientWidth}`).toBeLessThanOrEqual(name!.clientWidth);
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

// #3057: a pager press moves focus to the list top, so the new page reads from its top, not from the pager.
// Both cases scroll to the bottom of a three-page list and press "Go to page 2".
async function pressPageTwoFromBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: 'Go to page 2' }).click();
}

// The list top's document position, read before the press (scroll does not change it): the press scrolls the top to
// scrollMarginTop (8px) below the viewport's top edge, or as near as the document can scroll.
function listDocTop(page: Page) {
  return page.evaluate(() => {
    const top = document.querySelector('[data-testid="player-pool-top"]') as HTMLElement;
    return top.getBoundingClientRect().top + window.scrollY;
  });
}

async function expectListTopAtMargin(page: Page, docTop: number) {
  const box = await page.getByTestId('player-pool-top').boundingBox();
  expect(box, 'the list top must have a measurable box').not.toBeNull();
  const expected = await page.evaluate(
    (top) => Math.max(8, top - (document.documentElement.scrollHeight - window.innerHeight)),
    docTop,
  );
  expect(Math.abs(box!.y - expected), `list top ${box!.y} on page 2, expected ${expected}`).toBeLessThanOrEqual(1);
}

test('390x844: Go to page 2 from the bottom focuses the list top and puts the first card of page 2 in view', async ({ page }) => {
  await setupPlayersPageLayout(page, { pages: 3 });
  await page.setViewportSize(PHONE);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row-card').first()).toBeVisible();
  const docTop = await listDocTop(page);
  await pressPageTwoFromBottom(page);
  const card = page.getByTestId('player-row-card').first();
  await expect(card).toContainText('Pager Player 11');
  await expect(page.getByTestId('player-pool-top')).toBeFocused();
  await expectListTopAtMargin(page, docTop);
  const box = await card.boundingBox();
  expect(box, 'the first card must have a measurable box').not.toBeNull();
  expect(box!.y, `first card top ${box!.y} on page 2`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `first card top ${box!.y} on page 2`).toBeLessThanOrEqual(PHONE.height);
});

test('1440x900: Go to page 2 from the bottom focuses the list top, and the list top is at the scroll margin', async ({ page }) => {
  await setupPlayersPageLayout(page, { pages: 3 });
  await page.setViewportSize(DESKTOP);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  const docTop = await listDocTop(page);
  await pressPageTwoFromBottom(page);
  await expect(page.getByTestId('player-row').first()).toContainText('Pager Player 11');
  await expect(page.getByTestId('player-pool-top')).toBeFocused();
  await expectListTopAtMargin(page, docTop);
});

// #3072: the focus ring is drawn on the scroll region, the table's parent, which the region's overflow cannot clip, and
// the table's own ring is off. A keyboard press shows the ring; a mouse press does not.
const RING_VIEWPORTS = [
  { width: 1440, height: 900 }, // stickyHead clips the region from lg (overflow-x: clip)
  { width: 1100, height: 800 }, // below lg the region scrolls (overflow-x: auto), and the table still renders
];

for (const viewport of RING_VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${viewport.width}x${viewport.height} ${theme}: a keyboard press on Go to page 2 rings the scroll region, not the table`, async ({ page }) => {
      await setTheme(page, theme);
      await setupPlayersPageLayout(page, { pages: 3 });
      await page.setViewportSize(viewport);
      await page.goto(PLAYERS_LAYOUT_URL);
      await expect(page.getByTestId('player-row')).toHaveCount(10);
      await page.getByRole('button', { name: 'Go to page 2' }).focus();
      await page.keyboard.press('Enter');
      const top = page.getByTestId('player-pool-top');
      await expect(top).toBeFocused();
      expect(await top.evaluate((el) => el.tagName), 'the list top is the table at this width').toBe('TABLE');
      const ring = await top.evaluate((el) => {
        const region = el.closest('[role="region"]') as HTMLElement;
        const style = getComputedStyle(region);
        const table = getComputedStyle(el);
        const box = region.getBoundingClientRect();
        const clippers: string[] = [];
        for (let node = region.parentElement; node; node = node.parentElement) {
          const s = getComputedStyle(node);
          if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clippers.push(node.className || node.tagName);
          if (node.classList.contains('ps-root')) break;
        }
        return {
          region: {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineOffset: style.outlineOffset,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow,
          },
          table: { outlineStyle: table.outlineStyle, boxShadow: table.boxShadow },
          clippers,
          widened: { left: box.left - 10, right: box.right + 10, innerWidth: window.innerWidth },
        };
      });
      expect(ring.region.outlineStyle, 'the region draws the ring').toBe('solid');
      expect(ring.region.outlineWidth).toBe('3px');
      expect(ring.region.outlineOffset).toBe('0px');
      expect(ring.region.outlineColor).toBe('rgb(255, 255, 255)');
      expect(ring.region.boxShadow).toContain('rgb(7, 8, 15)');
      expect(ring.region.boxShadow).toContain('7px');
      expect(ring.table).toEqual({ outlineStyle: 'none', boxShadow: 'none' });
      expect(ring.clippers, 'no ancestor of the region clips the ring').toEqual([]);
      expect(ring.widened.left, 'the ring starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(ring.widened.right, 'the ring ends inside the viewport').toBeLessThanOrEqual(ring.widened.innerWidth);
    });

    test(`${viewport.width}x${viewport.height} ${theme}: a mouse press on Go to page 2 draws no ring`, async ({ page }) => {
      await setTheme(page, theme);
      await setupPlayersPageLayout(page, { pages: 3 });
      await page.setViewportSize(viewport);
      await page.goto(PLAYERS_LAYOUT_URL);
      await expect(page.getByTestId('player-row')).toHaveCount(10);
      await page.getByRole('button', { name: 'Go to page 2' }).click();
      await expect(page.getByTestId('player-row').first()).toContainText('Pager Player 11');
      const top = page.getByTestId('player-pool-top');
      await expect(top).toBeFocused();
      const outline = await top.evaluate((el) => ({
        region: getComputedStyle(el.closest('[role="region"]') as HTMLElement).outlineStyle,
        table: getComputedStyle(el).outlineStyle,
      }));
      expect(outline).toEqual({ region: 'none', table: 'none' });
    });
  }
}

// Play-select (spec #2453): the page has no cursor and no filled action, never scrolls sideways, and
// every button is 44px, or 36px inside the desktop table.
/** Cursors, filled actions, page overflow, and every visible button/link below its minimum. */
function probePlayselect({ tableMin, otherMin }: { tableMin: number; otherMin: number }) {
  const controls = Array.from(document.querySelectorAll('.ps-root button, .ps-root a[href], .ps-root [role="button"]')) as HTMLElement[];
  const small = controls
    .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const min = el.closest('table') ? tableMin : otherMin;
      return { name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40), height: Math.round(r.height), min };
    })
    .filter((c) => c.height < c.min);
  return {
    cursors: document.querySelectorAll('.cursor').length,
    fills: document.querySelectorAll('[data-variant="fill"]').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    small,
  };
}

for (const viewport of [DESKTOP, PHONE]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${viewport.width} ${theme}: Play-select page has no cursor or fill, no sideways scroll, and buttons of at least 44px (36px in the desktop table)`, async ({ page }) => {
      await setTheme(page, theme);
      await setupPlayersPageLayout(page);
      await page.setViewportSize(viewport);
      await page.goto(PLAYERS_LAYOUT_URL);
      await expect(page.getByTestId(viewport === DESKTOP ? 'player-row' : 'player-row-card').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => true));

      const probe = await page.evaluate(probePlayselect, { tableMin: viewport === DESKTOP ? 36 : 44, otherMin: 44 });
      // eslint-disable-next-line no-console
      console.log(`PLAYERS_PLAYSELECT ${JSON.stringify({ viewport: viewport.width, theme, ...probe })}`);
      expect(probe.cursors, 'no .cursor on the Players page').toBe(0);
      expect(probe.fills, 'no filled action outside a modal').toBe(0);
      expect(probe.scrollWidth, `scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
      expect(probe.small, `controls under their minimum: ${JSON.stringify(probe.small)}`).toEqual([]);
    });
  }
}

// With stickyHead the region stops scrolling from lg (overflow-x: clip), which would hide a column the table
// overran; the table's painted right edge must stay inside the region's (as tests/e2e/waivers.spec.ts measures).
for (const width of [1440, 1200]) {
  test(`${width}: with stickyHead the table's right edge is at or left of the Players, scrollable region's`, async ({ page }) => {
    await setupPlayersPageLayout(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PLAYERS_LAYOUT_URL);
    await expect(page.getByTestId('player-row')).toHaveCount(10);
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const edges = await page.evaluate(() => {
      const region = document.querySelector('[aria-label="Players, scrollable"]') as HTMLElement;
      const table = region.querySelector('table') as HTMLElement;
      return {
        overflowX: getComputedStyle(region).overflowX,
        region: region.getBoundingClientRect().right,
        table: table.getBoundingClientRect().right,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`PLAYERS_LAYOUT_STICKY_EDGE ${JSON.stringify({ width, ...edges })}`);
    expect(edges.overflowX, 'stickyHead clips the region from lg').toBe('clip');
    expect(edges.table, `table right ${edges.table} vs region right ${edges.region}`).toBeLessThanOrEqual(edges.region + 0.5);
  });
}

// #3058: the list region is a tab stop only where it scrolls: below lg, or at any width without stickyHead.
test('1440x900: the Players, scrollable region has no tabindex, since stickyHead clips it from lg', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  await expect(page.locator('[aria-label="Players, scrollable"]')).not.toHaveAttribute('tabindex');
});

test('1024x900: the Players, scrollable region is a tab stop where it scrolls', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row')).toHaveCount(10);
  await expect(page.locator('[aria-label="Players, scrollable"]')).toHaveAttribute('tabindex', '0');
});

// #3058: the phone pager shows the first, current and last pages with no sibling pages, so forty pages fit one row.
test('390x844: the pager of forty pages sits on one row, every button and the ellipsis sharing one top edge', async ({ page }) => {
  await setupPlayersPageLayout(page, { pages: 40 });
  await page.setViewportSize(PHONE);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByRole('button', { name: 'Go to next page' })).toBeVisible();
  const tops = await page.locator('.MuiPagination-ul > li > *').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(tops.length, 'the pager has items').toBeGreaterThan(0);
  expect(Math.max(...tops) - Math.min(...tops), `pager tops ${JSON.stringify(tops)}`).toBeLessThanOrEqual(1);
});

// #3088: the phone pager holds one row down to 360 px at 63 pages (the live list: 1,561 players at 25 a page).
// PlayerManagement rewrites a URL without `league` to page 1, so each case names the fixture league and asserts the page reached.
const PHONE_375 = { width: 375, height: 844 };
const PHONE_360 = { width: 360, height: 800 };
const pagerUrl = (pageNumber: number) => `${PLAYERS_LAYOUT_URL}?league=${PLAYERS_LAYOUT_LEAGUE_ID}&page=${pageNumber}`;
for (const [name, viewport] of [['375x844', PHONE_375], ['360x800', PHONE_360]] as const) {
  for (const pageNumber of [1, 32, 61, 62, 63]) {
    test(`${name}: the pager of 63 pages sits on one row on page ${pageNumber}`, async ({ page }) => {
      await setupPlayersPageLayout(page, { pages: 63 });
      await page.setViewportSize(viewport);
      await page.goto(pagerUrl(pageNumber));
      await expect(page.getByRole('button', { name: `page ${pageNumber}`, exact: true })).toHaveAttribute('aria-current', 'page');
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const tops = await page.locator('.MuiPagination-ul > li > *').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
      expect(tops.length, 'the pager has items').toBeGreaterThan(0);
      expect(Math.max(...tops) - Math.min(...tops), `pager tops ${JSON.stringify(tops)}`).toBeLessThanOrEqual(1);
    });
  }
}

test('360x800: every pager button is at least 44px wide and tall at 63 pages', async ({ page }) => {
  await setupPlayersPageLayout(page, { pages: 63 });
  await page.setViewportSize(PHONE_360);
  await page.goto(pagerUrl(63));
  await expect(page.getByRole('button', { name: 'page 63', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const sizes = await page.locator('.MuiPagination-ul > li > button').evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(sizes.length, 'the pager has buttons').toBeGreaterThan(0);
  expect(sizes.filter((s) => s.width < 44 || s.height < 44), `pager button sizes ${JSON.stringify(sizes)}`).toEqual([]);
});

// Permanent negative control: the probe reports a forced cursor, fill and short button.
test('negative control: the Play-select probe reports a forced cursor, fill and short button', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize(PHONE);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row-card').first()).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.ps-root')!.insertAdjacentHTML('beforeend', '<div class="cursor"></div><button data-variant="fill" style="height:20px">x</button>');
  });
  const probe = await page.evaluate(probePlayselect, { tableMin: 44, otherMin: 44 });
  expect(probe.cursors).toBe(1);
  expect(probe.fills).toBe(1);
  expect(probe.small.length).toBeGreaterThan(0);
});

// #3060: the League picker is the Play-select native select, the same square 44px control as Position.
test('1440x900: the League select is 44px tall and square, its top level with the Position select, and no MUI select is on the page', async ({ page }) => {
  await openDesktop(page);
  const league = page.getByRole('combobox', { name: 'League' });
  const leagueBox = await league.boundingBox();
  const positionBox = await page.getByRole('combobox', { name: 'Position' }).boundingBox();
  const radius = await league.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(leagueBox, 'the League select must have a measurable box').not.toBeNull();
  expect(positionBox, 'the Position select must have a measurable box').not.toBeNull();
  expect(leagueBox!.height, `League select height ${leagueBox!.height}`).toBe(44);
  expect(radius, 'League select border-radius').toBe('0px');
  expect(Math.abs(leagueBox!.y - positionBox!.y), `League top ${leagueBox!.y} vs Position top ${positionBox!.y}`).toBeLessThanOrEqual(1);
  await expect(page.locator('.ps-root .MuiSelect-select')).toHaveCount(0);
});

// #3088: the selected League name is shown in full, measured in the select's own font against its content box.
test('1440x900: the League select shows the league name in full', async ({ page }) => {
  await openDesktop(page);
  const fit = await page.getByRole('combobox', { name: 'League' }).evaluate((el: HTMLSelectElement) => {
    const style = getComputedStyle(el);
    const name = el.selectedOptions[0]?.textContent ?? '';
    const probe = document.createElement('span');
    probe.textContent = name;
    Object.assign(probe.style, {
      position: 'absolute', whiteSpace: 'nowrap', fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing,
    });
    document.body.appendChild(probe);
    const textWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const contentWidth = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { name, textWidth, contentWidth };
  });
  expect(fit.name, 'the selected League option').toBe(PLAYERS_LAYOUT_LEAGUE_NAME);
  expect(fit.textWidth, `"${fit.name}" is ${fit.textWidth}px, the select's content box ${fit.contentWidth}px`).toBeLessThanOrEqual(fit.contentWidth);
});

test('390x844: with Filters open the League select is 44px tall, and no MUI select is on the page', async ({ page }) => {
  await setupPlayersPageLayout(page);
  await page.setViewportSize(PHONE);
  await page.goto(PLAYERS_LAYOUT_URL);
  await expect(page.getByTestId('player-row-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const league = page.getByRole('combobox', { name: 'League' });
  await expect(league).toBeVisible();
  const box = await league.boundingBox();
  expect(box, 'the League select must have a measurable box').not.toBeNull();
  expect(box!.height, `League select height ${box!.height} in the Filters drawer`).toBe(44);
  await expect(page.locator('.ps-root .MuiSelect-select')).toHaveCount(0);
});
