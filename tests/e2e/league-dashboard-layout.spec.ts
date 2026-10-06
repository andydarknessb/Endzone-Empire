/**
 * Layout guard for the League Dashboard v2 composition (#1110, ADR 0034) and
 * its game-day order (#1980, spec #1979).
 *
 * jsdom has no layout engine, so the geometry this ticket's canvas measured
 * (equal-height hero cards via `align-items: stretch`, a rail that tracks the
 * standings table it sits beside and stays sticky, a Quick Actions card that
 * spans the content width, no card ever wider than its column, and since #1980
 * the matchup first:
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
 * League, the main grid (standings + a rail holding Recent activity), and the
 * full-width Quick Actions card under it. The fixture serves 6 teams and 8
 * activity rows, so the page's team-count cap on the rail card (6 rows) is what
 * the height bound below measures.
 *
 * The 12 and 20-team variants (#1993) re-route the reads whose row count
 * follows the team count (`fixtures/teamCountDashboardFixtures.ts`: the
 * league's teams, the standings, the week's matchups, 20 activity rows),
 * registered after `setupLayoutGuard`. The regression behind them showed only at 12 teams: the
 * rail ended well above the standings, and a second row paired Quick Actions
 * with a card of another height, leaving bare page under it. Draft Grades left
 * the dashboard and Quick Actions now spans the row alone (#1993).
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
import { setupLayoutGuard, DASHBOARD_URL, LEAGUE_ID } from './fixtures/layoutGuardFixtures';
import { routeLeagueOfSize } from './fixtures/teamCountDashboardFixtures';

type TeamCount = 6 | 12 | 20;
const TEAM_COUNTS: TeamCount[] = [6, 12, 20];

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
 * ADR 0034's rail bound: the main grid (standings beside the rail) is within
 * 120px of the standings table alone, so the two columns end about together.
 * `main` is the taller of its two columns, so this reads a rail that outgrows
 * the standings; `railCardHeight` reads the other direction, a rail card that
 * stops short of them (the 12-team regression). Also reads the rail's computed
 * position.
 */
function probeRailBound() {
  const el = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);
  const height = (testId: string) => {
    const e = el(testId);
    return e ? e.getBoundingClientRect().height : null;
  };
  const rail = el('dashboard-rail');
  return {
    mainHeight: height('dashboard-main'),
    standingsHeight: height('standings-table'),
    railCardHeight: height('recent-activity'),
    railPosition: rail ? getComputedStyle(rail).position : null,
  };
}

/**
 * #1998: the standings' width against the main row's, and where Recent
 * activity starts against where the standings end. Side by side, the standings
 * are the 8fr column and Recent activity's top is level with theirs; stacked,
 * the standings span the row and Recent activity starts at or below their
 * bottom edge.
 */
function probeStack() {
  const rect = (testId: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    return el ? el.getBoundingClientRect() : null;
  };
  const main = rect('dashboard-main');
  const standings = rect('slot-standings');
  const recent = rect('slot-recent-activity');
  return {
    mainWidth: main ? main.width : null,
    standingsWidth: standings ? standings.width : null,
    standingsBottom: standings ? standings.bottom : null,
    recentTop: recent ? recent.top : null,
  };
}

/**
 * Quick Actions is alone in its row, so its card spans the shell's content
 * width (the shell's box minus its horizontal padding) and lays one column per
 * group out at md.
 */
