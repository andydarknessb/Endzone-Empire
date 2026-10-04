/**
 * Layout guard for the League Dashboard v2 composition (#1110, ADR 0034) and
 * its game-day order (#1980, spec #1979).
 *
 * jsdom has no layout engine, so the geometry this ticket's canvas measured
 * (equal-height hero cards via `align-items: stretch`, a rail that never
 * leaves bare page under the standings table it sits beside and stays sticky,
 * no card ever wider than its column, and since #1980 the matchup first:
 * above the fold on a phone, left of My Team on desktop, its two scores side
 * by side) is measured by hand in headless Chromium and bound here, exactly as tests/e2e/game-center-matchup-layout.spec.ts (#920) binds
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
 * with real content: the strip, the hero (matchup + My Team), Around the
 * League, the main grid (standings + a rail holding Recent activity, since the
 * fixture's season is live, #1980), and the second row (Quick Actions + Draft
 * Grades). The fixture serves the full 8 activity rows and 6 teams, so the
 * page's team-count cap on the rail card (6 rows) is what the height bound
 * below measures.
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

/** Bounding-box heights of the two hero cards the audit's equal-height claim names. */
function probeHeroHeights() {
  const rectOf = (testId: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    return el ? el.getBoundingClientRect().height : null;
  };
  return { myTeam: rectOf('my-team-summary'), matchup: rectOf('matchup-preview') };
}

/**
 * ADR 0034's one-sided rail bound: the main grid (standings beside the rail)
 * is at most 120px taller than the standings table alone, so the rail never
 * leaves bare page under the standings. The rail may be SHORTER than the
 * standings (it rides down with the scroll, sticky). Also reads the rail's
 * computed position.
 */
function probeRailBound() {
  const el = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);
  const main = el('dashboard-main');
  const standings = el('standings-table');
  const rail = el('dashboard-rail');
  return {
    mainHeight: main ? main.getBoundingClientRect().height : null,
    standingsHeight: standings ? standings.getBoundingClientRect().height : null,
    railPosition: rail ? getComputedStyle(rail).position : null,
  };
}

/** Top edges of the matchup card and of the two sides' score figures. */
function probeMatchupGame() {
  const topOf = (selector: string) => {
    const el = document.querySelector(selector);
    return el ? el.getBoundingClientRect().top + window.scrollY : null;
  };
  const card = document.querySelector('[data-testid="matchup-preview"]');
  return {
    cardTop: topOf('[data-testid="matchup-preview"]'),
    cardHeight: card ? card.getBoundingClientRect().height : null,
    viewerScoreTop: topOf('[data-testid="matchup-side-viewer"] [data-testid="matchup-side-score"]'),
    opponentScoreTop: topOf('[data-testid="matchup-side-opponent"] [data-testid="matchup-side-score"]'),
  };
}

/** Where the hero's two slots and the rail's occupant sit relative to each other. */
function probeOrder() {
  const rect = (testId: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    return el ? el.getBoundingClientRect() : null;
  };
  const matchup = rect('slot-matchup-preview');
  const myTeam = rect('slot-my-team');
  const rail = document.querySelector('[data-testid="dashboard-rail"]');
  const recent = document.querySelector('[data-testid="slot-recent-activity"]');
  return {
    matchupRight: matchup ? matchup.right : null,
    myTeamLeft: myTeam ? myTeam.left : null,
    recentActivityInRail: !!(rail && recent && rail.contains(recent)),
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
 * League tile, a standings row, a Draft Grades row (second row), and a Recent
 * activity row (the rail beside the standings in season). Quick Actions and
 * Recent activity are the last of these to settle, which is what makes the
 * width and height probes below measure the fully-loaded page rather than a
 * mid-load layout.
 */
async function gotoDashboard(page: Page, width: number, height: number) {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD_URL);
  // Attached, not visible: the fact grid does not display below md (#1980), so
  // visibility would never come at the phone widths this guard measures.
  await page.getByTestId('commissioner-strip-facts').waitFor({ state: 'attached' });
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

// ---- Geometry: the hero cards share a row height (measured once, at the
// audit's own width) ----

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the hero cards are equal height`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const heights = await page.evaluate(probeHeroHeights);
  expect(heights.myTeam, 'my-team-summary must be found').not.toBeNull();
  expect(heights.matchup, 'matchup-preview must be found').not.toBeNull();

  // `align-items: stretch` (#1110) on the hero grid: My Team and the matchup
  // card share the row height, within 1px (sub-pixel layout rounding).
  expect(
    Math.abs((heights.myTeam as number) - (heights.matchup as number)),
    `My Team height=${heights.myTeam} matchup height=${heights.matchup}`,
  ).toBeLessThanOrEqual(1);
});

// ---- Geometry: the rail never leaves bare page under the standings ----

// ADR 0034's bound, one-sided: `dashboard-main` is at most 120px taller than
// the standings table, so a rail that outgrows the standings is what fails
// (a short rail rides down with the scroll, sticky). The rail card is Recent
// activity here (season live), capped by the page at the team count.
test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the rail adds at most 120px under the standings and stays sticky`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const bound = await page.evaluate(probeRailBound);
  expect(bound.mainHeight, 'dashboard-main must be found').not.toBeNull();
  expect(bound.standingsHeight, 'standings-table must be found').not.toBeNull();
  const extra = (bound.mainHeight as number) - (bound.standingsHeight as number);
  expect(
    extra,
    `dashboard-main height=${bound.mainHeight} standings height=${bound.standingsHeight} extra=${extra}`,
  ).toBeLessThanOrEqual(120);
  expect(bound.railPosition, 'dashboard-rail must compute position: sticky at md').toBe('sticky');
});

