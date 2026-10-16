/**
 * Layout guard for the League Dashboard (#1110, ADR 0034; game-day order #1980; rebuilt on Play-select
 * #2330, ADR 0067 wave 1b).
 *
 * jsdom has no layout engine, so the geometry the dashboard promises (equal-height hero columns via
 * grid stretch, standings and Recent activity ending together, a Playbook that spans the content width,
 * no card ever wider than its column, the matchup on the first screen of a phone and left of My team on
 * desktop) is measured in headless Chromium and bound here, exactly as
 * tests/e2e/game-center-matchup-layout.spec.ts (#920) binds the same family of invariants for Game
 * Center and Matchup Detail. The jsdom page test (LeagueDashboardPage.test.jsx) binds the CSS RULES (the
 * grid template strings, the stretch declaration); this spec binds the RENDERED RESULT of those rules,
 * which is the right split (ADR: jsdom asserts a rule, Chromium proves what the rule produces on screen).
 * The Play-select states (cursor counts, both themes, the phone standings fold) are the sibling
 * league-dashboard-playselect.spec.ts.
 *
 * Fixture: `layoutGuardFixtures.ts`'s `setupLayoutGuard` / `fulfilApi`: a fantasy, in-season, commissioner
 * league, so every widget the page composes mounts with real content: the strip, the hero (matchup + My
 * team), Around the league, the main grid (standings beside Recent activity) and the Playbook line under
 * it. The fixture serves 6 teams and 8 activity rows. The Playbook's three-column frame is the completed
 * season's (and a pre-draft league's), so that case runs on the `complete` state of
 * `leagueDashboardPlayselectFixtures.ts`.
 *
 * The 12 and 20-team variants (#1993) re-route the reads whose row count follows the team count
 * (`fixtures/teamCountDashboardFixtures.ts`: the league's teams, the standings, the week's matchups, 20
 * activity rows), registered after `setupLayoutGuard`. The regression behind them showed only at 12
 * teams: the rail ended well above the standings.
 *
 * It runs in the `browser-security` job (`npm run test:e2e`), which collects every spec under tests/e2e
 * with no file argument, so this file is picked up with no workflow edit. It is Chromium-only (the e2e
 * config declares no projects).
 *
 * What this guard does NOT cover, and its green must NOT be read as covering:
 *   - the League chat drawer's own geometry: it is closed throughout every case here.
 *   - the recap and the trophy room (recap-layout.spec.ts, trophy-case-layout.spec.ts), and the
 *     pre-draft countdown, which this fixture's league does not put on screen.
 *   - what a removed structure used to promise: the dashboard no longer has a sticky rail, a Set Lineup
 *     tile or a per-row points line, and the matchup's two sides stack on a phone (ADR 0067 boards).
 */
import { expect, test, type Page } from '@playwright/test';
import { setupLayoutGuard, DASHBOARD_URL, LEAGUE_ID } from './fixtures/layoutGuardFixtures';
import { routeLeagueOfSize } from './fixtures/teamCountDashboardFixtures';
import { setupDashboard, DASH_URL } from './fixtures/leagueDashboardPlayselectFixtures';

type TeamCount = 6 | 12 | 20;
const TEAM_COUNTS: TeamCount[] = [6, 12, 20];

const WIDTHS = [320, 390, 768, 900, 1440];
const HEIGHT = 900;

// The one width the audit's hero/rail-height claims were measured at.
const MEASURED_WIDTH = 1440;

// How far Recent activity's last row may sit from the standings' last row, either way.
const RAIL_ROW_BOUND = 120;

// Every card the page composes that the fixture feeds real content, so each is a real column-width
// claim rather than an accident of an absent or empty card. `dashboard-shell` is the column, not a card.
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
 * ADR 0034's rail bound, on the Play-select grid. The two columns of the main row stretch to one height
 * (so the CARD heights always agree and say nothing about the feed), which makes the bound a read of
 * their CONTENT: where the standings' last row ends against where Recent activity's last row ends. A rail
 * that outgrows the standings pushes its last row below theirs; one that stops short (the 12-team
 * regression) leaves a bare column under its last row.
 */
