/**
 * League Dashboard "Play-select" guard (#2330, ADR 0067 wave 1b). jsdom has no layout engine, so this
 * mirrors tests/e2e/home-playselect.spec.ts: `page.route` API stubs
 * (fixtures/leagueDashboardPlayselectFixtures.ts, layered on the layout-guard harness), headless
 * Chromium, DOM probes.
 *
 * Every state x viewport x colour scheme:
 *  - the page's cursors: exactly the count the state carries (one while a play needs the viewer,
 *    none when nothing does) and never more than one;
 *  - no sideways scroll on the document or the body;
 *  - a full-page screenshot under test-results/league-dashboard-shots/ (review artefacts, not
 *    snapshot assertions).
 * Plus the phone standings: the viewer's row with two teams either side and a "Full standings" link,
 * all twelve rows at desktop.
 *
 * What this does NOT cover: colours (src/theme/tokens.contrast.test.js), the widgets' row-level
 * geometry (league-dashboard-layout.spec.ts), the recap and trophy bounds (recap-layout.spec.ts,
 * trophy-case-layout.spec.ts).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  DASH_TEAMS, DASH_URL, EXPECTED_CURSORS, setupDashboard,
} from './fixtures/leagueDashboardPlayselectFixtures';
import type { DashState, DashTheme } from './fixtures/leagueDashboardPlayselectFixtures';
import { LEAGUE_ID } from './fixtures/layoutGuardFixtures';
import { json } from './fixtures/jsonRoute';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
const STATES: DashState[] = ['inseason', 'gamedayUrgent', 'gamedaySet', 'predraft', 'complete', 'pickemonly'];
const THEMES: DashTheme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'league-dashboard-shots');
// The states that carry a standings table (a pre-draft or pick'em-only league has no fantasy standings).
const HAS_STANDINGS: DashState[] = ['inseason', 'gamedayUrgent', 'gamedaySet', 'complete'];
let unanswered: string[] = [];

test.afterEach(() => {
  expect(unanswered, 'every request the dashboard makes is answered by the fixture').toEqual([]);
});

// A request the fixture does not answer comes back 500 `unexpected mocked request`; a state that read one would
// paint an error panel and pass the probes below for the wrong reason, so every state must read only answered routes.
function watchUnanswered(page: Page) {
  unanswered = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    // The boot-time token refresh is outside every harness's table (the guard's catch-all 500s it too).
    if (res.status() === 500 && pathname.startsWith('/api/') && pathname !== '/api/auth/refresh') unanswered.push(pathname);
  });
}

async function openDashboard(page: Page, state: DashState, viewport: ViewportName, theme?: DashTheme) {
  watchUnanswered(page);
  await setupDashboard(page, state, { theme });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(DASH_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (HAS_STANDINGS.includes(state)) await expect(page.getByTestId('standings-table-you-row')).toBeVisible();
  // Your move reads its own request; the card (or its empty line) is part of the state's cursor count.
  if (EXPECTED_CURSORS[state] > 0) await expect(page.locator('.cursor')).toHaveCount(EXPECTED_CURSORS[state]);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // The load blink runs a second and a half in steps; the count above is stable through it.
  await page.waitForTimeout(150);
}

for (const state of STATES) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    for (const theme of THEMES) {
      test(`${state} ${viewport} ${theme}: the state's cursors, at most one, no sideways scroll`, async ({ page }) => {
        await openDashboard(page, state, viewport, theme);

        const probe = await page.evaluate(() => ({
          cursors: document.querySelectorAll('.cursor').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          // The first double-ruled frame that is not the black live Board: its fill is the dashboard's menu panel (#2660).
          panel: getComputedStyle([...document.querySelectorAll('.ps-root *')].find((el) => getComputedStyle(el).borderTopStyle === 'double' && getComputedStyle(el).backgroundColor !== 'rgb(0, 0, 0)') as Element).backgroundColor,
        }));
        // eslint-disable-next-line no-console
        console.log(`LEAGUE_DASHBOARD_PLAYSELECT ${state}-${viewport}-${theme} ${JSON.stringify(probe)}`);

        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${state}-${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

        expect(probe.cursors, 'never more than one .cursor').toBeLessThanOrEqual(1);
        expect(probe.cursors, `${state} carries ${EXPECTED_CURSORS[state]} cursor(s)`).toBe(EXPECTED_CURSORS[state]);
        expect(probe.panel, 'dashboard frames paint the menu panel').toBe(theme === 'dark' ? 'rgb(18, 28, 76)' : 'rgb(255, 255, 255)');
        expect(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
        expect(probe.bodyScrollWidth, `body scrollWidth ${probe.bodyScrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
      });
    }
  }
}

// The standings table: all twelve teams at desktop; at 390 the viewer (sixth) with two teams either
// side and a "Full standings" control that opens the rest.
test('phone standings: the viewer row with two teams either side and a Full standings link', async ({ page }) => {
  await openDashboard(page, 'inseason', 'phone');
  const table = page.getByTestId('standings-table');
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  const you = table.getByTestId('standings-table-you-row');
  await expect(you).toHaveCount(1);
  const ranks = await rows.evaluateAll((trs) => trs.map((tr) => (tr.querySelector('td') as HTMLElement).textContent?.trim()));
  expect(ranks).toEqual(['4', '5', '6', '7', '8']);
  await expect(you.locator('td').first()).toHaveText('6');

  const full = table.getByTestId('standings-table-full');
  await expect(full).toBeVisible();
  await expect(full).toHaveText('Full standings');
  await full.click();
  await expect(rows).toHaveCount(12);
});

// In season the Play and Moves links sit in a "League pages" row under Your move, so Waivers is in reach on a
// phone (it was about 2,560px down) and every link in the row is a 44px target.
test('inseason phone: the League pages row puts Waivers under 1,200px and every link is a 44px target', async ({ page }) => {
  await openDashboard(page, 'inseason', 'phone');
  const pages = page.getByRole('navigation', { name: 'League pages' });
  await expect(pages).toBeVisible();
  const waivers = await pages.getByRole('link', { name: 'Waivers' }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(waivers, 'Waivers top edge from the top of the page').toBeLessThan(1200);
  const heights = await pages.getByRole('link').evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) {
    expect(height, 'a link in the League pages row is a 44px target').toBeGreaterThanOrEqual(44);
  }
});

// An unbreakable team name (a real league has one) in a flex:1 / minWidth:0 span overflows its box into the
// score unless the span breaks anywhere; names with spaces wrap, which is why the stock fixtures never caught it.
test('phone around the league: a long one-word team name never runs under the score', async ({ page }) => {
  watchUnanswered(page);
  await setupDashboard(page, 'gamedaySet', { theme: 'light', teamNames: { 103: 'DoDaPerpsHave@QB?WithNoSpaces', 106: 'CaShMeOuTsIdEeRiGhTnOwPlEaSe' } });
  await page.setViewportSize(VIEWPORTS.phone);
  await page.goto(DASH_URL);
  await expect(page.getByTestId('around-the-league-tile').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="around-the-league-figure"]')).map((fig) => {
    const name = fig.previousElementSibling as HTMLElement;
    return { name: name.textContent, scrollWidth: name.scrollWidth, clientWidth: name.clientWidth, right: name.getBoundingClientRect().right, figureLeft: fig.getBoundingClientRect().left };
  }));
  expect(rows.some((r) => r.name === 'DoDaPerpsHave@QB?WithNoSpaces'), 'the long name is on a tile').toBe(true);
  for (const r of rows) {
    expect(r.scrollWidth, `${r.name}: text wider than its box`).toBeLessThanOrEqual(r.clientWidth);
    expect(r.right, `${r.name}: name runs under the figure`).toBeLessThanOrEqual(r.figureLeft);
  }
});

// My team's lineup line follows this league's Action items: a Lineup problem reads as the problem with no check
// at either viewport, and a set lineup keeps "Lineup set" and its check.
for (const viewport of ['desktop', 'phone'] as const) {
  test(`${viewport} gamedayUrgent: My team states the Lineup problem and prints no check`, async ({ page }) => {
    await openDashboard(page, 'gamedayUrgent', viewport);
    const status = page.getByTestId('my-team-lineup-status');
    await expect(status).toContainText('Lineup problem');
    await expect(status).not.toContainText('Lineup set');
    await expect(page.getByTestId('my-team-lineup-check')).toHaveCount(0);
  });
}

// An Out starter leads My team's list, and the note counts no questionable starter (spec #2979).
for (const viewport of ['desktop', 'phone'] as const) {
  test(`${viewport} gamedayUrgent: My team lists Puka Nacua first and the note names no questionable count`, async ({ page }) => {
    await openDashboard(page, 'gamedayUrgent', viewport);
    await expect(page.getByTestId('my-team-starters').getByTestId('starter-row').first()).toContainText('Puka Nacua');
    const note = page.getByTestId('my-team-starters-more');
    await expect(note).toContainText('and 4 more starters');
    await expect(note).not.toContainText('questionable');
  });
}

test('desktop gamedaySet: My team reads Lineup set with the check', async ({ page }) => {
  await openDashboard(page, 'gamedaySet', 'desktop');
  await expect(page.getByTestId('my-team-lineup-status')).toContainText('Lineup set');
  await expect(page.getByTestId('my-team-lineup-check')).toHaveCount(1);
});

// From sm up the chat launcher is a fixed 56px button 24px off the corner: it takes 80px of the viewport at full
// scroll. The last frame must end above it with 8px to spare (88px minimum; the page pads 96), and the page must
// reserve that room itself: the app footer below the shell gives clearance today, but the page does not own the footer.
for (const state of ['inseason', 'gamedayUrgent', 'complete', 'predraft', 'pickemonly'] as const) {
  test(`${state} desktop: scrolled to the end, the chat launcher sits below the last frame`, async ({ page }) => {
    await openDashboard(page, state, 'desktop', 'light');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const launcher = page.getByRole('button', { name: /^Open league chat/ });
    await expect(launcher).toBeVisible();
    const box = (await launcher.boundingBox())!;
    const last = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('[data-testid="dashboard-shell"] > *'))
        .filter((el) => getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().height > 0);
      const el = blocks[blocks.length - 1];
      const shell = document.querySelector('[data-testid="dashboard-shell"]')!;
      return { bottom: el.getBoundingClientRect().bottom, reserve: shell.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom, text: (el.textContent ?? '').slice(0, 40) };
    });
    expect(last.bottom + 8, `the last frame ("${last.text}") ends at ${last.bottom}, the launcher starts at ${box.y}`).toBeLessThanOrEqual(box.y);
    expect(last.reserve, `the shell reserves ${last.reserve}px below the last frame; the launcher needs 88`).toBeGreaterThanOrEqual(88);
  });
}

// Below sm the chat is the Ghost "Chat" button in the page head, not a corner button over the page, so the page
// keeps only the loading shell's 24px at its end and reserves no launcher clearance.
for (const state of ['inseason', 'gamedayUrgent', 'complete', 'predraft', 'pickemonly'] as const) {
  test(`${state} phone: scrolled to the end, the page reserves no launcher clearance (24px)`, async ({ page }) => {
    await openDashboard(page, state, 'phone', 'light');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const reserve = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('[data-testid="dashboard-shell"] > *'))
        .filter((el) => getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().height > 0);
      const el = blocks[blocks.length - 1];
      const shell = document.querySelector('[data-testid="dashboard-shell"]')!;
      return shell.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    });
    expect(reserve, `the shell reserves ${reserve}px below the last frame`).toBe(24);
  });
}

// Below sm the chat is the Ghost "Chat" button in the page head: a real 44px target, above the lead Play's frame,
// and covering no link inside the cursor frame. Every state, at scroll 0.
for (const state of STATES) {
  test(`${state} phone: the chat button sits in the page head above the Your move frame, 44px, clear of the cursor`, async ({ page }) => {
    await openDashboard(page, state, 'phone', 'light');
    const chat = page.getByRole('button', { name: /^Open league chat/ });
    await expect(chat).toBeVisible();
    expect(await chat.evaluate((el) => getComputedStyle(el).position), 'the chat button is not fixed below sm').not.toBe('fixed');
    const box = (await chat.boundingBox())!;
    expect(box.height, 'the chat button is a 44px target').toBeGreaterThanOrEqual(44);

    // The lead frame: Your move where the state draws one, else the first frame under the head (a completed
    // league with nothing due draws no Your move card).
    const frameTop = await page.evaluate(() => {
      const frame = document.querySelector('[data-testid="slot-your-move"]') ?? document.querySelector('[data-testid="dashboard-main"]');
      return frame ? frame.getBoundingClientRect().top : null;
    });
    expect(frameTop, 'the page has a frame under the head').not.toBeNull();
    expect(box.y + box.height, `the chat button ends at ${box.y + box.height}, the frame starts at ${frameTop}`).toBeLessThanOrEqual(frameTop!);

    const cursorLinks = await page.locator('.cursor a').evaluateAll((links) => links.map((a) => {
      const r = a.getBoundingClientRect();
      return { text: a.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    const under = cursorLinks.filter((r) => r.left < box.x + box.width && r.right > box.x && r.top < box.y + box.height && r.bottom > box.y);
    expect(under, 'no link in the cursor frame sits under the chat button').toEqual([]);
  });
}

// The chat drawer and its emoji menu portal out of the page root, so each paper must take the menu panel itself (#2660).
for (const theme of THEMES) {
  test(`inseason desktop ${theme}: the league chat drawer and its emoji menu paint the menu panel`, async ({ page }) => {
    await openDashboard(page, 'inseason', 'desktop', theme);
    await page.getByRole('button', { name: /^Open league chat/ }).click();
    const paper = page.locator('.MuiDrawer-paper');
    await expect(paper).toBeVisible();
    const background = await paper.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background, 'chat drawer paper paints the menu panel').toBe(theme === 'dark' ? 'rgb(18, 28, 76)' : 'rgb(255, 255, 255)');

    await page.getByRole('button', { name: 'Insert emoji' }).click();
    const menu = page.getByRole('menu', { name: 'Emoji' });
    await expect(menu).toBeVisible();
    const menuPaper = page.locator('.MuiMenu-paper').filter({ has: menu });
    const menuBackground = await menuPaper.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(menuBackground, 'emoji menu paper paints the menu panel').toBe(theme === 'dark' ? 'rgb(18, 28, 76)' : 'rgb(255, 255, 255)');
  });
}

test('desktop standings: all twelve teams, no fold control', async ({ page }) => {
  await openDashboard(page, 'inseason', 'desktop');
  const table = page.getByTestId('standings-table');
  await expect(table.locator('tbody tr')).toHaveCount(12);
  await expect(table.getByTestId('standings-table-full')).toHaveCount(0);
});

// #2929: at desktop every standings column fits its column beside Recent activity, STRK included, so the table
// never scrolls sideways. Each state that carries standings is measured at the desktop viewport.
for (const state of ['inseason', 'gamedayUrgent', 'gamedaySet', 'complete'] as const) {
  test(`${state} desktop: the standings fit their box with every column in it, STRK included`, async ({ page }) => {
    await openDashboard(page, state, 'desktop');
    const box = await page.getByTestId('standings-table-scroll').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: el.getBoundingClientRect().right,
    }));
    const strkRight = await page.getByTestId('standings-table').getByRole('columnheader', { name: 'STRK' })
      .evaluate((el) => el.getBoundingClientRect().right);
    expect(box.scrollWidth, `standings scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth}`).toBeLessThanOrEqual(box.clientWidth);
    expect(strkRight, `STRK header right edge ${strkRight} vs the box's right edge ${box.right}`).toBeLessThanOrEqual(box.right);
  });
}

// The md band (900 to 1199px, below lg): the standings share the row with the rail, so the Team name has to stay
// readable beside six columns that fit with no sideways scroll. Its own constant: VIEWPORTS runs every loop, and the
// inseason pixel VS case is red at these widths for a reason outside this widget.
const MD_BAND = {
  md900: { width: 900, height: 900 },
  md1024: { width: 1024, height: 900 },
} as const;
const MIN_NAME_PX = { md900: 48, md1024: 96 } as const;
const VIEWER_ID = 101; // the fixture's viewer; the fixture keeps its own copy unexported
const HEADERS = ['Rank', 'Team', 'W-L-T', 'PF', 'PA', 'STRK'];

// Twelve rows in rank order with the viewer sixth. The viewer's row prints its widest figures: Record 10-10-1 (one tie),
// 1800.5 for, 1799.5 against and a W10 streak. Every row carries a streak, so each cell is one that can overflow.
function narrowStandingsBody() {
  const viewer = DASH_TEAMS.find((t) => t.teamId === VIEWER_ID)!;
  const others = DASH_TEAMS.filter((t) => t.teamId !== VIEWER_ID);
  const ranked = [...others.slice(0, 5), viewer, ...others.slice(5)];
  return {
    standings: ranked.map((t, i) => (t.teamId === VIEWER_ID
      ? {
        teamId: t.teamId, teamName: t.teamName, rank: i + 1, wins: 10, losses: 10, ties: 1, pf: 1800.5, pa: 1799.5, streak: 'W10',
      }
      : {
        teamId: t.teamId, teamName: t.teamName, rank: i + 1, wins: 12 - i, losses: i, ties: 0, pf: 1500 - i * 20, pa: 1200 + i * 15, streak: 'L1',
      })),
  };
}

async function openNarrowStandings(page: Page, state: DashState, size: { width: number; height: number }) {
  watchUnanswered(page);
  await setupDashboard(page, state);
  // Registered after the fixture's catch-all, so this answer is the one the standings read gets.
  await page.route(`**/api/scoring/league/${LEAGUE_ID}/standings`, (route) => json(route, 200, narrowStandingsBody()));
  await page.setViewportSize(size);
  await page.goto(DASH_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('standings-table-you-row')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

for (const state of ['inseason', 'gamedayUrgent', 'gamedaySet', 'complete'] as const) {
  for (const band of Object.keys(MD_BAND) as (keyof typeof MD_BAND)[]) {
    test(`${state} ${band} standings: six headers, no sideways scroll, every Team name readable inside its cell, the You tag whole`, async ({ page }) => {
      await openNarrowStandings(page, state, MD_BAND[band]);
      const table = page.getByTestId('standings-table');

      // (a) the six headers are visible
      for (const name of HEADERS) await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();

      // (b) the table box does not scroll sideways
      const box = await page.getByTestId('standings-table-scroll').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(box.scrollWidth, `standings scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth}`).toBeLessThanOrEqual(box.clientWidth);

      // (c) every Team name span is readable, and (d) it and the You tag end inside that row's Team cell (th scope="row")
      const teams = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => {
        const cell = tr.querySelector('th[scope="row"]') as HTMLElement;
        const name = [...cell.querySelectorAll('span[title]')].find((s) => s.textContent === s.getAttribute('title')) as HTMLElement;
        const you = [...cell.querySelectorAll('span')].find((s) => s.textContent === 'You');
        return {
          team: name.getAttribute('title') ?? '',
          nameWidth: name.clientWidth,
          nameRight: name.getBoundingClientRect().right,
          youRight: you ? you.getBoundingClientRect().right : null,
          cellRight: cell.getBoundingClientRect().right,
        };
      }));
      expect(teams).toHaveLength(12);
      for (const t of teams) {
        expect(t.nameWidth, `${t.team} gets ${t.nameWidth}px at ${MD_BAND[band].width}`).toBeGreaterThanOrEqual(MIN_NAME_PX[band]);
        expect(t.nameRight, `${t.team} ends at ${t.nameRight} past its cell at ${t.cellRight}`).toBeLessThanOrEqual(t.cellRight);
        if (t.youRight !== null) expect(t.youRight, `the You tag ends at ${t.youRight} past its cell at ${t.cellRight}`).toBeLessThanOrEqual(t.cellRight);
      }
      await expect(table.getByTestId('standings-table-you-row').getByText('You', { exact: true })).toBeVisible();

      // (e) every cell of every row, the playoff line aside, fits its own column
      const overflowing = await table.locator('tbody tr:not([data-cut-line]) td').evaluateAll((tds) => tds
        .filter((td) => td.scrollWidth > td.clientWidth)
        .map((td) => `${td.textContent} ${td.scrollWidth}>${td.clientWidth}`));
      expect(overflowing, 'every cell fits its column').toEqual([]);
    });
  }
}

// Each body row's Team cell: its name, its width, and whether it draws a Team mark (the mark carries the
// standings-table-mark test id, passed through TeamMark from StandingsTable).
const teamCells = (table: Locator) => table.locator('tbody tr:not([data-cut-line])').evaluateAll((trs) => trs.map((tr) => {
  const cell = tr.querySelector('th[scope="row"]') as HTMLElement;
  return {
    team: cell.querySelector('span[title]')?.getAttribute('title') ?? '',
    width: cell.getBoundingClientRect().width,
    mark: cell.querySelector('[data-testid="standings-table-mark"]') !== null,
  };
}));

// The Team mark (#2978): below sm no standings row draws one, so the viewer's name keeps 150px beside the arrow and the You tag.
test('inseason phone: no standings row draws a team mark, and the viewer\'s Team name keeps 120px', async ({ page }) => {
  await openDashboard(page, 'inseason', 'phone');
  const table = page.getByTestId('standings-table');
  await expect(table.getByTestId('standings-table-you-row')).toBeVisible();
  expect((await teamCells(table)).filter((row) => row.mark), 'no row draws a mark at 390').toEqual([]);
  const name = await table.getByTestId('standings-table-you-row').locator('th span[title]').evaluate((el) => el.getBoundingClientRect().width);
  expect(name, `the viewer's Team name gets ${name}px at 390`).toBeGreaterThanOrEqual(120);
});

