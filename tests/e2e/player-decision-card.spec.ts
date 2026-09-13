/**
 * Layout guard for the Decision card's sheet at 390px (#1307, ADR 0040's
 * premise-check ruling item 5): jsdom has no layout engine, so the
 * "no horizontal scroll, tap targets 44 px" acceptance criterion is measured
 * in headless Chromium instead, over WaiverWire's own claim flow (the
 * `waivers` context, opened through `page.route` API stubs the way
 * `tests/e2e/draft-*.spec.ts` and `game-center-matchup-layout.spec.ts`
 * already do this repo's browser-measurement rig). It runs in the
 * `browser-security` job (`npm run test:e2e`), which collects every spec
 * under tests/e2e with no file argument, so this file needs no workflow
 * edit.
 *
 * It measures the SHEET the card renders as below the `sm` breakpoint
 * (`data-variant="sheet"`), fed a card payload rich enough to exercise every
 * section this ticket adds (all 18 weekly bars, the decision strip, a game
 * log row, one news item and the waivers action bar with a FAAB bid field),
 * so a real overflow or an under-sized control has somewhere to hide.
 */
import { expect, test } from '@playwright/test';
import { setupDecisionCardLayoutGuard, PLAYER_NAME, WAIVERS_URL } from './fixtures/decisionCardFixtures';

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

/** Every button/link/[role=button] inside `selector`'s box size, smallest first. */
function probeTapTargets(selector: string) {
  const root = document.querySelector(selector);
  if (!root) return { found: false, boxes: [] as Array<{ name: string; width: number; height: number }> };
  const controls = Array.from(root.querySelectorAll('button, a[href], [role="button"]')) as HTMLElement[];
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

test('the Decision card sheet at 390px: no horizontal scroll, tap targets at least 44px', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);

  await page.getByRole('button', { name: PLAYER_NAME }).click();
  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-variant', 'sheet');
  // Content that only arrives once the card route resolves - waiting on it
  // means the geometry below is measured after the real layout has settled,
  // not the fetch-in-flight skeleton.
  await expect(page.getByTestId('weekly-points-bars')).toBeVisible();
  await expect(page.getByTestId('claim-player-action')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const cardWidth = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  // eslint-disable-next-line no-console
  console.log(`DECISION_CARD_WIDTH ${JSON.stringify({ width: WIDTH, target: 'decision-card', scrollWidth: cardWidth.scrollWidth, clientWidth: cardWidth.clientWidth })}`);
  expect(cardWidth.found, '[data-testid="decision-card"] must exist').toBe(true);
  expect(
    cardWidth.scrollWidth,
    `decision-card @ ${WIDTH}: scrollWidth=${cardWidth.scrollWidth} clientWidth=${cardWidth.clientWidth}${cardWidth.worst ? ` worst overhang: ${JSON.stringify(cardWidth.worst)}` : ''}`
  ).toBeLessThanOrEqual(cardWidth.clientWidth + 1);

  const docWidth = await page.evaluate(probeWidth, ':root');
  // eslint-disable-next-line no-console
  console.log(`DECISION_CARD_WIDTH ${JSON.stringify({ width: WIDTH, target: 'document', scrollWidth: docWidth.scrollWidth, clientWidth: docWidth.clientWidth })}`);
  expect(
    docWidth.scrollWidth,
    `document @ ${WIDTH}: scrollWidth=${docWidth.scrollWidth} clientWidth=${docWidth.clientWidth}`
  ).toBeLessThanOrEqual(docWidth.clientWidth + 1);

  const tapTargets = await page.evaluate(probeTapTargets, '[data-testid="decision-card"]');
  expect(tapTargets.found, '[data-testid="decision-card"] must exist').toBe(true);
  expect(tapTargets.boxes.length, 'the card must expose at least one tappable control').toBeGreaterThan(0);
  const smallest = tapTargets.boxes[0];
  // eslint-disable-next-line no-console
  console.log(`DECISION_CARD_TAP_TARGET ${JSON.stringify(smallest)}`);
  for (const box of tapTargets.boxes) {
    expect(box.width, `"${box.name}" is ${box.width}x${box.height}, under the 44px minimum`).toBeGreaterThanOrEqual(44);
    expect(box.height, `"${box.name}" is ${box.width}x${box.height}, under the 44px minimum`).toBeGreaterThanOrEqual(44);
  }
});

// Permanent negative control (matching game-center-matchup-layout.spec.ts's
// own pattern): proves the width predicate can still go red, so a
// quietly-broken assertion doesn't read as a clean pass forever.
test('negative control: the width predicate reports a forced sheet overflow', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);
  await page.getByRole('button', { name: PLAYER_NAME }).click();
  await expect(page.getByTestId('decision-card')).toBeVisible();

  const before = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-testid', 'forced-overflow');
    spacer.style.width = '2000px';
    spacer.style.height = '1px';
    document.querySelector('[data-testid="decision-card"]')?.appendChild(spacer);
  });
  const during = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  expect(during.scrollWidth).toBeGreaterThan(during.clientWidth + 1);
  expect(during.worst).not.toBeNull();

  await page.evaluate(() => document.querySelector('[data-testid="forced-overflow"]')?.remove());
  const after = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth + 1);
});
