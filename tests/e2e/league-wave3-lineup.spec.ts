/**
 * Lineup on Play-select (ADR 0067 wave 3, spec #2347 AC 8 and 11). jsdom has no layout engine, so this mirrors
 * league-wave2-matchup.spec.ts: `page.route` API stubs (fixtures/wave3LineupFixtures.ts), headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, before kickoff (Sun 9:10 AM) and live (Sun 2:40 PM):
 *  - at most one cursor, and at most one filled action outside a modal (a filled action paints the Accent fill);
 *  - no sideways scroll on the document or the body;
 *  - every button and link on the page is at least 44px both ways;
 *  - no element with role "status" or "alert" holds a button (AC 8).
 * Plus the per-moment facts the rulings name: before kickoff the cursor is the Out starter and Apply is the one filled
 * action; live the cursor is the empty FLEX, carrying the lineup note in a Danger frame, and nothing is filled; and on a
 * phone the Outlook view and a move under way keep the same counts.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), row geometry (lineup-ledger-layout.spec.ts).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { type Moment, WAVE3_LINEUP_URL, setupWave3Lineup } from './fixtures/wave3LineupFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const MOMENTS: Moment[] = ['pre', 'live'];
const SHOTS = path.join('test-results', 'league-wave3-lineup-shots');

async function open(page: Page, moment: Moment, viewport: ViewportName, theme: Theme) {
  await setupWave3Lineup(page, moment, theme);
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(WAVE3_LINEUP_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Darkness Falls' })).toBeVisible();
  await expect(page.getByTestId('ledger-starters')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// What the guards read, from the live DOM. `filled` counts the Accent fill (a data-variant="fill" action, or anything
// the browser paints with the Accent token); `small` lists every visible button, link, select and radio on the page
// under 44px either way (the page column and the phone footer, not the app shell's own nav and footer).
const probe = (page: Page) => page.evaluate(() => {
  const swatch = document.createElement('i');
  swatch.style.backgroundColor = 'var(--ps-accent)';
  document.body.appendChild(swatch);
  const accent = getComputedStyle(swatch).backgroundColor;
  swatch.remove();
  const scope = [document.querySelector('[data-testid="lineup-page"]'), document.querySelector('[data-testid="lineup-sticky-footer"]')]
    .filter(Boolean) as Element[];
  const controls = scope.flatMap((root) => Array.from(root.querySelectorAll('button, a[href], select, [role="radio"]')));
  const visible = controls.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const small = visible
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
    .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  const filled = Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (el.getAttribute('data-variant') === 'fill' || getComputedStyle(el).backgroundColor === accent);
  }).length;
  const regionsWithButtons = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
    .filter((el) => el.querySelector('button, a[href]')).length;
  return {
    cursors: document.querySelectorAll('.cursor').length,
    filled,
    small,
    regionsWithButtons,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  };
});

for (const moment of MOMENTS) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    for (const theme of THEMES) {
      test(`Lineup ${moment} ${viewport} ${theme}: one cursor, one filled action, no sideways scroll, 44px targets, text-only live regions`, async ({ page }) => {
        await open(page, moment, viewport, theme);
        const result = await probe(page);
        // eslint-disable-next-line no-console
        console.log(`LEAGUE_WAVE3_LINEUP ${moment}-${viewport}-${theme} ${JSON.stringify({ ...result, small: result.small.length })}`);

        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${moment}-${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

        expect(result.cursors, 'at most one cursor').toBeLessThanOrEqual(1);
        expect(result.filled, 'at most one filled action outside a modal').toBeLessThanOrEqual(1);
        expect(result.small, `controls under 44px: ${result.small.join('; ')}`).toEqual([]);
        expect(result.regionsWithButtons, 'a status or alert region holds a button').toBe(0);
        expect(result.scrollWidth, `document scrollWidth ${result.scrollWidth} vs innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(result.innerWidth);
        expect(result.bodyScrollWidth, `body scrollWidth ${result.bodyScrollWidth} vs innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(result.innerWidth);
      });
    }
  }
}

test('before kickoff the cursor is the Out starter and Apply, with its plan line, is the one filled action', async ({ page }) => {
  await open(page, 'pre', 'desktop', 'light');
  await expect(page.locator('.cursor')).toHaveCount(1);
  await expect(page.getByTestId('slot-row-WR-0').locator('.cursor')).toHaveCount(1);
  await expect(page.getByTestId('slot-row-WR-0')).toContainText('Puka Nacua');
  const apply = page.getByTestId('start-sit-apply');
  await expect(apply).toBeVisible();
  await expect(page.locator('[data-variant="fill"]')).toHaveCount(1);
  await expect(page.getByTestId('start-sit-plan-line')).toContainText('Two moves');
  await expect(page.getByTestId('strip-advice')).toContainText('+23.0 pts');
  // Far from the lock: the calm Cursor frame.
  await expect(page.locator('.cursor')).not.toHaveAttribute('data-urgent', 'true');
  await expect(page.getByText('All weeks')).toHaveCount(0);
});

test('live the cursor is the empty FLEX in a Danger frame, with the lineup note, and nothing is filled', async ({ page }) => {
  await open(page, 'live', 'desktop', 'light');
  await expect(page.locator('.cursor')).toHaveCount(1);
  const flex = page.getByTestId('slot-row-FLEX-0');
  await expect(flex.locator('.cursor')).toHaveCount(1);
  await expect(flex.locator('.cursor')).toHaveAttribute('data-urgent', 'true');
  const note = flex.getByTestId('lineup-note');
  await expect(note).toContainText('no bench player can fill it');
  await expect(note.getByRole('link', { name: 'Free agents' })).toBeVisible();
  await expect(page.locator('[data-variant="fill"]')).toHaveCount(0);
  await expect(page.getByTestId('strip-advice')).toContainText('No bench move');
  await expect(page.getByTestId('start-sit-panel-empty')).toContainText('No move from your bench');
  await expect(page.getByText('Lineup set')).toHaveCount(0);
  await expect(page.getByText(/Bench points this season/)).toHaveCount(0);
});

test('the Bye clusters line names the clear time the waivers read returns', async ({ page }) => {
  await open(page, 'pre', 'desktop', 'light');
  await expect(page.getByTestId('bye-cluster-line')).toContainText(/Waivers clear \w{3} \d{1,2}:\d{2} [AP]M\.$/);
});

test.describe('on a phone', () => {
  test('the Outlook view keeps one filled action (Apply) and a Forecast that fits', async ({ page }) => {
    await open(page, 'pre', 'phone', 'dark');
    await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: 'Outlook' }).click();
    await expect(page.getByTestId('start-sit-apply')).toBeVisible();
    const result = await probe(page);
    expect(result.filled).toBe(1);
    expect(result.small, result.small.join('; ')).toEqual([]);
    expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth);
    expect(result.regionsWithButtons).toBe(0);
  });

  test('a move under way holds the one cursor on the pressed row, and the strip keeps its text in the live region and Cancel outside it', async ({ page }) => {
    await open(page, 'pre', 'phone', 'light');
    await page.getByTestId('slot-row-RB-0-select').click({ position: { x: 6, y: 6 } });
    const strip = page.getByTestId('lineup-move-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('status')).toContainText('Moving Jahmyr Gibbs');
    await expect(strip.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await expect(page.locator('.cursor')).toHaveCount(1);
    await expect(page.getByTestId('slot-row-RB-0').locator('.cursor')).toHaveCount(1);
    const result = await probe(page);
    expect(result.cursors).toBe(1);
    expect(result.filled).toBeLessThanOrEqual(1);
    expect(result.small, result.small.join('; ')).toEqual([]);
    expect(result.regionsWithButtons).toBe(0);
  });
});