function probeQuickActionsWidth() {
  const shell = document.querySelector('[data-testid="dashboard-shell"]') as HTMLElement | null;
  const card = document.querySelector('[data-testid="quick-actions"]');
  if (!shell || !card) return { cardWidth: null, contentWidth: null, groupLefts: [] as number[] };
  const style = getComputedStyle(shell);
  return {
    cardWidth: card.getBoundingClientRect().width,
    contentWidth: shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    groupLefts: Array.from(document.querySelectorAll('[data-testid^="quick-actions-group-"]')).map(
      (g) => Math.round(g.getBoundingClientRect().left),
    ),
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
 * League tile, a standings row, a Recent activity row (the rail beside the
 * standings) and Quick Actions. Quick Actions and Recent activity are the last
 * of these to settle, which is what makes the width and height probes below
 * measure the fully-loaded page rather than a mid-load layout.
 */
async function gotoDashboard(
  page: Page,
  width: number,
  height: number,
  teams: TeamCount = 6,
  feedRows?: number,
) {
  await setupLayoutGuard(page);
  if (teams !== 6 || feedRows !== undefined) await routeLeagueOfSize(page, teams, feedRows);
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD_URL);
  // Attached, not visible: the fact grid does not display below md (#1980), so
  // visibility would never come at the phone widths this guard measures.
  await page.getByTestId('commissioner-strip-facts').waitFor({ state: 'attached' });
  await page.getByTestId('my-team-summary').waitFor();
  await page.getByTestId('matchup-preview').waitFor();
  await page.getByTestId('around-the-league-tile').first().waitFor();
  await page.getByTestId('standings-table-count').waitFor();
  await page.getByTestId('quick-actions-body').waitFor();
  // An empty feed renders its sentence instead of a row (#1998).
  await page.getByTestId(feedRows === 0 ? 'recent-activity-empty' : 'recent-activity-row').first().waitFor();
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

for (const teams of [12, 20] as TeamCount[]) {
test(`League Dashboard, ${teams} teams @ ${MEASURED_WIDTH}x${HEIGHT}: no card wider than its column, document never wider than the viewport`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);

  const cards = await page.evaluate(probeCardWidths, { cardTestIds: CARD_TESTIDS, tol: 1 });
  const bad = cards.cards.filter((c) => !c.found || c.selfOverflow || c.widerThanColumn || c.overhangsColumn);
  expect(bad, cardWidthMessage(MEASURED_WIDTH, cards)).toEqual([]);

  const doc = await page.evaluate(probeDocumentWidth);
  expect(doc.scrollWidth, `${teams} teams: document scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth + 1);
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

// ---- Geometry: the rail tracks the standings, Quick Actions spans the row ----

// ADR 0034's bound: `dashboard-main` is within 120px of the standings table, so
// a rail that outgrows the standings is what fails. The rail card itself is held
// to 60px of the standings, so a card that stops short of them (the 12-team
// regression) fails too: it shows ceil(teams * 5 / 6) rows, because a standings
// row is 49px and an activity row 58.8px. Run at 6, 12 and 20 teams.
for (const teams of TEAM_COUNTS) {
  test(`League Dashboard, ${teams} teams @ ${MEASURED_WIDTH}x${HEIGHT}: the rail tracks the standings within 120px and stays sticky`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);

    const bound = await page.evaluate(probeRailBound);
    expect(bound.mainHeight, 'dashboard-main must be found').not.toBeNull();
    expect(bound.standingsHeight, 'standings-table must be found').not.toBeNull();
    expect(bound.railCardHeight, 'recent-activity must be found').not.toBeNull();
    const mainDiff = Math.abs((bound.mainHeight as number) - (bound.standingsHeight as number));
    expect(
      mainDiff,
      `${teams} teams: dashboard-main height=${bound.mainHeight} standings height=${bound.standingsHeight}`,
    ).toBeLessThanOrEqual(120);
    const railDiff = Math.abs((bound.railCardHeight as number) - (bound.standingsHeight as number));
    // Measured deltas, reported in the PR.
    console.log(
      `[league-dashboard-layout] ${teams} teams: standings=${bound.standingsHeight} main=${bound.mainHeight} rail card=${bound.railCardHeight} |main-standings|=${mainDiff.toFixed(1)} |rail-standings|=${railDiff.toFixed(1)}`,
    );
    expect(
      railDiff,
      `${teams} teams: recent-activity height=${bound.railCardHeight} standings height=${bound.standingsHeight}`,
    ).toBeLessThanOrEqual(60);
    expect(bound.railPosition, 'dashboard-rail must compute position: sticky at md').toBe('sticky');
  });

  test(`League Dashboard, ${teams} teams @ ${MEASURED_WIDTH}x${HEIGHT}: Quick Actions spans the content width, one column per group`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);

    const qa = await page.evaluate(probeQuickActionsWidth);
    expect(qa.cardWidth, 'quick-actions must be found').not.toBeNull();
    expect(
      Math.abs((qa.cardWidth as number) - (qa.contentWidth as number)),
      `${teams} teams: quick-actions width=${qa.cardWidth} shell content width=${qa.contentWidth}`,
    ).toBeLessThanOrEqual(1);
    // A fantasy league has three groups (Play, Moves, League), each in its own
    // column: three distinct lefts, strictly increasing.
    expect(qa.groupLefts, `group lefts=${qa.groupLefts.join(',')}`).toHaveLength(3);
    expect(new Set(qa.groupLefts).size, `group lefts=${qa.groupLefts.join(',')}`).toBe(3);
    expect([...qa.groupLefts].sort((x, y) => x - y)).toEqual(qa.groupLefts);
  });
}

// Negative controls: the main-row bound must be able to go red, both ways. A
// rail forced tall enough to outgrow the standings pushes the main row over
// 120px, and a rail card forced short of them (the shape of the 12-team
// regression) fails the card bound; Quick Actions forced narrower than the row
// fails the width predicate. Removing each forcing brings every predicate back.
// A bound that cannot go red would pass the regressions it exists to catch.
for (const teams of TEAM_COUNTS) {
  test(`negative control, ${teams} teams: the main-row bound reports a rail that outgrows or falls short of the standings`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);
    const diffs = async () => {
      const b = await page.evaluate(probeRailBound);
      return {
        main: Math.abs((b.mainHeight as number) - (b.standingsHeight as number)),
        card: Math.abs((b.railCardHeight as number) - (b.standingsHeight as number)),
      };
    };

    const before = await diffs();
    expect(before.main).toBeLessThanOrEqual(120);
    expect(before.card).toBeLessThanOrEqual(60);

    await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="dashboard-rail"]') as HTMLElement | null;
      if (rail) rail.style.minHeight = '2000px';
    });
    expect((await diffs()).main, 'a forced 2000px rail must be reported as over the bound').toBeGreaterThan(120);
    await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="dashboard-rail"]') as HTMLElement | null;
      if (rail) rail.style.minHeight = '';
    });
    expect((await diffs()).main).toBeLessThanOrEqual(120);

    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="recent-activity"]') as HTMLElement | null;
      if (card) {
        card.style.maxHeight = '150px';
        card.style.overflow = 'hidden';
      }
    });
    expect((await diffs()).card, 'a rail card cut to 150px must be reported as short of the standings').toBeGreaterThan(60);
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="recent-activity"]') as HTMLElement | null;
      if (card) {
        card.style.maxHeight = '';
        card.style.overflow = '';
      }
    });
    expect((await diffs()).card).toBeLessThanOrEqual(60);
  });
}

// ---- Geometry: a feed too short to fill the rail stacks (#1998, ADR 0034) ----

// ceil(12 * 5 / 6) = 10 rows fill the rail at 12 teams. Fewer (an empty feed
// included) stack Recent activity under the full-width standings, so no bare
// rail column is left beside them; moving the threshold down one row turns the
// 9-row case red, up one turns the 10-row case red.
for (const feedRows of [0, 3, 9]) {
  test(`League Dashboard, 12 teams, ${feedRows}-row feed @ ${MEASURED_WIDTH}x${HEIGHT}: the standings span the row and Recent activity sits under them`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, 12, feedRows);

    const g = await page.evaluate(probeStack);
    expect(g.mainWidth, 'dashboard-main must be found').not.toBeNull();
    expect(
      Math.abs((g.standingsWidth as number) - (g.mainWidth as number)),
      `standings width=${g.standingsWidth} main width=${g.mainWidth}`,
    ).toBeLessThanOrEqual(1);
    expect(
      g.recentTop as number,
      `recent-activity top=${g.recentTop} standings bottom=${g.standingsBottom}`,
    ).toBeGreaterThanOrEqual((g.standingsBottom as number) - 1);
  });
}

test(`League Dashboard, 12 teams, 10-row feed @ ${MEASURED_WIDTH}x${HEIGHT}: the rail is full, so the row stays two columns within the 120px and 60px bounds`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, 12, 10);

  const g = await page.evaluate(probeStack);
  expect(g.standingsWidth as number, `standings width=${g.standingsWidth} main width=${g.mainWidth}`).toBeLessThan(
    (g.mainWidth as number) - 100,
  );
  expect(g.recentTop as number, `recent-activity top=${g.recentTop} standings bottom=${g.standingsBottom}`).toBeLessThan(
    g.standingsBottom as number,
  );
  const bound = await page.evaluate(probeRailBound);
  expect(Math.abs((bound.mainHeight as number) - (bound.standingsHeight as number))).toBeLessThanOrEqual(120);
  expect(Math.abs((bound.railCardHeight as number) - (bound.standingsHeight as number))).toBeLessThanOrEqual(60);
});

// The widget stays the feed's only reader: a second caller of
// `useLeagueTransactions` would be a second request (`useEndpoint` has no
// cache). This runs against the dev server (`npm run client`), where
// React.StrictMode (src/index.js) mounts every effect twice, so the one
// widget's one read is two requests; a second caller, or the stack remounting
// the card, makes it four or three. The 20-row case is the baseline that never
// stacks. The 3-row case reads its count only after the stacked layout has
// settled (`gotoDashboard` returns at the first feed row, before the restack),
// so a card remounted by the restack is counted too.
const STRICT_MODE_READS_PER_MOUNT = 2;
for (const [feedRows, stacks] of [[3, true], [20, false]] as const) {
  test(`League Dashboard, 12 teams, ${feedRows}-row feed: the feed is read once per card mount`, async ({ page }) => {
    let requests = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname === `/api/league/${LEAGUE_ID}/transactions`) requests += 1;
    });
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, 12, feedRows);
    if (stacks) {
      await expect
        .poll(
          async () => {
            const g = await page.evaluate(probeStack);
            return Math.abs((g.standingsWidth as number) - (g.mainWidth as number));
          },
          { message: 'slot-standings must span dashboard-main once the 3-row feed stacks' },
        )
        .toBeLessThanOrEqual(1);
    }
    expect(requests).toBe(STRICT_MODE_READS_PER_MOUNT);
  });
}

test('negative control: the Quick Actions width predicate reports a card narrower than the row', async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);
  const gap = async () => {
    const qa = await page.evaluate(probeQuickActionsWidth);
    return Math.abs((qa.cardWidth as number) - (qa.contentWidth as number));
  };

  expect(await gap()).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="quick-actions"]') as HTMLElement | null;
    if (card) card.style.maxWidth = '700px';
  });
  expect(await gap(), 'a Quick Actions card capped at 700px must be reported as narrower than the row').toBeGreaterThan(1);
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="quick-actions"]') as HTMLElement | null;
    if (card) card.style.maxWidth = '';
  });
  expect(await gap()).toBeLessThanOrEqual(1);
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

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the matchup is left of My Team and Recent activity rides the rail, not Draft Grades`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const order = await page.evaluate(probeOrder);
  expect(order.matchupRight, 'slot-matchup-preview must be found').not.toBeNull();
  expect(order.myTeamLeft, 'slot-my-team must be found').not.toBeNull();
  expect(
    order.matchupRight as number,
    `matchup right=${order.matchupRight} My Team left=${order.myTeamLeft}`,
  ).toBeLessThanOrEqual(order.myTeamLeft as number);
  expect(order.recentActivityInRail, 'slot-recent-activity must be inside dashboard-rail').toBe(true);
  await expect(page.getByTestId('draft-grades'), 'Draft Grades is gone from the dashboard (#1993)').toHaveCount(0);
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

// ======================================================================
// BEGIN #1981 widget cases (Around the League fill, phone standings, one
// lineup answer). Kept as one delimited block, below everything above, so a
// rebase onto the page-layout ticket's edits to this file stays mechanical.
// ======================================================================

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the three Around the League tiles span at least 90% of the strip's inner width`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const probe = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="around-the-league-body"]') as HTMLElement;
    const tiles = Array.from(document.querySelectorAll('[data-testid="around-the-league-tile"]')) as HTMLElement[];
    const style = getComputedStyle(body);
    const inner = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const lefts = tiles.map((t) => t.getBoundingClientRect().left);
    const rights = tiles.map((t) => t.getBoundingClientRect().right);
    return { count: tiles.length, inner, span: Math.max(...rights) - Math.min(...lefts) };
  });
  expect(probe.count, 'the fixture week has three matchups').toBe(3);
  expect(probe.span, `span=${probe.span} inner=${probe.inner}`).toBeGreaterThanOrEqual(probe.inner * 0.9);
});

