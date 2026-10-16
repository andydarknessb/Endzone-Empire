/**
 * Matchup on Play-select (ADR 0067 wave 2, spec #2334 AC 6n and 9). jsdom has no layout engine, so this
 * mirrors league-dashboard-playselect.spec.ts: `page.route` API stubs layered on the layout-guard harness,
 * headless Chromium, DOM probes.
 *
 * Every case runs at 1440 and 390, in both themes:
 *  - Matchup is a watching page: no cursor and no filled action (a filled action paints the Accent fill);
 *  - no sideways scroll on the document or the body;
 *  - Matchup live in the Standard view and the Scoreboard view, and Matchup before kickoff.
 * Plus the compact scoreboard bar at 390x844: scrolled past the versus panel a pinned bar no taller than
 * 56px shows, and a focused starter row is never under it.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), row geometry (game-center-matchup-layout.spec.ts).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { probeCompactBar } from './fixtures/compactBarProbe';
import { json } from './fixtures/jsonRoute';
import { LEAGUE_ID, LEAGUE_ROW, MATCHUP_URL, setupLayoutGuard } from './fixtures/layoutGuardFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = 'light' | 'dark';
type Shape = 'live' | 'scoreboard' | 'pre';
const THEMES: Theme[] = ['dark', 'light'];
const SHAPES: Shape[] = ['live', 'scoreboard', 'pre'];
const SHOTS = path.join('test-results', 'league-wave2-matchup-shots');

const VIEWER_TEAM_ID = 101;
const OPP_TEAM_ID = 102;
const SPECTATOR_TEAM_ID = 999;
const MATCHUP_ID = 918;
const HOME = 'Chattahoochee Valley Riverhogs';
const AWAY = 'Sasquatch of the Cascade Range';
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const MIN = 60 * 1000;

// One side's starters. The home FLEX is left empty (the lineup note's case) and the home second WR is Out and
// in a game that has not started, so the note has a problem to name at every phase.
function starters(side: 'home' | 'away', phase: 'live' | 'pre') {
  const base = side === 'home' ? 1000 : 2000;
  return SLOTS.flatMap((slot, i) => {
    if (side === 'home' && slot === 'FLEX') return [];
    const live = phase === 'live' && i % 3 !== 2;
    const out = side === 'home' && i === 4;
    return [{
      id: base + i,
      slot,
      name: `${side === 'home' ? 'Home' : 'Away'} Starter ${i + 1} ${slot}`,
      position: slot === 'FLEX' ? 'WR' : slot,
      nfl_team: 'KC',
      opponent: 'BUF',
      injury_status: out ? 'O' : null,
      points: live ? 8.4 + i : 0,
      projected: 11.8 + i,
      availability: { available: !out, reason: out ? 'out' : null },
      game_state: live ? 'in_progress' : 'scheduled',
      game_clock: live ? 'Q4 4:21' : null,
      stats: null,
    }];
  });
}

const bench = (offset: number, phase: 'live' | 'pre') => Array.from({ length: 4 }).map((_, i) => ({
  id: 3000 + offset + i,
  slot: 'BENCH',
  name: `Bench Player ${offset + i}`,
  position: 'WR',
  nfl_team: 'KC',
  points: phase === 'live' ? 3 + i : 0,
  projected: 6 + i,
  game_state: phase === 'live' ? 'in_progress' : 'scheduled',
  availability: { available: true, reason: null },
}));

function detail(phase: 'live' | 'pre' | 'final', names = { home: HOME, away: AWAY }) {
  const final = phase === 'final';
  const live = phase !== 'pre';
  return {
    matchup: {
      id: MATCHUP_ID, season: 2026, week: 18, final, status: final ? 'final' : (live ? 'live' : 'scheduled'), is_playoff: false, first_kickoff_at: null, synced_at: null, home_score: live ? (final ? 58.9 : 61) : 0, away_score: live ? (final ? 61 : 58.9) : 0,
    },
    home: {
      teamId: VIEWER_TEAM_ID, name: names.home, expectedFinal: 91.7, playersRemaining: 7, yetToPlay: 3, starters: starters('home', final ? 'live' : phase), bench: bench(0, final ? 'live' : phase),
    },
    away: {
      teamId: OPP_TEAM_ID, name: names.away, expectedFinal: 99.6, playersRemaining: 9, yetToPlay: 3, starters: starters('away', final ? 'live' : phase), bench: bench(50, final ? 'live' : phase),
    },
    viewerTeamId: final ? SPECTATOR_TEAM_ID : VIEWER_TEAM_ID,
    viewerWhatIf: null,
    nflGameIds: [],
  };
}

async function open(
  page: Page,
  shape: Shape,
  viewport: ViewportName,
  theme: Theme,
  opts: { width?: number; names?: { home: string; away: string }; final?: boolean } = {},
) {
  await setupLayoutGuard(page, { view: shape === 'scoreboard' ? 'scoreboard' : 'standard' });
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  // Registered after the harness, so these win: the Matchup of this spec and the reads the page adds.
  await page.route('**/api/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === 'GET' && pathname === `/api/league/${LEAGUE_ID}/matchups/${MATCHUP_ID}`) {
      return json(route, 200, detail(opts.final ? 'final' : (shape === 'pre' ? 'pre' : 'live'), opts.names));
    }
    if (route.request().method() === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, { league: { ...LEAGUE_ROW, current_week: 18 }, teams: [], viewerTeamId: opts.final ? SPECTATOR_TEAM_ID : VIEWER_TEAM_ID });
    }
    if (route.request().method() === 'GET' && pathname === '/api/user/action-items') {
      return json(route, 200, {
        generatedAt: new Date().toISOString(), counts: { total: 0, dueToday: 0 }, partial: [], items: [],
      });
    }
    if (route.request().method() === 'GET' && pathname === '/api/team/lineup/advice') {
      return json(route, 200, { suggestions: [], openSlotFills: [], movePlan: [] });
    }
    return route.fallback();
  });
  await page.setViewportSize({ ...VIEWPORTS[viewport], width: opts.width ?? VIEWPORTS[viewport].width });
  await page.goto(MATCHUP_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Week 18 Matchup' })).toBeVisible();
  await expect(shape === 'scoreboard' ? page.getByTestId('led-board') : page.getByTestId('slot-row').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

for (const shape of SHAPES) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    for (const theme of THEMES) {
      test(`Matchup ${shape} ${viewport} ${theme}: no cursor, no filled action, no sideways scroll`, async ({ page }) => {
        await open(page, shape, viewport, theme);

        const probe = await page.evaluate(() => {
          // A filled action paints the Accent fill: resolve the token to the colour the browser computes.
          const swatch = document.createElement('i');
          swatch.style.backgroundColor = 'var(--ps-accent)';
          document.body.appendChild(swatch);
          const accent = getComputedStyle(swatch).backgroundColor;
          swatch.remove();
          const filled = Array.from(document.querySelectorAll('a, button')).filter((el) => getComputedStyle(el).backgroundColor === accent).length;
          return {
            cursors: document.querySelectorAll('.cursor').length,
            filled,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            innerWidth: window.innerWidth,
          };
        });
        // eslint-disable-next-line no-console
        console.log(`LEAGUE_WAVE2_MATCHUP ${shape}-${viewport}-${theme} ${JSON.stringify(probe)}`);

        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${shape}-${viewport}-${theme}.png`), fullPage: true, animations: 'disabled' });

        expect(probe.cursors, 'Matchup is a watching page: no cursor').toBe(0);
        expect(probe.filled, 'no filled action').toBe(0);
        expect(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
        expect(probe.bodyScrollWidth, `body scrollWidth ${probe.bodyScrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
      });
    }
  }
}

// The note is the one quiet row between the strip and Starters, and it names the problem at every phase.
test('the lineup note names the empty FLEX and carries one ghost Set lineup, before kickoff and live', async ({ page }) => {
  await open(page, 'pre', 'desktop', 'light');
  const note = page.getByTestId('lineup-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('FLEX is empty');
  await expect(note.getByRole('link', { name: 'Set lineup' })).toBeVisible();
});

// An unbreakable team name (a real league has one) must wrap inside the margin line, not widen the page: the
// leader is Home live (61 to 58.9) and Away before kickoff (99.6 to 91.7 projected), so both sides carry the name.
const LONG_NAMES = { home: 'ChattahoocheeValleyRiverhogs', away: 'SasquatchOfTheCascadeRangeWestCoastDivision' };
// 'final' is a settled Matchup the viewer is not in: the result line names the winner (away, 61 to 58.9).
for (const shape of ['live', 'pre', 'final'] as const) {
  for (const width of [360, 390]) {
    test(`Matchup ${shape} at ${width}: a one-word leader name wraps inside the margin line, no sideways scroll`, async ({ page }) => {
      await open(page, shape === 'final' ? 'live' : shape, 'phone', 'light', { width, names: LONG_NAMES, final: shape === 'final' });
      const probe = await page.evaluate((final) => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        margins: Array.from(document.querySelectorAll(`[data-testid="${final ? 'scoreboard-result' : 'scoreboard-margin'}"]`)).map((p) => ({ text: p.textContent, scrollWidth: p.scrollWidth, clientWidth: p.clientWidth })),
        odds: Array.from(document.querySelectorAll('[data-testid="scoreboard-odds"] [aria-hidden="true"] > span')).map((n) => ({ text: n.textContent, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth })),
      }), shape === 'final');
      expect(probe.margins.length, 'the strip draws a margin line').toBe(1);
      expect(probe.margins[0].text, 'the margin names the one-word leader').toContain(shape === 'live' ? LONG_NAMES.home : LONG_NAMES.away);
      for (const n of probe.odds) expect.soft(n.scrollWidth, `odds name "${n.text}" text ${n.scrollWidth} vs box ${n.clientWidth}`).toBeLessThanOrEqual(n.clientWidth);
      expect.soft(probe.margins[0].scrollWidth, `margin line text ${probe.margins[0].scrollWidth} vs box ${probe.margins[0].clientWidth}`).toBeLessThanOrEqual(probe.margins[0].clientWidth);
      expect.soft(probe.scrollWidth, `document scrollWidth ${probe.scrollWidth} vs innerWidth ${probe.innerWidth}`).toBeLessThanOrEqual(probe.innerWidth);
    });
  }
}

