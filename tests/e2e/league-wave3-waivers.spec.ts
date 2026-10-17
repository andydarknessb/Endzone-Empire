/**
 * Waivers on Play-select (ADR 0067 wave 3, spec #2347 AC 8 and 11). jsdom has no layout engine, so this
 * mirrors league-wave2-matchup.spec.ts: `page.route` API stubs (fixtures/wave3WaiversFixtures.ts),
 * headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, on the FAAB board with one row expanded:
 *  - at most one cursor and at most one filled action outside a modal (here exactly one of each:
 *    Michael Wilson, the largest Upgrade the manager has not claimed);
 *  - no sideways scroll on the document or the body;
 *  - every button, link, radio, checkbox and select is at least 44px;
 *  - no role="status" or role="alert" element contains a button.
 * Plus the claim sheet at both widths: its Submit claim is the one filled action in the modal and every
 * control in it is 44px.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), row geometry (waivers.spec.ts).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  CLAIMED_NAMES, CURSOR_NAME, WAIVERS_URL, setupWave3Waivers,
} from './fixtures/wave3WaiversFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'league-wave3-waivers-shots');
const MIN_TARGET = 44;

async function open(page: Page, viewport: ViewportName, theme: Theme, search = '') {
  await setupWave3Waivers(page, theme);
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(`${WAIVERS_URL}${search}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Waivers' })).toBeVisible();
  if (!search) await expect(page.getByText(CURSOR_NAME).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// The page-level probe: cursors, filled actions outside any dialog, scroll widths, the live-region sweep and
// every control smaller than 44px. A filled action is the button the shared PsButton marks `data-variant="fill"`.
function probe() {
  const visible = (el: Element) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const outsideModal = (el: Element) => !el.closest('[role="dialog"]');
  const controls = Array.from(document.querySelectorAll('main button, main a[href], main [role="radio"], main input, main select, main textarea'))
    .filter((el) => visible(el) && el.getAttribute('aria-hidden') !== 'true' && (el as HTMLElement).tabIndex >= 0) as HTMLElement[];
  const small = controls
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((t) => Math.min(t.w, t.h) < 43.5);
  const live = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'));
  return {
    cursors: Array.from(document.querySelectorAll('.cursor')).filter(visible).length,
    filled: Array.from(document.querySelectorAll('[data-variant="fill"]')).filter((el) => visible(el) && outsideModal(el)).length,
    filledInModal: Array.from(document.querySelectorAll('[role="dialog"] [data-variant="fill"]')).length,
    liveWithButtons: live.filter((el) => el.querySelector('button, a[href], [role="button"]')).map((el) => el.textContent),
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
    small,
    controls: controls.length,
  };
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test(`Waivers FAAB ${viewport} ${theme}, one row expanded: one cursor, one filled action, no sideways scroll, 44px controls`, async ({ page }) => {
      await open(page, viewport, theme);
      const toggle = page.getByRole('button', { name: `Show details for ${CURSOR_NAME}` });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('waiver-row-detail')).toBeVisible();
      await expect(page.getByTestId('waiver-row-detail').getByText('Wilson logged a full practice on Friday.')).toBeVisible();

      const result = await page.evaluate(probe);
      // eslint-disable-next-line no-console
      console.log(`LEAGUE_WAVE3_WAIVERS ${viewport}-${theme} ${JSON.stringify({ ...result, small: result.small.length })}`);
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

      expect(result.cursors, 'the cursor is the one next claim').toBe(1);
      expect(result.filled, 'its Claim is the page\'s one filled action').toBe(1);
      expect(result.liveWithButtons, 'no live region holds a button').toEqual([]);
      expect(result.scrollWidth, `document scrollWidth ${result.scrollWidth} vs innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(result.innerWidth);
      expect(result.bodyScrollWidth, `body scrollWidth ${result.bodyScrollWidth} vs innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(result.innerWidth);
      expect(result.controls, 'the page exposes controls').toBeGreaterThan(10);
      expect(result.small, `controls under ${MIN_TARGET}px: ${JSON.stringify(result.small)}`).toEqual([]);

      // The cursor row is Michael Wilson, and his Claim is the filled one; the claimed rows' Claim #n are ghosts.
      await expect(page.locator('.cursor').first()).toContainText(CURSOR_NAME);
      await expect(page.locator('[data-variant="fill"]')).toHaveAccessibleName(`Claim ${CURSOR_NAME}`);
      for (const [index, name] of CLAIMED_NAMES.entries()) {
        await expect(page.getByRole('button', { name: `Claim #${index + 1} ${name}` })).toHaveAttribute('data-variant', 'ghost');
      }
    });

    test(`Waivers My claims ${viewport} ${theme}: the aside has no cursor or filled action, 44px controls, no live region holds a button`, async ({ page }) => {
      await open(page, viewport, theme, viewport === 'phone' ? '?tab=claims' : '');
      const aside = page.getByRole('complementary', { name: 'Waivers side panel' });
      await expect(aside).toBeVisible();
      await expect(aside.getByText('Only one of these can go through: #1 and #2 both drop Tyler Allgeier.')).toHaveCount(1);
      await expect(aside.getByText('Drop: Tyler Allgeier · Bid $14')).toBeVisible();
      await expect(aside.getByTestId('claim-result-line').first()).toBeVisible();

      const result = await page.evaluate(probe);
      expect(result.liveWithButtons).toEqual([]);
      expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth);
      expect(result.small, `controls under ${MIN_TARGET}px: ${JSON.stringify(result.small)}`).toEqual([]);
      if (viewport === 'phone') {
        expect(result.cursors, 'the list is on the other tab').toBe(0);
        expect(result.filled).toBe(0);
        // The tab's count is a description, not part of its name.
        const tab = page.getByRole('radio', { name: 'My claims' });
        await expect(tab).toHaveAccessibleDescription('2 pending claims');
      }
    });

    test(`Waivers claim sheet ${viewport} ${theme}: Submit claim is the one filled action in the modal, every control 44px`, async ({ page }) => {
      await open(page, viewport, theme);
      await page.getByRole('button', { name: `Claim ${CURSOR_NAME}` }).click();
      const sheet = page.getByRole('dialog', { name: new RegExp(`Claim ${CURSOR_NAME}`) });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('claim-sheet-swap')).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => true));

      // Initial focus is the first control: the server's suggested drop (the roster is full).
      await expect(sheet.getByRole('radio', { name: /Tyler Allgeier/ })).toBeFocused();

      const result = await page.evaluate(probe);
      expect(result.filledInModal, 'the sheet carries its own filled action').toBe(1);
      expect(result.liveWithButtons).toEqual([]);
      expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth);
      const sheetSmall = await sheet.locator('button, label:has(input), input[type="number"]').evaluateAll((els) => els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) };
        })
        .filter((t) => t.h < 43.5 || (t.w < 43.5 && t.name !== '')));
      expect(sheetSmall, `sheet controls under 44px: ${JSON.stringify(sheetSmall)}`).toEqual([]);
      if (viewport === 'phone') {
        const box = await sheet.boundingBox();
        expect(box?.height, 'the phone sheet fills the screen').toBeGreaterThanOrEqual(VIEWPORTS.phone.height - 1);
      }

      // Escape closes it and focus returns to the row's Claim.
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(page.getByRole('button', { name: `Claim ${CURSOR_NAME}` })).toBeFocused();
    });
  }
}

// Permanent negative control: the 44px predicate can still go red.
test('negative control: the probe reports a 20px button and a button inside a live region', async ({ page }) => {
  await open(page, 'desktop', 'light');
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    const button = document.createElement('button');
    button.textContent = 'x';
    button.style.cssText = 'width:20px;height:20px';
    status.appendChild(button);
    main.appendChild(status);
  });
  const result = await page.evaluate(probe);
  expect(result.small.length).toBeGreaterThan(0);
  expect(result.liveWithButtons.length).toBe(1);
});
