/**
 * Layout guard for the Players list's stacked row at 390px (#1310, ADR 0040's
 * acceptance criterion 3: "The 390 px stacked row measured in Chromium: no
 * horizontal scroll, Claim 44 px"). jsdom has no layout engine, so this
 * mirrors tests/e2e/player-decision-card.spec.ts's own rig: `page.route` API
 * stubs, headless Chromium, `scrollWidth`/`clientWidth` and tap-target
 * probes. It runs in the `browser-security` job (`npm run test:e2e`), which
 * collects every spec under tests/e2e with no file argument, so this file
 * needs no workflow edit.
 */
import { expect, test } from '@playwright/test';
import { setupPlayersListLayoutGuard, PLAYERS_URL, CLAIM_PLAYER_NAME } from './fixtures/playersListFixtures';

const WIDTH = 390;
const HEIGHT = 844;

/** scrollWidth/clientWidth for one element, plus the worst-overhanging descendant. */
function probeWidth(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return { found: false, scrollWidth: 0, clientWidth: 0, worst: null };
  const scrollWidth = el.scrollWidth;
  const clientWidth = el.clientWidth;
  const originLeft = el.getBoundingClientRect().left + (el as HTMLElement).clientLeft;
  let worst: { overhang: number; tag: string; testid: string | null; name: string | null } | null = null;
  el.querySelectorAll('*').forEach((child) => {
    const cr = child.getBoundingClientRect();
    if (cr.width === 0 && cr.height === 0) return;
    const overhang = Math.round((cr.right - originLeft) - clientWidth);
    if (overhang > 0 && (!worst || overhang > worst.overhang)) {
      worst = {
        overhang,
        tag: child.tagName.toLowerCase(),
        testid: child.getAttribute('data-testid'),
        name: child.getAttribute('aria-label') || (child.textContent || '').trim().slice(0, 40) || null,
      };
    }
  });
  return { found: true, scrollWidth, clientWidth, worst };
}

/** Every tappable control's box size inside `selector`, smallest first (same
 * selector set player-decision-card.spec.ts uses: MUI's `Select` is a
 * `div[role="combobox"]`, not a `<button>`). */
function probeTapTargets(selector: string) {
  const root = document.querySelector(selector);
  if (!root) return { found: false, boxes: [] as Array<{ name: string; width: number; height: number }> };
  const controls = Array.from(
    root.querySelectorAll('button, a[href], [role="button"], [role="combobox"], input, select, textarea')
  ) as HTMLElement[];
  const boxes = controls
    .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.tagName.toLowerCase();
      return { name, width: Math.round(r.width), height: Math.round(r.height) };
    });
  boxes.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  return { found: true, boxes };
}

test('the Players list stacked row at 390px: no horizontal scroll, Claim at least 44px', async ({ page }) => {
  await setupPlayersListLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(PLAYERS_URL);

  const claimRow = page.getByTestId('player-row-card').filter({ hasText: CLAIM_PLAYER_NAME });
  await expect(claimRow).toBeVisible();
  const claimButton = claimRow.getByRole('button', { name: 'Claim' });
  await expect(claimButton).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const docWidth = await page.evaluate(probeWidth, ':root');
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LIST_WIDTH ${JSON.stringify({ width: WIDTH, target: 'document', scrollWidth: docWidth.scrollWidth, clientWidth: docWidth.clientWidth })}`);
  expect(
    docWidth.scrollWidth,
    `document @ ${WIDTH}: scrollWidth=${docWidth.scrollWidth} clientWidth=${docWidth.clientWidth}${docWidth.worst ? ` worst overhang: ${JSON.stringify(docWidth.worst)}` : ''}`
  ).toBeLessThanOrEqual(docWidth.clientWidth + 1);

  const claimBox = await claimButton.boundingBox();
  expect(claimBox, 'Claim button must have a measurable box').not.toBeNull();
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LIST_TAP_TARGET ${JSON.stringify({ name: 'Claim', width: claimBox?.width, height: claimBox?.height })}`);
  expect(claimBox!.width, `Claim is ${claimBox!.width}x${claimBox!.height}, under the 44px minimum`).toBeGreaterThanOrEqual(44);
  expect(claimBox!.height, `Claim is ${claimBox!.width}x${claimBox!.height}, under the 44px minimum`).toBeGreaterThanOrEqual(44);

  const tapTargets = await page.evaluate(probeTapTargets, '[data-testid="player-row-card"]');
  expect(tapTargets.found, 'at least one player-row-card must exist').toBe(true);
  expect(tapTargets.boxes.length, 'the stacked rows must expose at least one tappable control').toBeGreaterThan(0);
  const smallest = tapTargets.boxes[0];
  // eslint-disable-next-line no-console
  console.log(`PLAYERS_LIST_SMALLEST_TAP_TARGET ${JSON.stringify(smallest)}`);
});

// Permanent negative control (matching player-decision-card.spec.ts's and
// game-center-matchup-layout.spec.ts's own pattern): proves the width
// predicate can still go red, so a quietly-broken assertion doesn't read as
// a clean pass forever.
test('negative control: the width predicate reports a forced overflow', async ({ page }) => {
  await setupPlayersListLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(PLAYERS_URL);
  await expect(page.getByTestId('player-row-card').first()).toBeVisible();

  const before = await page.evaluate(probeWidth, ':root');
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-testid', 'forced-overflow');
    spacer.style.width = '2000px';
    spacer.style.height = '1px';
    document.body.appendChild(spacer);
  });
  const during = await page.evaluate(probeWidth, ':root');
  expect(during.scrollWidth).toBeGreaterThan(during.clientWidth + 1);

  await page.evaluate(() => document.querySelector('[data-testid="forced-overflow"]')?.remove());
  const after = await page.evaluate(probeWidth, ':root');
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth + 1);
});
