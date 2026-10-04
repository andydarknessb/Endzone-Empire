/**
 * Layout guard for My Leagues (#1982, spec #1979 L15): the page sits in a
 * medium MUI Container, so on a phone the first league card spans the screen
 * minus gutters and nothing scrolls sideways, and on a desktop the card list
 * stops at 900px instead of the old 80% of the window. jsdom has no layout
 * engine, so this mirrors tests/e2e/players-page-layout.spec.ts: `page.route`
 * API stubs, headless Chromium, bounding-box probes.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupMyLeaguesLayout, MY_LEAGUES_URL } from './fixtures/myLeaguesLayoutFixtures';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const CARD_WIDTH_MIN = 350;
const LIST_WIDTH_MAX = 900;

async function open(page: Page, viewport: { width: number; height: number }) {
  await setupMyLeaguesLayout(page);
  await page.setViewportSize(viewport);
  await page.goto(MY_LEAGUES_URL);
  await expect(page.getByTestId('shared-league-card')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/** The card list's width in CSS px; the predicate the desktop assertion and its negative control share. */
const listWidth = () => {
  const list = document.querySelector('[role="region"][aria-label="Your leagues"]');
  return list ? list.getBoundingClientRect().width : null;
};

test('390x844: the first league card is 350px or wider and nothing scrolls sideways', async ({ page }) => {
  await open(page, PHONE);
  const box = await page.getByTestId('shared-league-card').first().boundingBox();
  expect(box, 'the first card must have a measurable box').not.toBeNull();
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // eslint-disable-next-line no-console
  console.log(`MY_LEAGUES_PHONE ${JSON.stringify({ width: box!.width, ...doc })}`);
  expect(box!.width, `first card width ${box!.width}`).toBeGreaterThanOrEqual(CARD_WIDTH_MIN);
  expect(doc.scrollWidth, `document scrollWidth ${doc.scrollWidth} vs clientWidth ${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
});

test('1440x900: the card list is 900px wide or less', async ({ page }) => {
  await open(page, DESKTOP);
  const width = await page.evaluate(listWidth);
  // eslint-disable-next-line no-console
  console.log(`MY_LEAGUES_DESKTOP ${JSON.stringify({ width })}`);
  expect(width, 'the card list must render').not.toBeNull();
  expect(width!, `card list width ${width}`).toBeLessThanOrEqual(LIST_WIDTH_MAX);
});

// Permanent negative control (the pattern players-page-layout.spec.ts uses):
// proves the width predicate can still go red, so a quietly broken assertion
// doesn't read as a clean pass forever.
test('negative control: the list width predicate reports a forced wide list', async ({ page }) => {
  await open(page, DESKTOP);

  expect(await page.evaluate(listWidth)).toBeLessThanOrEqual(LIST_WIDTH_MAX);

  await page.evaluate(() => {
    (document.querySelector('[role="region"][aria-label="Your leagues"]') as HTMLElement).style.width = '1200px';
  });
  expect(await page.evaluate(listWidth)).toBeGreaterThan(LIST_WIDTH_MAX);

  await page.evaluate(() => {
    (document.querySelector('[role="region"][aria-label="Your leagues"]') as HTMLElement).style.width = '';
  });
  expect(await page.evaluate(listWidth)).toBeLessThanOrEqual(LIST_WIDTH_MAX);
});