test('League Dashboard @ 390x844: the viewer standings PF/PA line is never clipped and the You pill is not displayed', async ({ page }) => {
  await gotoDashboard(page, 390, 844);

  const row = page.getByTestId('standings-table-you-row');
  const line = row.getByTestId('standings-table-points-line');
  await expect(line).toBeVisible();
  const fit = await line.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(fit.scrollWidth, `scrollWidth=${fit.scrollWidth} clientWidth=${fit.clientWidth}`).toBeLessThanOrEqual(fit.clientWidth);
  // The fit alone would also hold for a line that clips with an ellipsis, so
  // pin the mechanism too: it wraps, and nothing truncates it.
  const style = await line.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, overflow: cs.overflowX };
  });
  expect(style.textOverflow, 'the points line must not ellipsize').not.toBe('ellipsis');
  expect(style.overflow, 'the points line must not clip').not.toBe('hidden');
  expect(['normal', 'pre-wrap', 'pre-line', 'break-spaces'], `white-space=${style.whiteSpace}`).toContain(style.whiteSpace);

  await expect(row.getByTestId('badge')).toBeHidden();
  await expect(row.getByText('your team')).toBeAttached();
});

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: six Around the League tiles (a twelve-team week) share one row`, async ({ page }) => {
  // A route override local to this case (registered after the shared fixture's
  // catch-all, so it wins): six current-week matchups instead of the fixture's three.
  await setupLayoutGuard(page);
  const week = 18;
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: 700 + i,
    season: 2026,
    week,
    final: false,
    status: 'scheduled',
    first_kickoff_at: null,
    synced_at: null,
    home_team_id: 201 + 2 * i,
    home_team_name: `Home Squad ${i + 1}`,
    home_score: 0,
    home_expected_final: 110 + i,
    home_players_remaining: 9,
    away_team_id: 202 + 2 * i,
    away_team_name: `Away Squad ${i + 1}`,
    away_score: 0,
    away_expected_final: 100 + i,
    away_players_remaining: 9,
  }));
  await page.route(
    (u) => /^\/api\/league\/\d+\/matchups$/.test(u.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }),
  );
  await page.setViewportSize({ width: MEASURED_WIDTH, height: HEIGHT });
  await page.goto(DASHBOARD_URL);
  await page.getByTestId('around-the-league-tile').first().waitFor();
  await fontsReady(page);

  const tops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="around-the-league-tile"]')).map(
      (t) => Math.round(t.getBoundingClientRect().top),
    ),
  );
  expect(tops, `tile tops=${tops.join(',')}`).toHaveLength(6);
  expect(new Set(tops).size, `tile tops=${tops.join(',')}`).toBe(1);
});

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: a full lineup shows no empty starting slot copy anywhere`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  // The Set Lineup row settles on its plain copy once the lineup read lands, so
  // the absence below is not a race with an unresolved read.
  await expect(page.getByTestId('quick-action-lineup')).toContainText('Set your Week 18 lineup');
  await expect(page.getByText(/empty starting slot/)).toHaveCount(0);
});

// END #1981 widget cases
