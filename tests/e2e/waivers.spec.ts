/**
 * Layout guard for the Waivers page (#1613, ADR 0049), measured in Chromium at
 * 320, 390, 768 and 1280: no document overflow, every control at least 44px,
 * cards below `sm`, tabs below `md` and the side panel from `md`. jsdom has no
 * layout engine, so this follows the players-list spec rig (`page.route` API
 * stubs, `scrollWidth`/`clientWidth` and tap-target probes). It runs in the
 * `browser-security` job, which collects every spec under tests/e2e.
 */
import { expect, test } from '@playwright/test';
import { setupWaiversLayoutGuard, WAIVERS_URL, CLAIMED_PLAYER_NAME } from './fixtures/waiversFixtures';

const WIDTHS = [320, 390, 768, 1280];
const HEIGHT = 900;
// MUI breakpoints: sm 600, md 900.
const SM = 600;
const MD = 900;

const MIN_TARGET = 44;

function probeDocument() {
  const el = document.documentElement;
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}

/** Every visible tappable control's box, smallest first, scoped to `main`. */
function probeTapTargets() {
  const root = document.querySelector('main');
  if (!root) return [] as Array<{ name: string; width: number; height: number }>;
  const controls = Array.from(
    root.querySelectorAll('button, a[href], [role="button"], [role="combobox"], [role="radio"], input, select, textarea')
  ) as HTMLElement[];
  return controls
    .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)
    .filter((el) => (el as HTMLInputElement).type !== 'hidden' && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex >= 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.tagName.toLowerCase();
      return { name, width: Math.round(r.width), height: Math.round(r.height) };
    })
    .sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
}

for (const width of WIDTHS) {
  test(`the Waivers page at ${width}px: no overflow, controls at least 44px, the right layout`, async ({ page }) => {
    await setupWaiversLayoutGuard(page);
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto(WAIVERS_URL);

    await expect(page.getByRole('heading', { name: 'Waivers' })).toBeVisible();
    await expect(page.getByText(CLAIMED_PLAYER_NAME).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const doc = await page.evaluate(probeDocument);
    // eslint-disable-next-line no-console
    console.log(`WAIVERS_WIDTH ${JSON.stringify({ width, ...doc })}`);
    expect(doc.scrollWidth, `document @ ${width}: scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);

    // Cards below sm, the table from sm.
    if (width < SM) {
      await expect(page.getByTestId('player-row-card').first()).toBeVisible();
      await expect(page.getByTestId('player-row')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('player-row').first()).toBeVisible();
      await expect(page.getByTestId('player-row-card')).toHaveCount(0);
    }

    // Tabs below md, the side panel from md.
    const tabs = page.getByRole('radiogroup', { name: 'Waivers view' });
    const side = page.getByRole('complementary', { name: 'Waivers side panel' });
    if (width < MD) {
      await expect(tabs).toBeVisible();
      await expect(side).toBeHidden();
      await tabs.getByRole('radio', { name: 'My claims' }).click();
      await expect(side).toBeVisible();
      await expect(page.getByTestId('bye-cluster-grid')).toBeVisible();
      await tabs.getByRole('radio', { name: 'On waivers' }).click();
      await expect(side).toBeHidden();
    } else {
      await expect(tabs).toBeHidden();
      await expect(side).toBeVisible();
      await expect(page.getByTestId('bye-cluster-grid')).toBeVisible();
    }

    const targets = await page.evaluate(probeTapTargets);
    expect(targets.length, 'the page must expose tappable controls').toBeGreaterThan(0);
    const small = targets.filter((t) => Math.min(t.width, t.height) < MIN_TARGET - 1);
    expect(small, `controls under ${MIN_TARGET}px @ ${width}: ${JSON.stringify(small)}`).toEqual([]);
  });
}

// #1614: the My claims tab (Claim order and Results) at the two phone widths.
for (const width of [320, 390]) {
  test(`My claims at ${width}px: no overflow, controls at least 44px`, async ({ page }) => {
    await setupWaiversLayoutGuard(page);
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto(`${WAIVERS_URL}?tab=claims`);

    const side = page.getByRole('complementary', { name: 'Waivers side panel' });
    await expect(side).toBeVisible();
    await expect(page.getByRole('button', { name: `Move ${CLAIMED_PLAYER_NAME} down` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Week 2' })).toBeVisible();
    await expect(page.getByText(/Lost to The Extraordinarily Long Team Name FC · won at \$17/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const doc = await page.evaluate(probeDocument);
    expect(doc.scrollWidth, `document @ ${width}: scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);

    // The full result line fits: a clipped or ellipsized line has scrollWidth > clientWidth.
    const lines = await page.getByTestId('claim-result-line').evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent || '', scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: Math.round(el.getBoundingClientRect().right) }))
    );
    expect(lines.some((l) => l.text.includes('Lost to The Extraordinarily Long Team Name FC · won at $17 · your bid $5'))).toBe(true);
    for (const l of lines) {
      expect(l.scrollWidth, `result line clipped @ ${width}: ${l.text}`).toBeLessThanOrEqual(l.clientWidth + 1);
      expect(l.right, `result line off-screen @ ${width}: ${l.text}`).toBeLessThanOrEqual(width);
    }

    const targets = await page.evaluate(probeTapTargets);
    expect(targets.some((t) => t.name.startsWith('Move '))).toBe(true);
    const small = targets.filter((t) => Math.min(t.width, t.height) < MIN_TARGET - 1);
    expect(small, `controls under ${MIN_TARGET}px @ ${width}: ${JSON.stringify(small)}`).toEqual([]);
  });
}

// Permanent negative control (the players-list spec's own pattern): proves
// the width predicate can still go red.
test('negative control: the width predicate reports a forced overflow', async ({ page }) => {
  await setupWaiversLayoutGuard(page);
  await page.setViewportSize({ width: 390, height: HEIGHT });
  await page.goto(WAIVERS_URL);
  await expect(page.getByRole('heading', { name: 'Waivers' })).toBeVisible();

  const before = await page.evaluate(probeDocument);
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-testid', 'forced-overflow');
    spacer.style.width = '2000px';
    spacer.style.height = '1px';
    document.body.appendChild(spacer);
  });
  const during = await page.evaluate(probeDocument);
  expect(during.scrollWidth).toBeGreaterThan(during.clientWidth + 1);
});