// From sm up a row draws its Team mark only where its Team cell is 240px or more, so no row is a mark in a cell too narrow for it.
for (const state of ['inseason', 'gamedayUrgent', 'gamedaySet', 'complete'] as const) {
  test(`${state} desktop: every standings row draws a team mark in a Team cell 240px or more`, async ({ page }) => {
    await openDashboard(page, state, 'desktop');
    const rows = await teamCells(page.getByTestId('standings-table'));
    expect(rows, 'all twelve rows are measured').toHaveLength(12);
    for (const row of rows) {
      expect(row.mark, `${row.team} draws no team mark at 1440`).toBe(true);
      expect(row.width, `${row.team} draws its mark in a ${row.width}px Team cell`).toBeGreaterThanOrEqual(240);
    }
  });
}

// Case (ii) at 900 (#2978 verdict): the page loads in stages, so each case waits for the settled layout before it asserts.
// The league's transactions read and the week's matchups read are armed before navigation, so an answer that lands during
// the load is not missed; the rail's placement is then polled until it is the state's settled one.
const FEED_PATH = `/api/league/${LEAGUE_ID}/transactions`;
const MATCHUPS_PATH = `/api/league/${LEAGUE_ID}/matchups`;

// Where the rail sits against the standings: beside them (its left edge past their right edge), below them (its top past
// their bottom), or 'none' while either box is missing.
const railPlacement = (page: Page) => page.evaluate(() => {
  const standings = document.querySelector('[data-testid="slot-standings"]')?.getBoundingClientRect();
  const rail = document.querySelector('[data-testid="dashboard-rail"]')?.getBoundingClientRect();
  if (!standings || !rail || rail.width === 0 || rail.height === 0) return 'none';
  if (rail.left >= standings.right) return 'beside';
  if (rail.top >= standings.bottom) return 'below';
  return 'overlap';
});

