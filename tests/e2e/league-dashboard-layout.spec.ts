/**
 * Layout guard for the League Dashboard v2 composition (#1110, ADR 0034).
 *
 * jsdom has no layout engine, so the geometry this ticket's canvas measured
 * (equal-height hero cards via `align-items: stretch`, a Draft Grades rail
 * card close in height to the standings table it sits beside, no card ever
 * wider than its column) is measured by hand in headless Chromium and bound
 * here, exactly as tests/e2e/game-center-matchup-layout.spec.ts (#920) binds
 * the same family of invariants for Game Center and Matchup Detail. The jsdom
 * page test (LeagueDashboardPage.test.jsx) binds the CSS RULES (the grid
 * template strings, the `align-items: stretch` declaration); this spec binds
 * the RENDERED RESULT of those rules, which is the right split (ADR: jsdom
 * asserts a rule, Chromium proves what the rule produces on screen).
 *
 * Fixture: `layoutGuardFixtures.ts`'s `setupLayoutGuard` / `fulfilApi`,
 * extended in this ticket with the dashboard's own reads (draft grades, the
 * viewer's lineup, recent activity, the commissioner strip's join-request
 * queue) alongside the nine endpoints Game Center and Matchup Detail already
 * used. The league row is a fantasy, in-season, commissioner league (#1110's
 * own `LEAGUE_ROW` extension), so every widget this ticket composes mounts
 * with real content: the strip, the hero (My Team + matchup), Around the
 * League, the main grid (standings + Draft Grades), and the second row (Quick
 * Actions + Recent activity).
 *
 * It runs in the `browser-security` job (`npm run test:e2e`), which collects
 * every spec under tests/e2e with no file argument, so this file is picked up
 * with no workflow edit. It is Chromium-only (the e2e config declares no
 * projects).
 *
 * What this guard does NOT cover, and its green must NOT be read as covering:
 *   - the League chat drawer's own geometry (composes "as today", #1110's own
 *     "What to build" item 7): it is closed throughout every case here and
 *     measured (Chromium, `getComputedStyle`) to contribute nothing to either
 *     `document.body.scrollWidth` or `document.documentElement.scrollWidth`
 *     while closed, so no exclusion for it was needed once the real 320px
 *     regression below was found and fixed at its actual source.
 *   - recap, trophy case and the pre-draft countdown, none of which this
 *     fixture's league puts on screen (no recap generated, no trophies, past
 *     pre-draft) - each composes "as today" too, and none is this ticket's
 *     own new geometry.
 */
import { expect, test, type Page } from '@playwright/test';
import { setupLayoutGuard, DASHBOARD_URL } from './fixtures/layoutGuardFixtures';

const WIDTHS = [320, 390, 768, 900, 1440];
const HEIGHT = 900;

// The one width the audit's hero/rail-height claims were measured at.
const MEASURED_WIDTH = 1440;

// Every card this ticket composes that the fixture feeds real content, so
// each is a real column-width claim rather than an accident of an absent or
// empty card. `slot-commissioner-strip`/`dashboard-shell` are containers, not
// cards, and are checked separately.
const CARD_TESTIDS = [
  'commissioner-strip',
  'my-team-summary',
  'matchup-preview',
  'around-the-league',
  'standings-table',
  'draft-grades',
  'quick-actions',
  'recent-activity',
];

// ---- Browser-side probes (self-contained: serialised to the page). ----

/**
 * For each card selector: does it exist, does it overflow itself
 * (scrollWidth vs its own clientWidth), and does its bounding box extend past
 * the column's (`dashboard-shell`) right edge or exceed the column's width.
 * `tol` absorbs sub-pixel layout rounding.
 */
function probeCardWidths(args: { cardTestIds: string[]; tol: number }) {
  const { cardTestIds, tol } = args;
  const column = document.querySelector('[data-testid="dashboard-shell"]');
  const result = {
    columnFound: !!column,
    cards: [] as Array<{
      testId: string;
      found: boolean;
      selfOverflow: boolean;
      widerThanColumn: boolean;
      overhangsColumn: boolean;
      cardWidth: number;
      columnWidth: number;
    }>,
  };
  if (!column) return result;
  const columnRect = column.getBoundingClientRect();
  for (const testId of cardTestIds) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) {
      result.cards.push({
        testId, found: false, selfOverflow: false, widerThanColumn: false,
        overhangsColumn: false, cardWidth: 0, columnWidth: columnRect.width,
      });
      continue;
    }
    const rect = el.getBoundingClientRect();
    result.cards.push({
      testId,
      found: true,
      selfOverflow: el.scrollWidth > el.clientWidth + tol,
      widerThanColumn: rect.width > columnRect.width + tol,
      overhangsColumn: rect.right > columnRect.right + tol,
      cardWidth: rect.width,
      columnWidth: columnRect.width,
    });
  }
  return result;
}

/** The document's own scrollWidth vs clientWidth (the #920 invariant). */
function probeDocumentWidth() {
  const el = document.documentElement;
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}

/** Bounding-box heights of the four cards the audit's geometry claims name. */
function probeHeroAndRailHeights() {
  const rectOf = (testId: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    return el ? el.getBoundingClientRect().height : null;
  };
  return {
    myTeam: rectOf('my-team-summary'),
    matchup: rectOf('matchup-preview'),
    standings: rectOf('standings-table'),
    draftGrades: rectOf('draft-grades'),
  };
}

type CardWidthResult = ReturnType<typeof probeCardWidths>;

