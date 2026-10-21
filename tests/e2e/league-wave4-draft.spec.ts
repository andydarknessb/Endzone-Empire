/**
 * Draft room on Play-select (ADR 0067 wave 4, spec #2432). jsdom has no layout engine, so this is the
 * page-wide guard: the controlled Draft harness (fixtures/draftHarness.ts), headless Chromium, DOM probes.
 *
 * Every case runs at 1440, 1024 and 390 wide, in both themes. At 390 the room is tabs, so the probes run on
 * each tab and add up what is visible there. Every case asserts:
 *  - the counts of `.cursor` and of `[data-variant="fill"]` outside an open dialog;
 *  - no sideways scroll on the document;
 *  - every button in the rail and the banner is at least 44px tall, every button in the pool at least 36px;
 *  - no `role="status"` or `role="alert"` element contains a button.
 *
 * Not covered here: colours (src/theme/tokens.contrast.test.js), the regions' content (their own specs).
 */
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  type ThemeMode,
  type DraftSocketState,
} from './fixtures/draftHarness';
import type { Page } from '@playwright/test';
import {
  ACTIVE_STATE,
  ACTIVE_PICKS,
  ACTIVE_NOT_MY_TURN_STATE,
  COMPLETE_STATE,
  COMPLETE_PICKS,
  PENDING_STATE,
  FIXTURE_PLAYERS,
} from './fixtures/draftFixtures';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
const THEMES: ThemeMode[] = ['dark', 'light'];

// Amon-Ra St. Brown (id 7) is the first queued player; Josh Allen (id 6) is already off the board.
const QUEUED = FIXTURE_PLAYERS.filter((p) => p.id === 7);

type Moment = {
  name: string;
  state: DraftSocketState;
  picks: typeof ACTIVE_PICKS;
  queue: typeof QUEUED;
  cursor: number;
  filled: number;
  /** The one filled action sits on the first queued player's row. */
  filledOnQueuedRow?: boolean;
  /** The accessible text of the one filled action, when the table names it. */
  filledLabel?: string;
  /** Surfaces this moment shows, so a renamed selector turns the case red instead of measuring nothing. */
  shows: { banner: boolean; pool: boolean; railButtons: boolean; poolButtons: boolean };
};

// The filled-action table from the issue (docs/design/league/RULINGS.md, "Wave 4 build").
// The rail and the Draft controls group are in every moment; the banner only while the draft is active, the pool
// until it is complete, and the rail holds no button once it is.
const ROOM = { banner: true, pool: true, railButtons: true, poolButtons: true };
const MOMENTS: Moment[] = [
  { name: 'on the clock, with a queue', state: ACTIVE_STATE, picks: ACTIVE_PICKS, queue: QUEUED, cursor: 1, filled: 1, filledOnQueuedRow: true, shows: ROOM },
  { name: 'on the clock, empty queue', state: ACTIVE_STATE, picks: ACTIVE_PICKS, queue: [], cursor: 1, filled: 1, shows: ROOM },
  { name: 'drafting, not on the clock', state: ACTIVE_NOT_MY_TURN_STATE, picks: ACTIVE_PICKS, queue: [], cursor: 0, filled: 0, shows: ROOM },
  { name: 'before the draft, viewer not ready', state: PENDING_STATE, picks: [], queue: [], cursor: 0, filled: 1, filledLabel: "I'm ready", shows: { ...ROOM, banner: false } },
  { name: 'draft complete', state: COMPLETE_STATE, picks: COMPLETE_PICKS, queue: [], cursor: 0, filled: 0, shows: { banner: false, pool: false, railButtons: false, poolButtons: false } },
];