function probeRailBound() {
  const height = (testId: string) => {
    const e = document.querySelector(`[data-testid="${testId}"]`);
    return e ? e.getBoundingClientRect().height : null;
  };
  const lastBottom = (selector: string) => {
    const els = Array.from(document.querySelectorAll(selector));
    return els.length ? Math.max(...els.map((e) => e.getBoundingClientRect().bottom)) : null;
  };
  return {
    mainHeight: height('dashboard-main'),
    standingsHeight: height('standings-table'),
    railCardHeight: height('recent-activity'),
    standingsRowsBottom: lastBottom('[data-testid="standings-table"] tbody tr'),
    railRowsBottom: lastBottom('[data-testid="recent-activity-row"]'),
  };
}

/**
 * #1998: the standings' width against the main row's, and where Recent
 * activity starts against where the standings end. Side by side, the standings
 * are the wider column and Recent activity's top is level with theirs; stacked,
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
 * The Playbook is alone in its row, so its card spans the shell's content width (the shell's box minus
 * its horizontal padding). The frame variant lays out one column per group at md.
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

/** Top and height of the matchup card. */
function probeMatchupGame() {
  const card = document.querySelector('[data-testid="matchup-preview"]');
  return {
    cardTop: card ? card.getBoundingClientRect().top + window.scrollY : null,
    cardHeight: card ? card.getBoundingClientRect().height : null,
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
 * every widget the page composes to have rendered its real content (not
 * just its skeleton): the strip's facts, the hero's two cards, an Around the
 * League tile, a standings row, a Recent activity row (the rail beside the
 * standings) and the Playbook. The Playbook and Recent activity are the last
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
  await page.getByTestId('quick-actions').waitFor();
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

  // Grid stretch on the hero: My team and the matchup card share the row height, within 1px (sub-pixel
  // layout rounding). With no Pick'em panel the matchup's column is one row, so it must fill it (a
  // phantom empty row for the absent panel is what used to leave the matchup short).
  expect(
    Math.abs((heights.myTeam as number) - (heights.matchup as number)),
    `My Team height=${heights.myTeam} matchup height=${heights.matchup}`,
  ).toBeLessThanOrEqual(1);
});

// ---- Geometry: the rail's rows end with the standings', the Playbook spans the row ----

// ADR 0034's bound: the last row of Recent activity is within 120px of the standings' last row, so a rail
// that outgrows the standings fails, and so does one that stops short of them (the 12-team regression): it
// shows ceil(teams * 3 / 4) rows, because a standings row is 44px and an activity row about 59px. The
// two columns' cards stretch to one height. Run at 6, 12 and 20 teams.
for (const teams of TEAM_COUNTS) {
  test(`League Dashboard, ${teams} teams @ ${MEASURED_WIDTH}x${HEIGHT}: the rail's rows end with the standings' within ${RAIL_ROW_BOUND}px, and both cards stretch to one height`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);

    const bound = await page.evaluate(probeRailBound);
    expect(bound.mainHeight, 'dashboard-main must be found').not.toBeNull();
    expect(bound.standingsHeight, 'standings-table must be found').not.toBeNull();
    expect(bound.railCardHeight, 'recent-activity must be found').not.toBeNull();
    expect(bound.standingsRowsBottom, 'standings rows must be found').not.toBeNull();
    expect(bound.railRowsBottom, 'recent-activity rows must be found').not.toBeNull();
    const rowsGap = Math.abs((bound.railRowsBottom as number) - (bound.standingsRowsBottom as number));
    // Measured deltas, reported in the PR.
    console.log(
      `[league-dashboard-layout] ${teams} teams: standings=${bound.standingsHeight} main=${bound.mainHeight} rail card=${bound.railCardHeight} |rail rows - standings rows|=${rowsGap.toFixed(1)}`,
    );
    expect(
      rowsGap,
      `${teams} teams: recent-activity last row bottom=${bound.railRowsBottom} standings last row bottom=${bound.standingsRowsBottom}`,
    ).toBeLessThanOrEqual(RAIL_ROW_BOUND);
    expect(
      Math.abs((bound.standingsHeight as number) - (bound.railCardHeight as number)),
      `${teams} teams: standings height=${bound.standingsHeight} recent-activity height=${bound.railCardHeight}`,
    ).toBeLessThanOrEqual(1);
  });

  test(`League Dashboard, ${teams} teams @ ${MEASURED_WIDTH}x${HEIGHT}: the Playbook line spans the content width`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);

    const qa = await page.evaluate(probeQuickActionsWidth);
    expect(qa.cardWidth, 'quick-actions must be found').not.toBeNull();
    expect(
      Math.abs((qa.cardWidth as number) - (qa.contentWidth as number)),
      `${teams} teams: quick-actions width=${qa.cardWidth} shell content width=${qa.contentWidth}`,
    ).toBeLessThanOrEqual(1);
  });
}