function cardWidthMessage(width: number, r: CardWidthResult): string {
  const bad = r.cards.filter((c) => !c.found || c.selfOverflow || c.widerThanColumn || c.overhangsColumn);
  if (bad.length === 0) return `@ ${width}: every card fits its column`;
  return `@ ${width}: ` + bad
    .map((c) => (!c.found
      ? `"${c.testId}" not found`
      : `"${c.testId}" width=${c.cardWidth.toFixed(1)} column=${c.columnWidth.toFixed(1)} selfOverflow=${c.selfOverflow} widerThanColumn=${c.widerThanColumn} overhangsColumn=${c.overhangsColumn}`))
    .join('; ');
}

// ---- Setup ----

async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/**
 * Installs the harness, sizes the viewport, opens the dashboard and waits for
 * every widget this ticket composes to have rendered its real content (not
 * just its skeleton): the strip's facts, the hero's two cards, an Around the
 * League tile, a standings row, a Draft Grades row, and a Recent activity
 * row. Waiting on the LAST widget to settle (Recent activity, the rail track
 * of the second grid row - the furthest-down slice this ticket adds) is what
 * makes the width and height probes below measure the fully-loaded page
 * rather than a mid-load layout.
 */
async function gotoDashboard(page: Page, width: number, height: number) {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD_URL);
  await page.getByTestId('commissioner-strip-facts').waitFor();
  await page.getByTestId('my-team-summary').waitFor();
  await page.getByTestId('matchup-preview').waitFor();
  await page.getByTestId('around-the-league-tile').first().waitFor();
  await page.getByTestId('standings-table-count').waitFor();
  await page.getByTestId('draft-grades-net').first().waitFor();
  await page.getByTestId('quick-actions-column-1').waitFor();
  await page.getByTestId('recent-activity-row').first().waitFor();
  await fontsReady(page);
}

// ---- Geometry: no card wider than its column, document never wider than the
// viewport, at every width (#920 invariants) ----

for (const width of WIDTHS) {
  test(`League Dashboard @ ${width}x${HEIGHT}: no card wider than its column, document never wider than the viewport`, async ({ page }) => {
    await gotoDashboard(page, width, HEIGHT);

    const cards = await page.evaluate(probeCardWidths, { cardTestIds: CARD_TESTIDS, tol: 1 });
    expect(cards.columnFound, '[data-testid="dashboard-shell"] must exist').toBe(true);
    const bad = cards.cards.filter((c) => !c.found || c.selfOverflow || c.widerThanColumn || c.overhangsColumn);
    expect(bad, cardWidthMessage(width, cards)).toEqual([]);

    const doc = await page.evaluate(probeDocumentWidth);
    expect(doc.scrollWidth, `@ ${width}: document scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
  });
}

// ---- Geometry: the hero cards share a row height, and Draft Grades sits
// close to the standings table's height (measured once, at the audit's own
// width) ----

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the hero cards are equal height and Draft Grades is within 120px of the standings table`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const heights = await page.evaluate(probeHeroAndRailHeights);
  expect(heights.myTeam, 'my-team-summary must be found').not.toBeNull();
  expect(heights.matchup, 'matchup-preview must be found').not.toBeNull();
  expect(heights.standings, 'standings-table must be found').not.toBeNull();
  expect(heights.draftGrades, 'draft-grades must be found').not.toBeNull();

  // `align-items: stretch` (#1110) on the hero grid: My Team and the matchup
  // card share the row height, within 1px (sub-pixel layout rounding).
  expect(
    Math.abs((heights.myTeam as number) - (heights.matchup as number)),
    `My Team height=${heights.myTeam} matchup height=${heights.matchup}`,
  ).toBeLessThanOrEqual(1);

  // The audit's own bound (ADR 0034): Draft Grades within 120px of the
  // standings table it sits beside, closing the 919px gap the audit measured
  // under the old commissioner-panel rail card.
  expect(
    Math.abs((heights.standings as number) - (heights.draftGrades as number)),
    `standings height=${heights.standings} draft-grades height=${heights.draftGrades}`,
  ).toBeLessThanOrEqual(120);
});

// ---- Permanent negative control ----
//
// Inject a style that forces one card wider than its column, assert the
// predicate reports it, remove it. Proves the predicate can still go red on
// every CI run, the failure mode a guard that has quietly stopped working
// looks exactly like.

test('negative control: the width predicate reports a forced card overflow', async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const before = await page.evaluate(probeCardWidths, { cardTestIds: CARD_TESTIDS, tol: 1 });
  expect(before.cards.some((c) => c.widerThanColumn || c.selfOverflow), cardWidthMessage(MEASURED_WIDTH, before)).toBe(false);

  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="standings-table"]') as HTMLElement | null;
    if (!card) return;
    card.style.width = '4000px';
    card.style.maxWidth = 'none';
  });
  const during = await page.evaluate(probeCardWidths, { cardTestIds: CARD_TESTIDS, tol: 1 });
  const forced = during.cards.find((c) => c.testId === 'standings-table');
  expect(forced?.widerThanColumn, 'a forced 4000px-wide standings-table card must be reported as wider than its column').toBe(true);

  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="standings-table"]') as HTMLElement | null;
    if (!card) return;
    card.style.width = '';
    card.style.maxWidth = '';
  });
  const after = await page.evaluate(probeCardWidths, { cardTestIds: CARD_TESTIDS, tol: 1 });
  const restored = after.cards.find((c) => c.testId === 'standings-table');
  expect(restored?.widerThanColumn, 'removing the forced width must restore the column fit').toBe(false);
});
