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
import type { Page } from '@playwright/test';
import {
  DASH_URL, EXPECTED_CURSORS, setupDashboard,
} from './fixtures/leagueDashboardPlayselectFixtures';
import type { DashState, DashTheme } from './fixtures/leagueDashboardPlayselectFixtures';

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

// The chat launcher is a fixed 56px button 24px off the corner: it takes 80px of the viewport at full scroll. The last
// frame must end above it with 8px to spare (88px minimum; the page pads 96), and the page must reserve that room itself: the app footer below the shell
// gives clearance today, but the page does not own the footer.
for (const state of ['inseason', 'gamedayUrgent', 'complete', 'predraft', 'pickemonly'] as const) {
  for (const viewport of ['phone', 'desktop'] as const) {
    test(`${state} ${viewport}: scrolled to the end, the chat launcher sits below the last frame`, async ({ page }) => {
      await openDashboard(page, state, viewport, 'light');
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