// Negative control: a rail forced tall enough to outgrow the standings must
// push the bound over 120px, and removing the forcing must bring it back. A
// bound that cannot go red would pass the uncapped 8-row rail it exists to
// catch.
test('negative control: the rail bound reports a rail that outgrows the standings', async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const before = await page.evaluate(probeRailBound);
  expect((before.mainHeight as number) - (before.standingsHeight as number)).toBeLessThanOrEqual(120);

  await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="dashboard-rail"]') as HTMLElement | null;
    if (rail) rail.style.minHeight = '2000px';
  });
  const during = await page.evaluate(probeRailBound);
  expect(
    (during.mainHeight as number) - (during.standingsHeight as number),
    'a forced 2000px rail must be reported as over the bound',
  ).toBeGreaterThan(120);

  await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="dashboard-rail"]') as HTMLElement | null;
    if (rail) rail.style.minHeight = '';
  });
  const after = await page.evaluate(probeRailBound);
  expect((after.mainHeight as number) - (after.standingsHeight as number)).toBeLessThanOrEqual(120);
});

// ---- Game-day order (#1980, spec #1979 L1 L2 L4 L5) ----

test('League Dashboard @ 390x844: the matchup is above the fold and its two scores sit side by side', async ({ page }) => {
  await gotoDashboard(page, 390, 844);

  const game = await page.evaluate(probeMatchupGame);
  expect(game.cardTop, 'matchup-preview must be found').not.toBeNull();
  expect(game.viewerScoreTop, 'the viewer side score must be found').not.toBeNull();
  expect(game.opponentScoreTop, 'the opponent side score must be found').not.toBeNull();

  // The commissioner strip is compact on a phone (no fact grid), so the
  // matchup card starts in the upper part of the first screen.
  expect(game.cardTop as number, `matchup card top=${game.cardTop}`).toBeLessThanOrEqual(600);
  // Side by side, not stacked: the two scores' tops agree.
  expect(
    Math.abs((game.viewerScoreTop as number) - (game.opponentScoreTop as number)),
    `viewer score top=${game.viewerScoreTop} opponent score top=${game.opponentScoreTop}`,
  ).toBeLessThanOrEqual(4);
});

test('League Dashboard @ 390x844: the matchup card is 520px tall or less', async ({ page }) => {
  await gotoDashboard(page, 390, 844);

  const game = await page.evaluate(probeMatchupGame);
  expect(game.cardHeight, 'matchup-preview must be found').not.toBeNull();
  expect(game.cardHeight as number, `matchup card height=${game.cardHeight}`).toBeLessThanOrEqual(520);
});

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the matchup is left of My Team and Recent activity rides the rail`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const order = await page.evaluate(probeOrder);
  expect(order.matchupRight, 'slot-matchup-preview must be found').not.toBeNull();
  expect(order.myTeamLeft, 'slot-my-team must be found').not.toBeNull();
  expect(
    order.matchupRight as number,
    `matchup right=${order.matchupRight} My Team left=${order.myTeamLeft}`,
  ).toBeLessThanOrEqual(order.myTeamLeft as number);
  expect(order.recentActivityInRail, 'slot-recent-activity must be inside dashboard-rail').toBe(true);
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