// The Playbook FRAME (the completed season's, and a pre-draft league's): three groups (Play, Moves,
// League), each in its own column, spanning the content width. Run on the `complete` Play-select state.
test(`League Dashboard, complete @ ${MEASURED_WIDTH}x${HEIGHT}: the Playbook frame spans the content width, one column per group`, async ({ page }) => {
  await setupDashboard(page, 'complete');
  await page.setViewportSize({ width: MEASURED_WIDTH, height: HEIGHT });
  await page.goto(DASH_URL);
  await page.getByTestId('quick-actions-group-play').waitFor();
  await fontsReady(page);

  const qa = await page.evaluate(probeQuickActionsWidth);
  expect(qa.cardWidth, 'quick-actions must be found').not.toBeNull();
  expect(
    Math.abs((qa.cardWidth as number) - (qa.contentWidth as number)),
    `quick-actions width=${qa.cardWidth} shell content width=${qa.contentWidth}`,
  ).toBeLessThanOrEqual(1);
  expect(qa.groupLefts, `group lefts=${qa.groupLefts.join(',')}`).toHaveLength(3);
  expect(new Set(qa.groupLefts).size, `group lefts=${qa.groupLefts.join(',')}`).toBe(3);
  expect([...qa.groupLefts].sort((x, y) => x - y)).toEqual(qa.groupLefts);
});

// Negative controls: the rail-row bound must be able to go red, both ways. A tall block put in front of
// the feed pushes its last row past the standings' (outgrows); hiding all but the first row leaves the
// rail short of them (the shape of the 12-team regression); the Playbook forced narrower than the row
// fails the width predicate. Removing each forcing brings every predicate back. A bound that cannot go
// red would pass the regressions it exists to catch.
for (const teams of TEAM_COUNTS) {
  test(`negative control, ${teams} teams: the rail-row bound reports a rail that outgrows or falls short of the standings`, async ({ page }) => {
    await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, teams);
    const gap = async () => {
      const b = await page.evaluate(probeRailBound);
      return Math.abs((b.railRowsBottom as number) - (b.standingsRowsBottom as number));
    };

    expect(await gap()).toBeLessThanOrEqual(RAIL_ROW_BOUND);

    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="recent-activity"]') as HTMLElement | null;
      if (!card) return;
      const spacer = document.createElement('div');
      spacer.setAttribute('data-negative-control', 'tall');
      spacer.style.height = '2000px';
      card.prepend(spacer);
    });
    expect(await gap(), 'a 2000px block ahead of the feed must be reported as over the bound').toBeGreaterThan(RAIL_ROW_BOUND);
    await page.evaluate(() => document.querySelector('[data-negative-control="tall"]')?.remove());
    expect(await gap()).toBeLessThanOrEqual(RAIL_ROW_BOUND);

    await page.evaluate(() => {
      Array.from(document.querySelectorAll('[data-testid="recent-activity-row"]')).slice(1).forEach((row) => {
        (row as HTMLElement).style.display = 'none';
      });
    });
    expect(await gap(), 'a feed cut to one row must be reported as short of the standings').toBeGreaterThan(RAIL_ROW_BOUND);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('[data-testid="recent-activity-row"]')).forEach((row) => {
        (row as HTMLElement).style.display = '';
      });
    });
    expect(await gap()).toBeLessThanOrEqual(RAIL_ROW_BOUND);
  });
}

// ---- Geometry: a feed too short to fill the rail stacks (#1998, ADR 0034) ----