async function openSettledAt900(page: Page, state: DashState, placement: 'beside' | 'below') {
  watchUnanswered(page);
  const feedRead = page.waitForResponse((res) => new URL(res.url()).pathname === FEED_PATH);
  const matchupsRead = page.waitForResponse((res) => new URL(res.url()).pathname === MATCHUPS_PATH);
  await setupDashboard(page, state);
  await page.setViewportSize(MD_BAND.md900);
  await page.goto(DASH_URL);
  await Promise.all([feedRead, matchupsRead]);
  await expect(page.getByTestId('standings-table-you-row')).toBeVisible();
  await expect
    .poll(() => railPlacement(page), { message: `the rail sits ${placement} the standings`, timeout: 10_000 })
    .toBe(placement);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// Beside the rail on game day the Team cell is 173.6px and no row draws a mark.
for (const state of ['gamedayUrgent', 'gamedaySet'] as const) {
  test(`${state} md900 settled: no standings row draws a team mark beside the rail`, async ({ page }) => {
    await openSettledAt900(page, state, 'beside');
    const table = page.getByTestId('standings-table');
    await expect.poll(async () => (await teamCells(table)).length, { message: 'all twelve rows are measured' }).toBe(12);
    await expect.poll(async () => (await teamCells(table)).filter((row) => row.mark).map((row) => row.team), { message: 'rows drawing a mark beside the rail' }).toEqual([]);
  });
}

// Below the standings on inseason the Team cell is 516px and every row keeps its mark.
test('inseason md900 settled: every standings row draws a team mark in a Team cell 240px or more', async ({ page }) => {
  await openSettledAt900(page, 'inseason', 'below');
  const table = page.getByTestId('standings-table');
  await expect.poll(async () => (await teamCells(table)).length, { message: 'all twelve rows are measured' }).toBe(12);
  await expect.poll(async () => (await teamCells(table)).filter((row) => !row.mark || row.width < 240).map((row) => row.team), { message: 'rows without a mark, or with a Team cell under 240px' }).toEqual([]);
});

test('complete md900 settled: every standings row has a Team cell 240px or more, or draws no team mark', async ({ page }) => {
  await openSettledAt900(page, 'complete', 'below');
  const table = page.getByTestId('standings-table');
  await expect.poll(async () => (await teamCells(table)).length, { message: 'all twelve rows are measured' }).toBe(12);
  await expect.poll(async () => (await teamCells(table)).filter((row) => row.mark && row.width < 240).map((row) => row.team), { message: 'rows drawing a mark in a Team cell under 240px' }).toEqual([]);
});

// Pick'em-only table (#2930). Below sm it keeps four columns (Rank, Team, Points, this week), folds to the viewer's
// row with two teams either side and a Full standings link, and links to the Pick'em page for the rest.
test('pickemonly phone: four columns, the viewer row with two teams either side, Full standings shows all twelve', async ({ page }) => {
  await openDashboard(page, 'pickemonly', 'phone');
  const table = page.getByTestId('pickem-standings');
  await expect(table.getByRole('columnheader')).toHaveText(['Rank', 'Team', 'Points', /^Wk \d+$/]);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  const ranks = await rows.evaluateAll((trs) => trs.map((tr) => (tr.querySelector('td') as HTMLElement).textContent?.trim()));
  expect(ranks).toEqual(['4', '5', '6', '7', '8']);
  const you = table.getByTestId('pickem-standings-you-row');
  await expect(you.locator('td').first()).toHaveText('6');

  const box = await page.getByTestId('pickem-standings-scroll').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(box.scrollWidth, `pick'em table scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth}`).toBeLessThanOrEqual(box.clientWidth);
  const pointsRight = await you.locator('td').nth(1).evaluate((el) => el.getBoundingClientRect().right);
  expect(pointsRight, `the viewer row's Points cell ends at ${pointsRight}`).toBeLessThanOrEqual(VIEWPORTS.phone.width);
  const nameWidth = await you.locator('th span[title]').evaluate((el) => el.getBoundingClientRect().width);
  expect(nameWidth, `the viewer's name gets ${nameWidth}px at 390`).toBeGreaterThanOrEqual(80);

  await table.getByRole('button', { name: 'Full standings' }).click();
  await expect(rows).toHaveCount(12);
});

test("pickemonly phone: the link under the table goes to the Pick'em page and is a 44px target", async ({ page }) => {
  await openDashboard(page, 'pickemonly', 'phone');
  const link = page.getByRole('link', { name: 'Accuracy, weekly points and trend' });
  await expect(link).toHaveAttribute('href', /\/pickem$/);
  const box = (await link.boundingBox())!;
  expect(box.height, 'the link is a 44px target').toBeGreaterThanOrEqual(44);
});

// From sm up Trend is in the table, so the link reads "Accuracy and weekly points"; it sits under the table at every width.
test("pickemonly desktop: the link under the table reads Accuracy and weekly points and goes to the Pick'em page", async ({ page }) => {
  await openDashboard(page, 'pickemonly', 'desktop');
  const link = page.getByRole('link', { name: 'Accuracy and weekly points' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /\/pickem$/);
  const under = await link.evaluate((el) => el.getBoundingClientRect().top >= document.querySelector('[data-testid="pickem-standings-scroll"]')!.getBoundingClientRect().bottom);
  expect(under, 'the link sits under the table').toBe(true);
});

// From sm up the table keeps seven columns and fits its frame: the Team column takes what the numeric columns leave,
// so at 1440 a 58-character name fits its cell and keeps its full accessible name.
test('pickemonly desktop: seven columns fit the table box, every Team cell is 240px or more, a long Team name is not clipped', async ({ page }) => {
  const LONG = 'The Quarterback Whisperers of Tuesday Night Fantasy League';
  watchUnanswered(page);
  await setupDashboard(page, 'pickemonly', { teamNames: { [DASH_TEAMS[0].teamId]: LONG } });
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(DASH_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const table = page.getByTestId('pickem-standings');
  await expect(table.getByTestId('pickem-standings-you-row')).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Rank', 'Team', 'Points', /^Wk \d+$/, 'Correct', 'Missed', 'Trend']);

  const box = await page.getByTestId('pickem-standings-scroll').evaluate((el) => ({
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: el.getBoundingClientRect().right,
  }));
  expect(box.scrollWidth, `pick'em table scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth}`).toBeLessThanOrEqual(box.clientWidth);
  const trendRight = await table.getByRole('columnheader', { name: 'Trend' }).evaluate((el) => el.getBoundingClientRect().right);
  expect(trendRight, `Trend header right edge ${trendRight} vs the box's right edge ${box.right}`).toBeLessThanOrEqual(box.right);
  const teamWidths = await table.getByRole('rowheader').evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().width));
  expect(teamWidths).toHaveLength(12);
  for (const width of teamWidths) {
    expect(width, 'every Team cell is at least 240px').toBeGreaterThanOrEqual(240);
  }
  const viewerName = await table.getByTestId('pickem-standings-you-row').locator('th span[title]').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(viewerName, "the viewer's Team name is not clipped").toBe(true);
  const name = page.getByTestId('pickem-standings-scroll').getByTitle(LONG);
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the long Team name is not clipped at 1440').toBe(true);
  await expect(table.getByRole('rowheader', { name: LONG })).toHaveCount(1);
});

// The table's floor is 712px (the seven columns take 472px, Team gets 240px), so at 768 the Team cell keeps 240px and
// a 58-character name is clipped inside it, its row header keeping the full name. The width is the red-tell for a wrong floor.
test('pickemonly tablet: the Team column keeps at least 240px at 768, and a long name is clipped with its full name', async ({ page }) => {
  const LONG = 'The Quarterback Whisperers of Tuesday Night Fantasy League';
  watchUnanswered(page);
  await setupDashboard(page, 'pickemonly', { teamNames: { [DASH_TEAMS[0].teamId]: LONG } });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(DASH_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const table = page.getByTestId('pickem-standings');
  await expect(table.getByTestId('pickem-standings-you-row')).toBeVisible();
  const teamWidth = (await table.getByRole('rowheader').first().boundingBox())!.width;
  expect(teamWidth, `the Team cell is ${teamWidth}px wide at 768`).toBeGreaterThanOrEqual(240);
  const name = page.getByTestId('pickem-standings-scroll').getByTitle(LONG);
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), 'the long Team name is clipped at 768').toBe(true);
  await expect(table.getByRole('rowheader', { name: LONG })).toHaveCount(1);
});