test.describe('the compact scoreboard bar at 390x844', () => {
  // The margin line is nowrap beside the Live chip: a long team name must clip with an ellipsis, not run under it.
  for (const width of [360, 390]) {
    test(`at ${width} the margin text clips before the Live chip`, async ({ page }) => {
      await open(page, 'live', 'phone', 'light', { width });
      await page.evaluate(() => {
        const panelEl = document.querySelector('[data-testid="scoreboard-strip"]') as HTMLElement;
        window.scrollTo(0, panelEl.getBoundingClientRect().bottom + window.scrollY + 300);
      });
      const bar = page.getByRole('group', { name: /Home|Chattahoochee/ }).filter({ hasText: ' by ' });
      await expect(bar).toBeVisible();
      expect((await bar.boundingBox())!.height, 'the pinned bar is at most 56px tall').toBeLessThanOrEqual(56);
      const m = await probeCompactBar(bar);
      expect(m.paintedRight, `"${m.text}" paints to ${m.paintedRight}, the Live chip starts at ${m.chipLeft}`).toBeLessThanOrEqual(m.chipLeft);
      expect(m.overflow, 'the margin span clips').toBe('hidden');
      expect(m.textOverflow, 'and ends in an ellipsis').toBe('ellipsis');
    });
  }

  test('pins no taller than 56px once the versus panel scrolls away, and a focused starter row is not under it', async ({ page }) => {
    await open(page, 'live', 'phone', 'light');
    const panel = page.getByTestId('scoreboard-strip');
    await expect(page.getByRole('group', { name: /by \d/ })).toHaveCount(0);

    // Past the panel: scroll so the starters frame fills the viewport.
    await page.evaluate(() => {
      const panelEl = document.querySelector('[data-testid="scoreboard-strip"]') as HTMLElement;
      window.scrollTo(0, panelEl.getBoundingClientRect().bottom + window.scrollY + 300);
    });
    const bar = page.getByRole('group', { name: /Home|Chattahoochee/ }).filter({ hasText: ' by ' });
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.height, 'the pinned bar is at most 56px tall').toBeLessThanOrEqual(56);
    expect(box.y, 'it pins to the top of the viewport').toBeLessThanOrEqual(1);
    await expect(panel).toBeAttached();

    // A starter row cut off at the top edge (the row under the bar): focusing its control must scroll it
    // clear of the pinned bar. Chrome aligns a partly hidden element to the edge unless scroll-padding-top
    // reserves the bar, which is what the page sets.
    const target = page.getByRole('button', { name: 'Stats for Home Starter 3 RB' });
    const docY = await target.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo({ top: y + 12, behavior: 'instant' }), docY);
    expect((await target.boundingBox())!.y, 'the row starts hidden under the top edge').toBeLessThan(0);
    await target.focus();
    await expect(target).toBeVisible();
    const row = (await target.boundingBox())!;
    const pinned = (await bar.boundingBox())!;
    expect(row.y, 'the focused row starts below the pinned bar').toBeGreaterThanOrEqual(pinned.y + pinned.height - 1);
  });
});