// ceil(12 * 3 / 4) = 9 rows fill the rail at 12 teams. Fewer (an empty feed
// included) stack Recent activity under the full-width standings, so no bare
// rail column is left beside them; moving the threshold down one row turns the
// 8-row case red, up one turns the 9-row case red.
for (const feedRows of [0, 3, 8]) {
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

test(`League Dashboard, 12 teams, 9-row feed @ ${MEASURED_WIDTH}x${HEIGHT}: the rail is full, so the row stays two columns within the ${RAIL_ROW_BOUND}px bound`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT, 12, 9);

  const g = await page.evaluate(probeStack);
  expect(g.standingsWidth as number, `standings width=${g.standingsWidth} main width=${g.mainWidth}`).toBeLessThan(
    (g.mainWidth as number) - 100,
  );
  expect(g.recentTop as number, `recent-activity top=${g.recentTop} standings bottom=${g.standingsBottom}`).toBeLessThan(
    g.standingsBottom as number,
  );
  const bound = await page.evaluate(probeRailBound);
  expect(Math.abs((bound.railRowsBottom as number) - (bound.standingsRowsBottom as number))).toBeLessThanOrEqual(RAIL_ROW_BOUND);
  expect(Math.abs((bound.standingsHeight as number) - (bound.railCardHeight as number))).toBeLessThanOrEqual(1);
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

test('negative control: the Playbook width predicate reports a card narrower than the row', async ({ page }) => {
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
  expect(await gap(), 'a Playbook card capped at 700px must be reported as narrower than the row').toBeGreaterThan(1);
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="quick-actions"]') as HTMLElement | null;
    if (card) card.style.maxWidth = '';
  });
  expect(await gap()).toBeLessThanOrEqual(1);
});

// ---- The matchup first on a phone, left of My team on desktop (#1980, spec #1979 L1 L2 L4 L5) ----

// ADR 0067's game-day top rule: with no lock inside the hour the live scoreboard leads the page, so on a
// phone its card starts inside the first screen. Off game day the product order puts Your move and the
// commissioner strip above the hero (a commissioner's strip alone is a screen tall at 390), so the
// "above the fold" claim holds only on game day and is bound on the `gamedaySet` Play-select state.
test('League Dashboard @ 390x844, game day: the live matchup card starts on the first screen', async ({ page }) => {
  await setupDashboard(page, 'gamedaySet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(DASH_URL);
  await page.getByTestId('matchup-preview').waitFor();
  await fontsReady(page);

  const game = await page.evaluate(probeMatchupGame);
  expect(game.cardTop, 'matchup-preview must be found').not.toBeNull();
  expect(game.cardTop as number, `matchup card top=${game.cardTop}`).toBeLessThanOrEqual(600);
});

// The two sides stack on a phone (each side is a full-width block, the boards' phone layout), which makes
// the card taller than the old side-by-side one (it was bound to 520px): the bound is what the stacked
// card measures, so a card that balloons still fails.
test('League Dashboard @ 390x844: the matchup card is 620px tall or less', async ({ page }) => {
  await gotoDashboard(page, 390, 844);

  const game = await page.evaluate(probeMatchupGame);
  expect(game.cardHeight, 'matchup-preview must be found').not.toBeNull();
  expect(game.cardHeight as number, `matchup card height=${game.cardHeight}`).toBeLessThanOrEqual(620);
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
// lineup answer), retargeted to the Play-select markup (#2330). Kept as one
// delimited block, below everything above.
// ======================================================================

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: the Around the League cells (two rival matchups and the All matchups cell) span at least 90% of the strip's inner width`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  const probe = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="around-the-league-body"]') as HTMLElement;
    // The viewer's own matchup is the hero's, so the strip holds the rival matchups, then the All cell.
    const cells = Array.from(body.querySelectorAll(':scope > li')) as HTMLElement[];
    const tiles = document.querySelectorAll('[data-testid="around-the-league-tile"]').length;
    const style = getComputedStyle(body);
    const inner = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const lefts = cells.map((t) => t.getBoundingClientRect().left);
    const rights = cells.map((t) => t.getBoundingClientRect().right);
    return { count: cells.length, tiles, inner, span: Math.max(...rights) - Math.min(...lefts) };
  });
  expect(probe.tiles, 'the fixture week has two rival matchups').toBe(2);
  expect(probe.count, 'two tiles and the All matchups cell').toBe(3);
  expect(probe.span, `span=${probe.span} inner=${probe.inner}`).toBeGreaterThanOrEqual(probe.inner * 0.9);
});