// A new league's invite code is 16 characters (crypto.randomBytes(8) as hex). At 360 the commissioner's Invite and
// the Chat button share the head's right slot, and that row must wrap rather than push the document sideways.
test('inseason phone 360: a commissioner with a 16-character invite code and the Chat button do not widen the document', async ({ page }) => {
  watchUnanswered(page);
  await setupDashboard(page, 'inseason', { theme: 'light', inviteCode: '0123456789abcdef' });
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(DASH_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open league chat/ })).toBeVisible();
  const probe = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
});

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`inseason ${viewport}: the matchup pivots on a pixel VS and every standings rank is pixel type inside its column`, async ({ page }) => {
    await openDashboard(page, 'inseason', viewport);
    const vs = page.getByTestId('matchup-vs');
    await expect(vs).toBeVisible();
    await expect(vs).toHaveCSS('font-size', viewport === 'phone' ? '24px' : '32px');
    expect(await vs.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Press Start 2P');
    // The VS takes width from both sides; the fixture's 13-glyph word ("CHATTAHOOCHEE") must still sit on one line.
    const longestWordLines = await page.getByTestId('matchup-side-viewer').locator('h3').evaluate((h3) => {
      const text = h3.firstChild as Text;
      const start = text.data.indexOf('Chattahoochee');
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 'Chattahoochee'.length);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });
    expect(longestWordLines).toBe(1);
    // The phone folds to five rows; open it so the two-digit ranks (10-12) are measured too.
    if (viewport === 'phone') await page.getByTestId('standings-table-full').click();
    const cells = await page.getByTestId('standings-table')
      .locator('tbody tr:not([data-cut-line]) td:first-child')
      .evaluateAll((tds) => tds.map((td) => ({
        family: getComputedStyle(td).fontFamily,
        width: Math.round(td.getBoundingClientRect().width),
        fits: td.scrollWidth <= td.clientWidth,
      })));
    expect(cells).toHaveLength(12);
    for (const cell of cells) {
      expect(cell.family).toContain('Press Start 2P');
      expect(cell.width).toBe(viewport === 'phone' ? 48 : 64);
      expect(cell.fits).toBe(true);
    }
  });
}

