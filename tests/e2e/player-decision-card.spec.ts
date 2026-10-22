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
import { json } from './fixtures/jsonRoute';
import { MATCHUP_URL, setupLayoutGuard } from './fixtures/layoutGuardFixtures';
import {
  setupDecisionCardLayoutGuard,
  PLAYER_NAME,
  LONG_NAME_PLAYER_NAME,
  THIRD_PLAYER_NAME,
  WAIVERS_URL,
} from './fixtures/decisionCardFixtures';

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

/**
 * Every tappable control inside `selector`'s box size, smallest first.
 * Risk-review finding: the original selector (`button, a[href],
 * [role="button"]`) missed MUI's `Select` (a `div[role="combobox"]`, not a
 * `<button>`) and plain `<input>`/`<textarea>` fields entirely, so the FAAB
 * bid field and both drop-pick selects went unmeasured.
 */
function probeTapTargets(selector: string) {
  const root = document.querySelector(selector);
  if (!root) return { found: false, boxes: [] as Array<{ name: string; width: number; height: number }> };
  const controls = Array.from(
    root.querySelectorAll('button, a[href], [role="button"], [role="combobox"], input, select, textarea')
  ) as HTMLElement[];
  const seen = new Set<Element>();
  const boxes = controls
    .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)
    .map((el) => {
      // A plain `<input>`/`<textarea>` (a MUI TextField's own field element)
      // renders with no vertical padding of its own - the padding that makes
      // the whole box clickable lives on its `.MuiInputBase-root` wrapper, so
      // the INPUT's bare box understates its true tap target. Measure that
      // wrapper once (never the input a second time under its own name).
      const target = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.closest('.MuiInputBase-root')
        ? (el.closest('.MuiInputBase-root') as HTMLElement)
        : el;
      return target;
    })
    .filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    })
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

  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
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

// The bars strip is a scroll container (`overflow-x: auto`), so inside the
// sheet's column flexbox (MUI's Drawer paper) its automatic minimum height
// is 0: once the card's content exceeds the sheet's 88vh the strip was
// squeezed to nothing and its columns hung upward out of the box, leaving a
// bare row of week numbers under the Season pick (reported from an iPhone,
// 2026-09-15). jsdom cannot see a flex item shrink, so the guard is here.
test('the weekly bars keep their full height inside the sheet', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);

  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
  const strip = page.getByTestId('weekly-points-bars');
  await expect(strip).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const geometry = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="weekly-points-bars"]') as HTMLElement;
    const fill = document.querySelector('[data-testid="weekly-bar-1-fill"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    const f = fill.getBoundingClientRect();
    return { stripHeight: Math.round(r.height), stripTop: Math.round(r.top), fillTop: Math.round(f.top), fillHeight: Math.round(f.height), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  // eslint-disable-next-line no-console
  console.log(`DECISION_CARD_BARS ${JSON.stringify(geometry)}`);
  // The tallest fill is 40px plus the 9px label and 12px padding each side:
  // a strip shorter than its own content has been shrunk by the flexbox.
  expect(
    geometry.fillTop,
    `week 1 fill top ${geometry.fillTop} sits above the strip top ${geometry.stripTop} (strip ${geometry.stripHeight}px tall)`
  ).toBeGreaterThanOrEqual(geometry.stripTop);
  expect(geometry.clientHeight, `strip clientHeight ${geometry.clientHeight} < scrollHeight ${geometry.scrollHeight}`)
    .toBeGreaterThanOrEqual(geometry.scrollHeight);
});

// Formal review round 2, f10: `isTypingTarget`'s scroll-region guard (risk
// round 2's own fix) must not ALSO swallow the arrow keys once focus lands
// on a truncated (not scrollable) title - jsdom reports 0 for scrollWidth/
// clientWidth on every element, so only a real browser can prove a genuinely
// truncated name still leaves ArrowLeft/ArrowRight working.
test('arrow keys still navigate after Prev/Next focuses a genuinely truncated title', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);

  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
  await expect(page.getByTestId('decision-card')).toBeVisible();

  await page.getByTestId('decision-card-next').click();
  const title = page.getByRole('heading', { name: LONG_NAME_PLAYER_NAME });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();

  // Confirm the premise: this name really is truncated in the sheet's title
  // column, not merely long in the DOM.
  const truncated = await title.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(truncated, 'the long name must actually overflow its title column for this test to mean anything').toBe(true);

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: THIRD_PLAYER_NAME })).toBeVisible();
});

// Permanent negative control (matching game-center-matchup-layout.spec.ts's
// own pattern): proves the width predicate can still go red, so a
// quietly-broken assertion doesn't read as a clean pass forever.
test('negative control: the width predicate reports a forced sheet overflow', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);
  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
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

// Spec #2347 ruling 7 (wave 3): the playselect look's one-filled-action rule. The phone sheet is modal, so it
// may carry exactly one filled button (the Claim); the desktop drawer carries none. The default look's
// contained Claim counts as a filled button too, so the waivers sheet half holds under either look. The
// playselect drawer is asserted on Matchup below, which passes the look on this branch.
const FILLED = '[data-variant="fill"], .MuiButton-contained';

test('the sheet carries at most one filled button', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);
  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-variant', 'sheet');
  await expect(page.getByTestId('claim-player-action')).toBeVisible();
  expect(await card.locator(FILLED).count()).toBeLessThanOrEqual(1);
});

