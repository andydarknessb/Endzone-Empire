/**
 * Game Center "Play-select" guard (#2334, ADR 0067 wave 2). jsdom has no layout engine, so this mirrors
 * tests/e2e/league-dashboard-playselect.spec.ts: `page.route` API stubs (the dashboard's Play-select
 * fixtures, layered on the layout-guard harness), headless Chromium, DOM probes.
 *
 * Game Center live (the dashboard's game-day fixture: week 6, every matchup live, an action item for the
 * viewer's lineup 45 minutes from its lock) and before kickoff (every matchup scheduled), each at 1440 and
 * 390, in both themes:
 *  - a watching page: no cursor and no filled action;
 *  - no sideways scroll on the document or the body;
 *  - the Live chip count the state carries (two live: the h1 row and the hero; none before kickoff);
 *  - the compact scoreboard: scrolled past the hero at 390, a bar no taller than 56px pins to the top and a
 *    focused element is not under it (scroll-padding-top);
 *  - desktop draws no latest-plays strip.
 * Plus a full-page screenshot under test-results/league-wave2-gamecenter-shots/ (review artefacts, not
 * snapshot assertions).
 *
 * What this does NOT cover: colours (src/theme/tokens.contrast.test.js), the NFL game strip (it needs Supabase,
 * unreachable without env vars; the Matchup slice restyles it), the header region geometry
 * (game-center-matchup-layout.spec.ts).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { LEAGUE_ID } from './fixtures/layoutGuardFixtures';
import { json } from './fixtures/jsonRoute';
import { setupDashboard } from './fixtures/leagueDashboardPlayselectFixtures';
import type { DashTheme } from './fixtures/leagueDashboardPlayselectFixtures';

const GC_URL = `/#/league/${LEAGUE_ID}/game-center`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
const STATES = { live: 'gamedayUrgent', pre: 'inseason' } as const;
type State = keyof typeof STATES;
const THEMES: DashTheme[] = ['dark', 'light'];
const SHOTS = path.join('test-results', 'league-wave2-gamecenter-shots');
const LIVE_CHIPS: Record<State, number> = { live: 2, pre: 0 };
let unanswered: string[] = [];

// The viewer's lineup (the hero's matchup detail): every starting slot filled but FLEX, with an empty bench, so the
// lineup note has something to say. The layout guard's own detail fills every slot.
const NOTE_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'];
function lineupDetail() {
  return {
    matchup: { id: 918, season: 2026, week: 6, final: false, status: 'live', home_score: 87.4, away_score: 71.2 },
    home: {
      teamId: 101,
      name: 'Chattahoochee Valley Riverhogs',
      starters: NOTE_SLOTS.map((slot, i) => ({
        id: 1000 + i, slot, name: `Starter ${i + 1}`, position: slot, nfl_team: null, game_state: 'in_progress', points: 10, projected: 11,
      })),
      bench: [],
    },
    away: { teamId: 102, name: 'Sasquatch of the Cascade Range', starters: [], bench: [] },
    viewerTeamId: 101,
    nflGameIds: [],
  };
}

test.afterEach(() => {
  expect(unanswered, 'every request Game Center makes is answered by the fixture').toEqual([]);
});

async function openGameCenter(page: Page, state: State, viewport: ViewportName, theme: DashTheme) {
  unanswered = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url(), 'http://x');
    if (res.status() === 500 && pathname.startsWith('/api/') && pathname !== '/api/auth/refresh') unanswered.push(pathname);
  });
  await setupDashboard(page, STATES[state], { theme });
  await page.route(`**/api/league/${LEAGUE_ID}/matchups/918`, (route: Route) => json(route, 200, lineupDetail()));
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(GC_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Game Center' })).toBeVisible();
  await expect(page.getByTestId('matchup-hero')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(150);
}

// A Live chip is a span whose first child is its aria-hidden square dot.
const countLiveChips = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('span'))
  .filter((el) => el.textContent === 'Live' && el.firstElementChild?.getAttribute('aria-hidden') === 'true').length);

for (const state of Object.keys(STATES) as State[]) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    for (const theme of THEMES) {
      test(`Game Center ${state} ${viewport} ${theme}: no cursor, no filled action, no sideways scroll, ${LIVE_CHIPS[state]} Live chips`, async ({ page }) => {
        await openGameCenter(page, state, viewport, theme);

        const probe = await page.evaluate(() => ({
          cursors: document.querySelectorAll('.cursor').length,
          filled: document.querySelectorAll('[data-filled="true"], [data-variant="fill"]').length,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          strip: document.querySelectorAll('[data-testid="scoring-strip"]').length,
        }));
        // eslint-disable-next-line no-console
        console.log(`LEAGUE_WAVE2_GAMECENTER ${state}-${viewport}-${theme} ${JSON.stringify(probe)}`);

        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${state}-${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

        expect(probe.cursors, 'a watching page has no cursor').toBe(0);
        expect(probe.filled, 'a watching page has no filled action').toBe(0);
        expect(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
        expect(probe.bodyScrollWidth, `body scrollWidth ${probe.bodyScrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
        expect(await countLiveChips(page)).toBe(LIVE_CHIPS[state]);
        if (viewport === 'desktop') expect(probe.strip, 'desktop draws no latest-plays strip').toBe(0);
      });
    }
  }
}