// The viewer's Matchup preview is labelled and clamped to three lines (#2933). The fixture's preview is long, so it
// overflows: its control names it at 44px and opens it, and the control then reads Show less.
for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`inseason ${viewport}: the matchup preview opens with a Preview lead-in, clamps to three lines and opens from its control`, async ({ page }) => {
    await openDashboard(page, 'inseason', viewport);
    const preview = page.getByTestId('matchup-preview-narrative');
    await expect(preview).toHaveText(/^Preview /);
    const lineHeight = await preview.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    const clamped = (await preview.boundingBox())!.height;
    expect(clamped, `the preview is ${clamped}px, three ${lineHeight}px lines plus 2px`).toBeLessThanOrEqual(3 * lineHeight + 2);

    const control = page.getByRole('button', { name: 'Read more of the preview' });
    await expect(control).toBeVisible();
    expect((await control.boundingBox())!.height, 'the control is a 44px target').toBeGreaterThanOrEqual(44);
    await control.click();
    await expect(page.getByTestId('matchup-preview-toggle')).toHaveText('Show less');
    expect((await preview.boundingBox())!.height, 'opened, the preview is taller than its clamp').toBeGreaterThan(clamped);
  });
}

// The pre-draft Play (spec #2971): its lock reads Draft, its foot copies the invite and leaves the URL alone, and the
// Draft Day frame carries the countdown. A league this viewer does not administer shows no Invite at all.
for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`predraft ${viewport}: the open-seats Play locks as Draft, its foot copies the invite and keeps the URL, Draft Day shows`, async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDashboard(page, 'predraft', viewport);
    const lead = page.locator('.cursor');
    await expect(lead).toContainText('Draft ');
    const before = page.url();
    await lead.getByRole('button', { name: 'Invite managers' }).click();
    await expect(lead.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(page.url(), 'the open-seats foot copies the invite and does not navigate').toBe(before);
    await expect(page.getByTestId('slot-draft-countdown')).toBeVisible();
  });
}