test('the desktop drawer at 1440: no horizontal scroll and 44px controls', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(WAIVERS_URL);
  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-variant', 'drawer');
  await expect(page.getByTestId('weekly-points-bars')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const width = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  expect(
    width.scrollWidth,
    `decision-card @ 1440: scrollWidth=${width.scrollWidth} clientWidth=${width.clientWidth}${width.worst ? ` worst overhang: ${JSON.stringify(width.worst)}` : ''}`
  ).toBeLessThanOrEqual(width.clientWidth + 1);
  const tapTargets = await page.evaluate(probeTapTargets, '[data-testid="decision-card"]');
  for (const box of tapTargets.boxes) {
    expect(box.height, `"${box.name}" is ${box.width}x${box.height}, under the 44px minimum`).toBeGreaterThanOrEqual(44);
  }
});

// Matchup passes look="playselect" (spec #2347 ruling 7), so this is the playselect card in a real browser: the
// drawer carries no filled button at 1440 and the sheet none at 390 (a rostered open has no Claim), the paper is
// the playselect frame, and a body line is Archivo, not the theme font Typography would otherwise take.
for (const [name, size] of [['drawer at 1440', { width: 1440, height: 900 }], ['sheet at 390', { width: WIDTH, height: HEIGHT }]] as const) {
  test(`Matchup's playselect card, ${name}: no filled button, Archivo body lines, no sideways scroll`, async ({ page }) => {
    await setupLayoutGuard(page, { view: 'standard' });
    // Registered after the harness, so it wins: a small card read for whichever player the bench row opens.
    await page.route('**/api/players/*/card*', (route) => json(route, 200, {
      line: null,
      weather: null,
      usage: null,
      watching: false,
      decision: { projWeek: { week: 7, points: 12.1 }, ros: { points: 150.2, throughWeek: 18 } },
      seasons: [],
      news: [{ headline: 'Logged a full practice on Friday.', publishedAt: null }],
    }));
    await page.setViewportSize(size);
    await page.goto(MATCHUP_URL);
    // An away starter is the other side's player: a rostered open, which prints "Rostered by {team}".
    await page.getByRole('button', { name: 'Josh Allen', exact: true }).click();
    const card = page.getByTestId('decision-card');
    await expect(card).toHaveAttribute('data-variant', size.width < 600 ? 'sheet' : 'drawer');
    await expect(card).toHaveClass(/ps-root/);
    await expect(card.getByTestId('decision-strip')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));

    expect(await card.locator(FILLED).count(), 'no filled button in the Matchup card').toBe(0);
    const fonts = await card.evaluate((el) => {
      const lines = Array.from(el.querySelectorAll('p, [data-testid="decision-strip"] *'))
        .filter((n) => (n.textContent || '').trim() && n.children.length === 0)
        .map((n) => getComputedStyle(n).fontFamily);
      return { count: lines.length, other: lines.filter((f) => !/Archivo/.test(f) && !/Press Start/.test(f)) };
    });
    expect(fonts.count, 'the card has body lines to measure').toBeGreaterThan(0);
    expect(fonts.other, 'every body line is Archivo or the pixel face').toEqual([]);
    const width = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
    expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1);
  });
}

// #2489: the sheet's tabs. Header, actions and tabs stay in view and only the tab panel scrolls, so even after
// the panel is scrolled to its end the close control is still on screen and the sheet still has no sideways scroll.
test('the sheet at 390px: Game log shows its section, the panel scrolls alone and close stays in view', async ({ page }) => {
  await setupDecisionCardLayoutGuard(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(WAIVERS_URL);
  await page.getByRole('button', { name: new RegExp(`^${PLAYER_NAME}`) }).click();
  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-variant', 'sheet');
  await expect(page.getByTestId('weekly-points-bars')).toBeVisible();

  await page.getByRole('tab', { name: 'Game log' }).click();
  await expect(page.getByTestId('decision-card-gamelog-section')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const width = await page.evaluate(probeWidth, '[data-testid="decision-card"]');
  expect(width.scrollWidth, `sheet scrollWidth=${width.scrollWidth} clientWidth=${width.clientWidth}`).toBeLessThanOrEqual(width.clientWidth + 1);

  // Inactive panels are not rendered at all (an author `display: flex` must not beat `[hidden]`).
  await expect(page.locator('#decision-card-tabpanel-stats')).toBeHidden();

  const scrolled = await page.evaluate(() => {
    const scroller = document.querySelector('[role="tabpanel"]:not([hidden])')?.parentElement as HTMLElement | null | undefined;
    if (!scroller) return null;
    scroller.scrollTop = scroller.scrollHeight;
    const sheet = document.querySelector('[data-testid="decision-card"]') as HTMLElement;
    return { overflowY: getComputedStyle(scroller).overflowY, sheetScrollTop: sheet.scrollTop };
  });
  expect(scrolled, 'the active tab panel sits in a scroller').not.toBeNull();
  expect(scrolled?.overflowY).toBe('auto');
  // Only the panel scrolls: the sheet itself stays put, so header, actions and tabs stay in view.
  expect(scrolled?.sheetScrollTop).toBe(0);
  await expect(page.getByTestId('decision-card-close')).toBeInViewport();
});