test('League Dashboard @ 390x844: the viewer standings row keeps its You tag and record in view, and a long name ellipsizes', async ({ page }) => {
  await gotoDashboard(page, 390, 844);

  const row = page.getByTestId('standings-table-you-row');
  await expect(row).toBeVisible();
  const probe = await row.evaluate((tr) => {
    const scroller = tr.closest('[data-testid="standings-table-scroll"]') as HTMLElement;
    const sr = scroller.getBoundingClientRect();
    const th = tr.querySelector('th') as HTMLElement;
    const name = th.querySelector('span[title]') as HTMLElement;
    const tag = Array.from(th.querySelectorAll('span')).find((s) => s.textContent === 'You') as HTMLElement;
    const record = tr.querySelectorAll('td')[1] as HTMLElement;
    return {
      scrollerRight: sr.right,
      tagRight: tag.getBoundingClientRect().right,
      recordLeft: record.getBoundingClientRect().left,
      recordRight: record.getBoundingClientRect().right,
      nameTitle: name.getAttribute('title'),
      nameClipped: name.scrollWidth > name.clientWidth,
      nameEllipsis: getComputedStyle(name).textOverflow,
      thFits: th.scrollWidth <= th.clientWidth + 1,
    };
  });
  // eslint-disable-next-line no-console
  console.log(`LEAGUE_DASHBOARD_STANDINGS_390 ${JSON.stringify(probe)}`);
  expect(probe.tagRight, `You tag right=${probe.tagRight} scroller right=${probe.scrollerRight}`).toBeLessThanOrEqual(probe.scrollerRight);
  expect(probe.recordRight, `record right=${probe.recordRight} scroller right=${probe.scrollerRight}`).toBeLessThanOrEqual(probe.scrollerRight);
  expect(probe.thFits, 'the Team cell does not overflow itself').toBe(true);
  // The fit alone would also hold for a name that wraps or is cut mid-letter, so pin the mechanism: the
  // 30-character fixture name ellipsizes, and the full name is its title.
  expect(probe.nameEllipsis, 'the name must ellipsize').toBe('ellipsis');
  expect(probe.nameClipped, 'the fixture name is longer than the Team column').toBe(true);
  expect(probe.nameTitle).toBe('Chattahoochee Valley Riverhogs');
});

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: six rival Around the League matchups fill rows of three`, async ({ page }) => {
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

  // The grid is three columns off game day (four on it): six tiles make two full rows, the All matchups
  // cell starts a third, and every tile in a row is the same width.
  const probe = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[data-testid="around-the-league-tile"]'));
    return tiles.map((t) => {
      const r = t.getBoundingClientRect();
      return { top: Math.round(r.top), width: Math.round(r.width) };
    });
  });
  const tops = probe.map((p) => p.top);
  expect(probe, `tile tops=${tops.join(',')}`).toHaveLength(6);
  expect(new Set(tops).size, `tile tops=${tops.join(',')}`).toBe(2);
  expect(tops.filter((top) => top === tops[0]), `tile tops=${tops.join(',')}`).toHaveLength(3);
  expect(new Set(probe.map((p) => p.width)).size, `tile widths=${probe.map((p) => p.width).join(',')}`).toBe(1);
});

test(`League Dashboard @ ${MEASURED_WIDTH}x${HEIGHT}: a full lineup shows no empty starting slot copy anywhere`, async ({ page }) => {
  await gotoDashboard(page, MEASURED_WIDTH, HEIGHT);

  // My team's footer settles on its plain copy once the lineup read lands, so the absence below is not a
  // race with an unresolved read.
  await expect(page.getByTestId('my-team-lineup-status')).toContainText('Lineup set');
  await expect(page.getByText(/empty starting slot/)).toHaveCount(0);
});

// END #1981 widget cases