async function open(page: Page, viewport: ViewportName, theme: ThemeMode, m: Moment) {
  await setTheme(page, theme);
  await page.setViewportSize(VIEWPORTS[viewport]);
  await installDraftSocketHarness(page, m.state);
  await installDraftRestApi(page, { league: m.state.league, picks: m.picks, initialQueue: m.queue });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

type Surface = { found: boolean; measured: number; short: string[] };
type Probe = {
  cursors: number;
  filled: number;
  filledLabels: string[];
  filledOnQueuedRow: boolean;
  scrollWidth: number;
  innerWidth: number;
  rail: Surface;
  banner: Surface;
  controls: Surface;
  pool: Surface;
  buttonInLiveRegion: string[];
};

// One pass over what is visible now. Runs in the page; nothing here reads the harness.
function probe(queuedName: string): Probe {
  const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && el.getClientRects().length > 0;
  const outsideDialog = (el: Element) => !el.closest('[role="dialog"]');
  const live = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((e) => visible(e) && outsideDialog(e));
  const label = (b: Element) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40);
  // Measures every visible button under the roots. `measured` counts them, so a surface whose selector matched
  // nothing (or whose buttons all went missing) is told apart from one that passed.
  const surface = (roots: Array<Element | null | undefined>, min: number): Surface => {
    const found = roots.filter((r): r is Element => !!r && visible(r));
    const buttons = found.flatMap((r) => Array.from(r.querySelectorAll('button, [role="button"], a[data-variant]')).filter(visible));
    const short = buttons.filter((b) => b.getBoundingClientRect().height < min - 0.5).map((b) => `${label(b)} ${Math.round(b.getBoundingClientRect().height)}px`);
    return { found: found.length > 0, measured: buttons.length, short };
  };

  const fills = live('[data-variant="fill"]');
  const poolRoots = [document.querySelector('[data-testid="players-scroll-region"]'), document.querySelector('[role="list"][aria-label="Available players"]')];
  const inPool = (el: Element) => poolRoots.some((r) => r?.contains(el));
  const queuedRow = (el: Element) => (el.closest('tr, [role="listitem"]') as HTMLElement | null)?.textContent?.includes(queuedName) === true;
  // The banner is the on-the-clock readout's parent; it holds no button of its own, so it is found, not measured.
  const bannerRoot = Array.from(document.querySelectorAll('[role="status"]')).find((r) => /clock|your pick/i.test(r.textContent || ''))?.parentElement;

  return {
    cursors: live('.cursor').length,
    filled: fills.length,
    filledLabels: fills.map(label),
    filledOnQueuedRow: fills.length === 1 && inPool(fills[0]) && queuedRow(fills[0]),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    // Wide, the rail is its own named section; in tabs it is the panel of the Draft tab.
    rail: surface([document.querySelector('[aria-label="Draft rail"]'), ...Array.from(document.querySelectorAll('[role="tabpanel"]')).filter((p) => document.getElementById(p.getAttribute('aria-labelledby') || '')?.textContent?.trim() === 'Draft')], 44),
    banner: surface([bannerRoot], 44),
    controls: surface(Array.from(document.querySelectorAll('[role="group"][aria-label="Draft controls"]')), 44),
    pool: surface(poolRoots, 36),
    buttonInLiveRegion: Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
      .filter((r) => r.querySelector('button, [role="button"], a[data-variant]'))
      .map((r) => `${r.getAttribute('role')}: ${(r.textContent || '').trim().slice(0, 40)}`),
  };
}

// At 390 the room is tabs: add up what each tab shows. Wider, the whole room is one screen.
async function probeRoom(page: Page): Promise<Probe[]> {
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  if (count === 0) return [await page.evaluate(probe, QUEUED[0].name)];
  const out: Probe[] = [];
  for (let i = 0; i < count; i += 1) {
    await tabs.nth(i).click();
    out.push(await page.evaluate(probe, QUEUED[0].name));
  }
  return out;
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    for (const m of MOMENTS) {
      test(`Draft room ${viewport} ${theme}: ${m.name}`, async ({ page }) => {
        await open(page, viewport, theme, m);
        const probes = await probeRoom(page);
        const sum = (f: (p: Probe) => number) => probes.reduce((n, p) => n + f(p), 0);
        const any = (f: (p: Probe) => boolean) => probes.some(f);

        expect(sum((p) => p.cursors), 'cursor count').toBe(m.cursor);
        expect(sum((p) => p.filled), 'filled action count').toBe(m.filled);
        if (m.filledOnQueuedRow) {
          expect(any((p) => p.filledOnQueuedRow), 'the filled Draft is on the first queued player in the pool').toBe(true);
        }
        if (m.filledLabel) {
          expect(probes.flatMap((p) => p.filledLabels), 'the one filled action').toEqual([m.filledLabel]);
        }

        // A size check that measured nothing proves nothing: every surface the moment shows must be found, and
        // the ones that hold buttons must have measured at least one.
        expect(any((p) => p.rail.found), 'the Draft rail is found').toBe(true);
        expect(any((p) => p.banner.found), 'the on-the-clock banner is found').toBe(m.shows.banner);
        expect(any((p) => p.controls.found), 'the Draft controls group is found').toBe(true);
        expect(sum((p) => p.controls.measured), 'Draft controls buttons measured').toBeGreaterThan(0);
        expect(any((p) => p.pool.found), 'the player pool is found').toBe(m.shows.pool);
        if (m.shows.railButtons) expect(sum((p) => p.rail.measured), 'rail buttons measured').toBeGreaterThan(0);
        if (m.shows.poolButtons) expect(sum((p) => p.pool.measured), 'pool buttons measured').toBeGreaterThan(0);

        for (const p of probes) {
          expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
          expect([...p.rail.short, ...p.banner.short, ...p.controls.short], 'rail, banner and status-bar buttons are at least 44px tall').toEqual([]);
          expect(p.pool.short, 'pool buttons are at least 36px tall').toEqual([]);
          expect(p.buttonInLiveRegion, 'no live region contains a button').toEqual([]);
        }
      });
    }
  }
}