for (const state of ['complete', 'pickemonly', 'gamedaySet'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`${state} ${viewport}: no Invite button renders`, async ({ page }) => {
      await openDashboard(page, state, viewport);
      await expect(page.getByRole('button', { name: /invite/i })).toHaveCount(0);
    });
  }
}

// The head's "Times in" line sits on the Archivo ramp's 16px step: the ramp has no 17px.
test('inseason desktop: the Times in line is 16px', async ({ page }) => {
  await openDashboard(page, 'inseason', 'desktop');
  await expect(page.locator('p').filter({ hasText: /^Times in / })).toHaveCSS('font-size', '16px');
});

// A completed season opens on its trophy room (spec #2921): the champion banner, and the viewer's "Your season"
// line from the standings the page reads once (sixth of twelve in the fixture), with no cursor.
for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`complete ${viewport}: the champion banner shows, "Your season" reads 6th of 12, and no cursor`, async ({ page }) => {
    await openDashboard(page, 'complete', viewport, 'dark');
    await expect(page.getByTestId('trophy-champion')).toBeVisible();
    await expect(page.getByTestId('trophy-your-season')).toContainText('6th of 12');
    await expect(page.locator('.cursor')).toHaveCount(0);
  });
}

// Your move holds its place while its read is in flight (#2976): the placeholder is at least the card's height,
// and the card replaces it once the action-items route answers (held one second here).
for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`inseason ${viewport}: your-move-pending holds the place for the action-items read, then your-move replaces it`, async ({ page }) => {
    watchUnanswered(page);
    await setupDashboard(page, 'inseason');
    // Registered after the fixture, so it runs first: hold the read for a second, then fall through to the fixture's answer.
    await page.route((url) => url.pathname === '/api/user/action-items', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fallback();
    });
    await page.setViewportSize(VIEWPORTS[viewport]);
    await page.goto(DASH_URL);
    const placeholder = page.getByRole('status', { name: 'Checking what needs you' });
    await expect(placeholder).toHaveAttribute('data-testid', 'your-move-pending');
    const height = await placeholder.evaluate((el) => el.getBoundingClientRect().height);
    expect(height, 'the placeholder holds the card\'s place').toBeGreaterThanOrEqual(96);
    await expect(page.getByTestId('your-move')).toBeVisible();
    await expect(page.getByTestId('your-move-pending')).toHaveCount(0);
    await expect(page.locator('.cursor')).toHaveCount(1);
  });
}
