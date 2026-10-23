/**
 * Draft settings on Play-select (spec #2433, 3/8). jsdom has no layout engine, so this mirrors
 * league-wave3-waivers.spec.ts: `page.route` API stubs (fixtures/wave5DraftSettingsFixtures.ts), headless
 * Chromium, DOM probes, as the commissioner.
 *
 * Every case runs at 1440 and 390, in both themes, on the Draft type tab and on the Draft order tab:
 *  - zero cursors and zero filled actions;
 *  - no sideways scroll on the document;
 *  - every button, tab, radio and field at least 44px.
 * Plus keyboard reordering of one team on the Draft order tab.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DRAFT_SETTINGS_URL, TEAM_NAMES, setupDraftSettings } from './fixtures/wave5DraftSettingsFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const MIN_TARGET = 44;

async function open(page: Page, viewport: ViewportName, theme: Theme) {
  await setupDraftSettings(page, theme);
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(DRAFT_SETTINGS_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Draft Settings' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// Scoped to the page root so the app shell's own controls are not counted. A filled action is the button the
// shared PsButton marks `data-variant="fill"`.
function probe() {
  const root = document.querySelector('.ps-root') as HTMLElement;
  const visible = (el: Element) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const controls = Array.from(root.querySelectorAll('button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), select, textarea'))
    .filter((el) => visible(el) && el.getAttribute('aria-hidden') !== 'true') as HTMLElement[];
  const small = controls
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) };
    })
    // Checkbox and radio inputs are covered by their 44px label row; the 44px rule is on the control a thumb hits.
    .filter((t) => Math.min(t.w, t.h) < 43.5);
  return {
    cursors: Array.from(document.querySelectorAll('.cursor')).filter(visible).length,
    filled: Array.from(document.querySelectorAll('[data-variant="fill"]')).filter(visible).length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    small,
    controls: controls.length,
  };
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    for (const tab of ['Draft type', 'Draft order']) {
      test(`Draft settings ${tab} ${viewport} ${theme}: no cursor, no filled action, no sideways scroll, 44px controls`, async ({ page }) => {
        await open(page, viewport, theme);
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');

        const result = await page.evaluate(probe);
        expect(result.controls, 'the page exposes controls').toBeGreaterThan(3);
        expect(result.cursors).toBe(0);
        expect(result.filled).toBe(0);
        expect(result.scrollWidth, `document scrollWidth ${result.scrollWidth} vs innerWidth ${result.innerWidth}`).toBeLessThanOrEqual(result.innerWidth);
        expect(result.small, `controls under ${MIN_TARGET}px: ${JSON.stringify(result.small)}`).toEqual([]);
      });
    }

    test(`Draft settings ${viewport} ${theme}: an edit shows Unsaved changes and the keyboard reorders a team`, async ({ page }) => {
      await open(page, viewport, theme);
      await page.getByRole('tab', { name: 'Draft order' }).click();
      const firstList = page.getByRole('list').first();
      const names = () => firstList.getByRole('listitem').allInnerTexts();
      expect((await names()).map((t) => t.replace(/^\d+\.\s*/, '').trim().split('\n')[0])).toEqual(TEAM_NAMES);

      await expect(page.getByText('Unsaved changes')).toHaveCount(0);
      const down = page.getByRole('button', { name: `Move ${TEAM_NAMES[0]} down` });
      await down.focus();
      await page.keyboard.press('Enter');

      const after = (await names()).map((t) => t.replace(/^\d+\.\s*/, '').trim().split('\n')[0]);
      expect(after.slice(0, 2)).toEqual([TEAM_NAMES[1], TEAM_NAMES[0]]);
      await expect(page.getByText('Unsaved changes')).toBeVisible();
    });
  }
}

// Permanent negative control: the 44px predicate can still go red.
test('negative control: the probe reports a 20px button and a filled action', async ({ page }) => {
  await open(page, 'desktop', 'light');
  await page.evaluate(() => {
    const root = document.querySelector('.ps-root') as HTMLElement;
    const button = document.createElement('button');
    button.textContent = 'x';
    button.setAttribute('data-variant', 'fill');
    button.style.cssText = 'width:20px;height:20px';
    root.appendChild(button);
  });
  const result = await page.evaluate(probe);
  expect(result.small.length).toBeGreaterThan(0);
  expect(result.filled).toBe(1);
});
