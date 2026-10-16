/**
 * Pick'em wave 2 guard (#2334, ADR 0067): the Pick'em page on Play-select with save on tap. jsdom has
 * no layout engine, so this mirrors tests/e2e/league-dashboard-playselect.spec.ts: `page.route` API
 * stubs (fixtures/pickemWave2Fixtures.ts, layered on the layout-guard harness, the page clock fixed at
 * Sunday 2:40 PM CDT), headless Chromium, DOM probes.
 *
 * Every state x viewport x colour scheme (Picks with an open week, Standings):
 *  - the page's cursors: exactly one on Picks, on the earliest unpicked unlocked game, none on Standings;
 *  - no sideways scroll on the document or the body;
 *  - no element with an opacity below 1, nothing sticky or fixed at the bottom of the page;
 *  - a full-page screenshot under test-results/pickem-shots/ (review artefacts, not snapshot assertions).
 * Plus the week picker (scrolls inside its own box, the next arrow stays visible), the first team
 * button inside the 1440x900 first screen, the keyboard path (one week tab stop, button names, the
 * next-lock jump) and the save-on-tap round trip.
 *
 * What this does NOT cover: colours (src/theme/tokens.contrast.test.js), the card-level states (the
 * jsdom suites under src/widgets/pickem-board).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PICKEM_URL, STANDINGS_URL, setupPickem } from './fixtures/pickemWave2Fixtures';
import type { PickemHarness, PickemTheme } from './fixtures/pickemWave2Fixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
const THEMES: PickemTheme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'pickem-shots');
let unanswered: string[] = [];

test.afterEach(() => {
  expect(unanswered, 'every request the page makes is answered by the fixture').toEqual([]);
});

async function openPickem(
  page: Page,
  viewport: ViewportName,
  theme: PickemTheme,
  { url = PICKEM_URL, mode }: { url?: string; mode?: 'straight' | 'confidence' } = {},
): Promise<PickemHarness> {
  unanswered = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    // The boot-time token refresh is outside every harness's table (the guard's catch-all 500s it too).
    if (res.status() === 500 && pathname.startsWith('/api/') && pathname !== '/api/auth/refresh') unanswered.push(pathname);
  });
  const harness = await setupPickem(page, { theme, mode });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: "Pick'em" })).toBeVisible();
  if (url === PICKEM_URL) await expect(page.getByTestId('pickem-status')).toBeVisible();
  else await expect(page.getByTestId('pickem-standings-you-row')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // The load blink runs in steps; the cursor count is stable through it.
  await page.waitForTimeout(150);
  return harness;
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test(`picks ${viewport} ${theme}: one cursor on the earliest unpicked game, no sideways scroll, no opacity, nothing at the bottom`, async ({ page }) => {
      await openPickem(page, viewport, theme);

      const probe = await page.evaluate(() => {
        const column = document.querySelector('[data-testid="pickem-column"]')!;
        const faded = Array.from(column.querySelectorAll('*')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length;
        const pinned = Array.from(column.querySelectorAll('*')).filter((el) => {
          const style = getComputedStyle(el);
          return (style.position === 'fixed' || style.position === 'sticky') && style.bottom !== 'auto';
        }).length;
        return {
          cursors: document.querySelectorAll('.cursor').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          faded,
          pinned,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`PICKEM_WAVE2 picks-${viewport}-${theme} ${JSON.stringify(probe)}`);
      expect(probe.cursors).toBe(1);
      await expect(page.locator('.cursor').getByRole('article', { name: /^ARI at SF/ })).toBeVisible();
      expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth);
      expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.innerWidth);
      expect(probe.faded, 'no element has an opacity below 1').toBe(0);
      expect(probe.pinned, 'nothing sticky or fixed at the bottom of the page').toBe(0);

      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `picks-${viewport}-${theme}.png`), fullPage: true });
    });

    test(`standings ${viewport} ${theme}: no cursor, no sideways scroll, the table scrolls inside its own box`, async ({ page }) => {
      await openPickem(page, viewport, theme, { url: STANDINGS_URL });

      const probe = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="pickem-standings-scroll"]')!;
        const rank = scroller.querySelector('tbody td')!;
        return {
          cursors: document.querySelectorAll('.cursor').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          boxScroll: scroller.scrollWidth,
          boxClient: scroller.clientWidth,
          stickyRank: getComputedStyle(rank).position,
          faded: Array.from(document.querySelectorAll('[data-testid="pickem-column"] *')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`PICKEM_WAVE2 standings-${viewport}-${theme} ${JSON.stringify(probe)}`);
      expect(probe.cursors).toBe(0);
      expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth);
      expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.innerWidth);
      expect(probe.stickyRank, 'the first column stays put while the table scrolls').toBe('sticky');
      if (viewport === 'phone') expect(probe.boxScroll, 'the table is wider than the phone and scrolls in its box').toBeGreaterThan(probe.boxClient);
      expect(probe.faded).toBe(0);

      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `standings-${viewport}-${theme}.png`), fullPage: true });
    });
  }
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`${viewport}: the week buttons scroll inside their own box and the next-week arrow stays visible`, async ({ page }) => {
    await openPickem(page, viewport, 'dark');
    const probe = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="pick-week-weeks"]')!;
      const group = document.querySelector('[data-testid="pick-week"]')!;
      const next = Array.from(group.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Next week')!;
      const stripBox = strip.getBoundingClientRect();
      const groupBox = group.getBoundingClientRect();
      const nextBox = next.getBoundingClientRect();
      return {
        stripScroll: strip.scrollWidth,
        stripClient: strip.clientWidth,
        stripRight: stripBox.right,
        groupRight: groupBox.right,
        nextRight: nextBox.right,
        nextLeft: nextBox.left,
        stripLeft: stripBox.left,
        innerWidth: window.innerWidth,
        weeks: strip.querySelectorAll('[role="radio"]').length,
      };
    });
    expect(probe.weeks).toBe(18);
    if (viewport === 'phone') expect(probe.stripScroll, 'eighteen weeks do not fit a phone').toBeGreaterThan(probe.stripClient);
    expect(probe.stripRight, 'the strip stays inside the picker').toBeLessThanOrEqual(probe.groupRight + 0.5);
    expect(probe.nextRight, 'the next-week arrow is on screen').toBeLessThanOrEqual(probe.innerWidth);
    expect(probe.nextLeft, 'the arrow sits outside the scroll box').toBeGreaterThanOrEqual(probe.stripRight - 0.5);
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next week' })).toBeInViewport();
  });
}

test('desktop: the first team button sits inside the 1440x900 first screen', async ({ page }) => {
  await openPickem(page, 'desktop', 'dark');
  const box = await page.getByRole('button', { name: /^ARI,/ }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(VIEWPORTS.desktop.height);
});

test('keyboard: Tab from the page top reaches the first team button past at most one week button, with a full name; the status line is a role=status; the next-lock link focuses the cursor card', async ({ page }) => {
  await openPickem(page, 'desktop', 'dark');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  let weekStops = 0;
  let name = '';
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        week: Boolean(el && el.getAttribute('role') === 'radio' && el.closest('[aria-label="Week"]')),
        team: Boolean(el && el.getAttribute('data-testid')?.startsWith('team-pick-')),
        name: el?.getAttribute('aria-label') || '',
      };
    });
    if (stop.week) weekStops += 1;
    if (stop.team) {
      name = stop.name;
      break;
    }
  }
  expect(weekStops, 'the week picker is one tab stop').toBeLessThanOrEqual(1);
  expect(name).toMatch(/ over /);
  expect(name).toMatch(/, (Sun|Mon|Thu) \d{1,2}:\d{2}\s?[AP]M/);
  expect(name).toMatch(/^ARI, /);

  // Each open card's save line is a status region.
  const card = page.getByRole('article', { name: /^ARI at SF/ });
  await expect(card.getByRole('status')).toHaveCount(1);

  // The next-lock link moves focus to the cursor card, with its window heading in view.
  await page.getByRole('link', { name: /next lock/ }).click();
  await expect(page.locator('#pickem-cursor')).toBeFocused();
  await expect(page.getByRole('heading', { level: 3, name: 'Sunday Late' })).toBeInViewport();
});

test('save on tap: one tap sends one one-element PUT, the card says Pick saved, and Undo clears it', async ({ page }) => {
  const harness = await openPickem(page, 'phone', 'dark');
  const card = page.getByRole('article', { name: /^ARI at SF/ });
  await card.getByRole('button', { name: /^ARI,/ }).click();

  await expect(card.getByRole('status')).toHaveText(/Pick saved/);
  expect(harness.puts()).toHaveLength(1);
  expect(harness.puts()[0].picks).toEqual([{ gameKey: 'ARI|SF', pickedTeam: 'ARI', confidence: null }]);
  await expect(page.getByRole('button', { name: /Save picks/i })).toHaveCount(0);
  await expect(page.getByTestId('pickem-status')).toContainText('10 of 14 picked');

  await card.getByRole('button', { name: /^Undo pick/ }).click();
  await expect.poll(() => harness.puts().length).toBe(2);
  expect(harness.puts()[1].picks).toEqual([{ gameKey: 'ARI|SF', pickedTeam: null, confidence: null }]);
  await expect(page.getByTestId('pickem-status')).toContainText('9 of 14 picked');
});
