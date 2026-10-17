/**
 * The Trade Center on Play-select (ADR 0067 wave 3, spec #2347 ACs 8 and 11). jsdom has no layout engine, so
 * this mirrors league-wave2-matchup.spec.ts: `page.route` API stubs layered on the layout-guard harness
 * (fixtures/wave3TradesFixtures.ts, the first trades e2e), headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes, on the Pending tab with an incoming offer and an accepted
 * league trade, and asserts:
 *  - at most one cursor, and at most one filled action outside a modal (here: none);
 *  - no sideways scroll on the document;
 *  - every button and link of the page, and of the dialog when it is open, is at least 44px;
 *  - no live region (role="status" or role="alert") holds a button.
 * The dialog cases add: the one filled button is inside the modal, and a refused Send Offer says why inside
 * the dialog, which stays open.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), the card's behaviour (TradeCenter.test.jsx).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupTradesFixture, TRADES_URL } from './fixtures/wave3TradesFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'league-wave3-trades-shots');

async function open(page: Page, viewport: ViewportName, theme: Theme, opts: { incoming?: boolean; proposeRefusal?: string } = {}) {
  await setupTradesFixture(page, { theme, ...opts });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(TRADES_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Trade Center' })).toBeVisible();
  await expect(page.getByTestId('trade-11')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// What a Play-select page must hold, measured in the browser. `scope` is the page root; a modal lives
// outside it, so a filled button there is not counted against the page.
async function probe(page: Page) {
  return page.evaluate(() => {
    const swatch = document.createElement('i');
    swatch.style.backgroundColor = 'var(--ps-accent)';
    document.body.appendChild(swatch);
    const accent = getComputedStyle(swatch).backgroundColor;
    swatch.remove();

    const root = document.querySelector('[data-testid="trade-center"]') as HTMLElement;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    const isFilled = (el: Element) => getComputedStyle(el).backgroundColor === accent;
    const controls = (scope: ParentNode) => Array.from(scope.querySelectorAll('button, a[href]'))
      .filter((el) => (el as HTMLElement).getBoundingClientRect().width > 0);
    const small = (scope: ParentNode) => controls(scope)
      .map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim(), box: (el as HTMLElement).getBoundingClientRect() }))
      .filter(({ box }) => Math.round(box.height) < 44 || Math.round(box.width) < 44)
      .map(({ text, box }) => `${text} ${Math.round(box.width)}x${Math.round(box.height)}`);
    const regions = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'));
    return {
      cursors: root.querySelectorAll('.cursor').length,
      filledOnPage: controls(root).filter(isFilled).length,
      filledInDialog: dialog ? controls(dialog).filter(isFilled).length : 0,
      smallOnPage: small(root),
      smallInDialog: dialog ? small(dialog) : [],
      liveRegionButtons: regions.filter((r) => r.querySelector('button, a')).length,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

async function shoot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true, animations: 'disabled' });
}

function expectPlaySelect(p: Awaited<ReturnType<typeof probe>>, { cursors }: { cursors: number }) {
  expect(p.cursors, 'the oldest incoming pending offer is the one cursor').toBe(cursors);
  expect(p.filledOnPage, 'no filled action outside a modal').toBe(0);
  expect(p.smallOnPage, 'every button and link of the page is at least 44px').toEqual([]);
  expect(p.liveRegionButtons, 'no live region holds a button').toBe(0);
  expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
  expect(p.bodyScrollWidth, `body scrollWidth ${p.bodyScrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    const tag = `${viewport} ${theme}`;

    test(`Trade Center Pending ${tag}: one cursor on the incoming offer, no filled action, no sideways scroll`, async ({ page }) => {
      await open(page, viewport, theme);
      const p = await probe(page);
      // eslint-disable-next-line no-console
      console.log(`LEAGUE_WAVE3_TRADES pending-${viewport}-${theme} ${JSON.stringify(p)}`);
      await shoot(page, `pending-${viewport}-${theme}`);

      expectPlaySelect(p, { cursors: 1 });
      // The cursor is on the incoming offer, and the accepted league trade carries the Commissioner row.
      await expect(page.locator('.cursor').getByTestId('trade-12')).toHaveCount(1);
      await expect(page.getByTestId('trade-11').getByRole('group', { name: 'Commissioner' })).toBeVisible();
      await expect(page.getByTestId('trade-11').getByText(/^League review ends /)).toBeVisible();
      // The commissioner's own trades (incoming, outgoing) carry no override.
      await expect(page.getByTestId('trade-12').getByRole('button', { name: 'Force Approve' })).toHaveCount(0);
      await expect(page.getByTestId('trade-9').getByRole('button', { name: 'Force Approve' })).toHaveCount(0);
    });

    test(`Trade Center Pending ${tag}: with no incoming offer there is no cursor`, async ({ page }) => {
      await open(page, viewport, theme, { incoming: false });
      expectPlaySelect(await probe(page), { cursors: 0 });
    });

    test(`Trade Center ${tag}: the card's analysis runs by trade and keeps the page clean`, async ({ page }) => {
      await open(page, viewport, theme);
      const request = page.waitForRequest((r) => r.url().endsWith('/api/trades/analyze') && r.method() === 'POST');
      await page.getByTestId('trade-12').getByRole('button', { name: 'Analyze Trade' }).click();
      const body = (await request).postDataJSON();
      expect(body, 'the card sends the trade id, not the viewer as proposer').toMatchObject({ tradeId: 12 });

      const card = page.getByTestId('trade-12');
      await expect(card.getByText('Favors Proposer')).toBeVisible();
      await expect(card.getByText(/Proposer: gives 127\.5 · gets 223\.3/)).toBeVisible();
      await shoot(page, `analysis-${viewport}-${theme}`);
      expectPlaySelect(await probe(page), { cursors: 1 });
    });

    test(`Trade Center ${tag}: the propose dialog holds the one filled button, and a refusal stays inside it`, async ({ page }) => {
      await open(page, viewport, theme, { proposeRefusal: 'transactions are locked by the commissioner' });
      await page.getByRole('button', { name: 'Propose Trade' }).click();
      const dialog = page.getByRole('dialog', { name: 'Propose Trade' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Trade with')).toBeFocused();

      await dialog.getByLabel('Trade with').selectOption({ label: 'Sasquatch of the Cascade Range' });
      // The native checkbox is visually hidden behind its 44px row; a click on the row is what a user makes.
      await dialog.getByLabel(/^Tyjae Spears \(RB\)/).check({ force: true });
      await dialog.getByLabel(/^Garrett Wilson \(WR\)/).check({ force: true });
      await expect(dialog.getByRole('button', { name: 'Send Offer' })).toBeEnabled();
      await expect(dialog.getByText('Favors Proposer')).toBeVisible();

      let p = await probe(page);
      await shoot(page, `dialog-${viewport}-${theme}`);
      expect(p.filledInDialog, 'Send Offer is the dialog\'s one filled button').toBe(1);
      expect(p.filledOnPage, 'the page behind the modal has none').toBe(0);
      expect(p.smallInDialog, 'every dialog button is at least 44px').toEqual([]);
      expect(p.scrollWidth).toBeLessThanOrEqual(p.innerWidth);

      await dialog.getByRole('button', { name: 'Send Offer' }).click();
      const alert = dialog.getByRole('alert');
      await expect(alert).toHaveText(/transactions are locked by the commissioner/);
      await expect(dialog).toBeVisible();
      p = await probe(page);
      expect(p.liveRegionButtons, 'the refusal\'s live region holds no button').toBe(0);
      expect(p.scrollWidth).toBeLessThanOrEqual(p.innerWidth);
      await shoot(page, `dialog-refused-${viewport}-${theme}`);

      // Escape closes it and focus returns to the opener.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: 'Propose Trade' })).toBeFocused();
    });
  }
}