test('the live lineup note names the empty FLEX, points at free agents and its next kickoff is in Danger', async ({ page }) => {
  await openGameCenter(page, 'live', 'desktop', 'dark');
  const note = page.getByTestId('lineup-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('FLEX is empty');
  await expect(note).toContainText(/next kickoff in 4\d min/);
  await expect(note.getByRole('link', { name: 'Free agents' })).toHaveAttribute('href', `#/league/${LEAGUE_ID}/waivers`);
});

test('phone: scrolled past the hero, a compact scoreboard no taller than 56px pins and a focused row is not under it', async ({ page }) => {
  await openGameCenter(page, 'live', 'phone', 'dark');
  await expect(page.getByTestId('game-center-compact-scoreboard')).toHaveCount(0);

  const hero = page.getByTestId('matchup-hero');
  const bottom = await hero.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y + 40), bottom);
  const bar = page.getByTestId('game-center-compact-scoreboard');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(56);
  expect(box!.y).toBeLessThanOrEqual(1);

  // scroll-padding-top reserves the bar: a focused element scrolled into view lands below it.
  const reserved = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
  expect(parseInt(reserved, 10)).toBeGreaterThanOrEqual(72);
  const target = page.getByTestId('matchup-grid').getByRole('link').first();
  await page.evaluate((y) => window.scrollTo(0, y - 600), bottom);
  await target.focus();
  const top = await target.evaluate((el) => el.getBoundingClientRect().top);
  expect(top, 'the focused tile is not under the pinned bar').toBeGreaterThanOrEqual(56);
});

// The league matchups tile (sm and up) sets the name beside the figure; an unbreakable name must wrap inside its box.
for (const viewport of ['desktop', 'tablet'] as const) {
  test(`Game Center ${viewport}: a long one-word team name never runs under the tile's score`, async ({ page }) => {
    unanswered = [];
    await setupDashboard(page, 'gamedayUrgent', { theme: 'light', teamNames: { 103: 'DoDaPerpsHave@QB?WithNoSpaces', 106: 'CaShMeOuTsIdEeRiGhTnOwPlEaSe' } });
    await page.route(`**/api/league/${LEAGUE_ID}/matchups/918`, (route: Route) => json(route, 200, lineupDetail()));
    await page.setViewportSize(viewport === 'tablet' ? { width: 768, height: 900 } : VIEWPORTS.desktop);
    await page.goto(GC_URL);
    await expect(page.getByTestId('matchup-hero')).toBeVisible();
    await expect(page.getByTestId('matchup-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="matchup-grid"] [data-testid="matchup-figure"]')).map((fig) => {
      const name = (fig.parentElement!.children[1] as HTMLElement).firstElementChild as HTMLElement;
      return { name: name.textContent, scrollWidth: name.scrollWidth, clientWidth: name.clientWidth, right: name.getBoundingClientRect().right, figureLeft: fig.getBoundingClientRect().left };
    }));
    expect(rows.some((r) => r.name?.startsWith('DoDaPerpsHave@QB?WithNoSpaces')), 'the long name is on a tile').toBe(true);
    for (const r of rows) {
      expect(r.scrollWidth, `${r.name}: text wider than its box`).toBeLessThanOrEqual(r.clientWidth);
      expect(r.right, `${r.name}: name runs under the figure`).toBeLessThanOrEqual(r.figureLeft);
    }
  });
}

test('negative control: a forced overflow widens the document, so the scroll probe can fail', async ({ page }) => {
  await openGameCenter(page, 'live', 'phone', 'dark');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.cssText = 'width: 2000px; height: 1px';
    document.querySelector('[data-testid="game-center-column"]')?.appendChild(spacer);
  });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth);
  expect(wide).toBe(true);
});
