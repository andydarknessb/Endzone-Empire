/**
 * Home "Play-select" guard (#2315). jsdom has no layout engine, no :hover and
 * no CSS animation, so this mirrors tests/e2e/my-leagues-layout.spec.ts:
 * `page.route` API stubs (fixtures/homePlayselectFixtures.ts, four states that
 * mirror the boards in docs/design/home/), headless Chromium, DOM probes.
 *
 *  - Every state x viewport x colour scheme: one cursor, one filled foot, no
 *    sideways scroll, plus a full-page screenshot under test-results/home-shots/
 *    (review artefacts, not snapshot assertions).
 *  - Motion (docs/design/home/check-motion.js, ported): the cursor follows hover
 *    and focus, the press drops the card, the score flashes on a changed score.
 *  - Game day: the Live scores head, the "updated" stamp, the 60 s refresh.
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  HOME_URL, homeBodies, setupHome,
} from './fixtures/homePlayselectFixtures';
import type { HomeState, HomeTheme } from './fixtures/homePlayselectFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
const STATES: HomeState[] = ['main', 'gameday', 'draftnight', 'firstrun'];
const THEMES: HomeTheme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'home-shots');
const CLEAR = 'rgba(0, 0, 0, 0)';

// Real bugs found while writing this spec stay visible as fixme with the evidence in the title;
// the key is `${state}-${viewport}`.
const KNOWN_BUGS: Record<string, string> = {};

async function openHome(
  page: Page,
  state: HomeState,
  viewport: ViewportName,
  opts: { theme?: HomeTheme; clock?: boolean; reducedMotion?: 'reduce' | 'no-preference' } = {}
) {
  const now = Date.now();
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: opts.reducedMotion });
  if (opts.clock) await page.clock.install({ time: now });
  const harness = await setupHome(page, state, { theme: opts.theme, now });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(HOME_URL);
  await settled(page, state);
  return { harness, now };
}

/** Home has painted its state: the state's own landmark, then the fonts. */
async function settled(page: Page, state: HomeState) {
  if (state === 'firstrun') {
    await expect(page.getByTestId('leagues-empty-state')).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Call your plays' })).toBeVisible();
    await expect(page.getByRole('heading', { name: state === 'gameday' ? 'Live scores' : 'My leagues' })).toBeVisible();
    await expect(page.locator('.slot').first()).toBeVisible();
  }
  if (state !== 'gameday') await expect(page.getByRole('heading', { name: 'Columns' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

for (const state of STATES) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    for (const theme of THEMES) {
      const bug = KNOWN_BUGS[`${state}-${viewport}`];
      const run = bug ? test.fixme : test;
      run(`${state} ${viewport} ${theme}: one cursor, one filled foot, no sideways scroll${bug ? ` (${bug})` : ''}`, async ({ page }) => {
        await openHome(page, state, viewport, { theme });

        const probe = await page.evaluate(() => ({
          cursors: document.querySelectorAll('.cursor').length,
          filled: document.querySelectorAll('[data-filled="true"]').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          background: getComputedStyle(document.querySelector('.home-root') as Element).backgroundColor,
        }));
        // eslint-disable-next-line no-console
        console.log(`HOME_PLAYSELECT ${state}-${viewport}-${theme} ${JSON.stringify(probe)}`);

        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${state}-${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

        expect(probe.cursors, 'exactly one .cursor').toBe(1);
        expect(probe.filled, 'exactly one data-filled="true" foot').toBe(1);
        expect(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs clientWidth ${probe.clientWidth}`).toBeLessThanOrEqual(probe.clientWidth);
        expect(probe.bodyScrollWidth, `body scrollWidth ${probe.bodyScrollWidth} vs clientWidth ${probe.clientWidth}`).toBeLessThanOrEqual(probe.clientWidth);
      });
    }
  }
}

// The two schemes must actually differ, so a theme the app ignored cannot pass the matrix as a pair of identical shots.
test('the stored endzone_theme picks the scheme: dark and light paint different Home backgrounds', async ({ browser }) => {
  const paint = async (theme: HomeTheme) => {
    // A fresh context each time: localStorage is per context and a second goto to the same hash URL would not reload.
    const page = await (await browser.newContext()).newPage();
    await openHome(page, 'firstrun', 'desktop', { theme });
    return page.evaluate(() => getComputedStyle(document.querySelector('.home-root') as Element).backgroundColor);
  };
  const dark = await paint('dark');
  const light = await paint('light');
  expect(dark).not.toBe(light);
});

// Motion: draftnight has two play cards (main has one), so the second can take the cursor.
for (const motion of ['no-preference', 'reduce'] as const) {
  test(`motion (${motion}): hover and keyboard focus move the cursor to the second card; press frames it white`, async ({ page }) => {
    await openHome(page, 'draftnight', 'desktop', { reducedMotion: motion });
    const slots = page.locator('.slot');
    expect(await slots.count(), 'draftnight has two play cards').toBe(2);
    const borders = () => page.$$eval('.slot', (els) => els.map((e) => getComputedStyle(e).borderTopColor));

    // The load blink runs 1.5 s (steps, three beats); wait it out, reduced motion has none.
    await page.waitForTimeout(motion === 'reduce' ? 100 : 1700);
    const before = await borders();
    expect(before[0], 'the lead holds the cursor').not.toBe(CLEAR);
    expect(before[1], 'the second card starts clear').toBe(CLEAR);

    await slots.nth(1).hover();
    await page.waitForTimeout(50);
    const hovered = await borders();
    expect(hovered[0], 'the lead clears while another card is hovered').toBe(CLEAR);
    expect(hovered[1], 'the cursor is on the hovered card').not.toBe(CLEAR);

    await page.mouse.move(0, 0);
    await page.waitForTimeout(50);
    expect((await borders())[0], 'the lead gets its cursor back when the pointer leaves').not.toBe(CLEAR);

    // Keyboard: start inside the lead and Tab to the second card.
    await slots.nth(0).locator('a').first().focus();
    let focused = await borders();
    for (let i = 0; i < 4 && focused[1] === CLEAR; i += 1) {
      await page.keyboard.press('Tab');
      focused = await borders();
    }
    expect(focused[1], 'the cursor follows keyboard focus').not.toBe(CLEAR);
    expect(focused[0], 'one cursor under focus').toBe(CLEAR);
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    const box = await slots.nth(1).boundingBox();
    expect(box, 'the second card has a box').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
    await page.mouse.down();
    const pressed = await slots.nth(1).evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e.firstElementChild as Element).transform]);
    // Release off the card so the press does not follow the link away.
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(pressed[0], 'the press frame is white').toBe('rgb(255, 255, 255)');
    expect(pressed[1], 'the press drop follows the motion preference').toBe(motion === 'reduce' ? 'none' : 'matrix(1, 0, 0, 1, 2, 2)');
  });
}

// Game day.
async function openGameDay(page: Page, reducedMotion?: 'reduce' | 'no-preference') {
  const opened = await openHome(page, 'gameday', 'desktop', { clock: true, reducedMotion });
  return opened;
}

test('game day: Live scores head and the updated stamp are visible; the leagues reload after 60 s', async ({ page }) => {
  const { harness } = await openGameDay(page);
  await expect(page.getByRole('heading', { name: 'Live scores' })).toBeVisible();
  await expect(page.getByText(/updated just now · refreshes every minute/)).toBeVisible();
  await expect(page.getByText('Matchup').first()).toBeVisible();
  // The dev build runs in StrictMode, which mounts effects twice, so count from here rather than assuming one load read.
  const loaded = harness.leagueRequests();
  expect(loaded, 'the page read the leagues on load').toBeGreaterThan(0);

  await page.clock.runFor(60 * 1000);
  await expect.poll(harness.leagueRequests, { message: 'another /api/league request after 60 s of fake time' }).toBeGreaterThan(loaded);
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`game day (${motion}): a changed score flashes that tile's score link`, async ({ page }) => {
    const { harness, now } = await openGameDay(page, motion);
    const tnrLink = page.getByRole('link', { name: /^Thursday Night Regulars matchup/ });
    await expect(tnrLink).toBeVisible();
    await expect(page.locator('.home-root .scored'), 'the first render of a league never flashes').toHaveCount(0);

    // Record every .scored class add so the flash is caught even if it is short-lived.
    await page.evaluate(() => {
      const w = window as unknown as { __scored: Array<{ at: number; name: string; count: string }> };
      w.__scored = [];
      new MutationObserver(() => {
        document.querySelectorAll('.home-root .scored').forEach((el) => {
          const cs = getComputedStyle(el);
          w.__scored.push({ at: performance.now(), name: cs.animationName, count: cs.animationIterationCount });
        });
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    });

    harness.setLeagues(homeBodies('gameday', now, { tnrScore: 94.6 }).leagues);
    await page.clock.runFor(60 * 1000);

    await expect(page.getByRole('link', { name: /Thursday Night Regulars matchup.*94\.6/ })).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __scored: Array<{ name: string; count: string }> }).__scored);
    expect(seen.length, 'the score link was marked .scored after the refresh').toBeGreaterThan(0);
    const expected = motion === 'reduce' ? { name: 'home-scored-hold', count: '1' } : { name: 'home-scored', count: '3' };
    expect({ name: seen[0].name, count: seen[0].count }, `animation on the .scored link (${motion})`).toEqual(expected);
  });
}

// BUG (found writing this spec, app code untouched): the flash is cut short. LeagueStatusGrid marks a tile `scored`
// for the one render where its score signature changed; the action-items refetch the same tick triggers
// (UserPage setActionItems -> re-render) renders the grid again with seen.current already updated, so the class
// is gone ~12 ms later (MutationObserver log: [[60012, 1], [60024, 0]]) instead of holding for the 0.9 s animation.
test.fixme('game day: the .scored class holds for the whole flash (>= 900 ms), not one render', async ({ page }) => {
  const { harness, now } = await openGameDay(page);
  harness.setLeagues(homeBodies('gameday', now, { tnrScore: 94.6 }).leagues);
  await page.clock.runFor(60 * 1000);
  await expect(page.locator('.home-root .scored')).toHaveCount(1);
  await page.waitForTimeout(900);
  await expect(page.locator('.home-root .scored')).toHaveCount(1);
});
