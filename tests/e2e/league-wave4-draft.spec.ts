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
};

// The filled-action table from the issue (docs/design/league/RULINGS.md, "Wave 4 build").
const MOMENTS: Moment[] = [
  { name: 'on the clock, with a queue', state: ACTIVE_STATE, picks: ACTIVE_PICKS, queue: QUEUED, cursor: 1, filled: 1 },
  { name: 'on the clock, empty queue', state: ACTIVE_STATE, picks: ACTIVE_PICKS, queue: [], cursor: 1, filled: 1 },
  { name: 'drafting, not on the clock', state: ACTIVE_NOT_MY_TURN_STATE, picks: ACTIVE_PICKS, queue: [], cursor: 0, filled: 0 },
  { name: 'before the draft, viewer not ready', state: PENDING_STATE, picks: [], queue: [], cursor: 0, filled: 1 },
  { name: 'draft complete', state: COMPLETE_STATE, picks: COMPLETE_PICKS, queue: [], cursor: 0, filled: 0 },
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

type Probe = {
  cursors: number;
  filled: number;
  filledOnQueuedRow: boolean;
  scrollWidth: number;
  innerWidth: number;
  shortRail: string[];
  shortPool: string[];
  buttonInLiveRegion: string[];
};

// One pass over what is visible now. Runs in the page; nothing here reads the harness.
function probe(): Probe {
  const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && el.getClientRects().length > 0;
  const outsideDialog = (el: Element) => !el.closest('[role="dialog"]');
  const live = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((e) => visible(e) && outsideDialog(e));
  const label = (b: Element) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40);
  const tall = (root: Element | null | undefined, min: number) =>
    root
      ? Array.from(root.querySelectorAll('button, [role="button"], a[data-variant]'))
          .filter(visible)
          .filter((b) => b.getBoundingClientRect().height < min - 0.5)
          .map((b) => `${label(b)} ${Math.round(b.getBoundingClientRect().height)}px`)
      : [];

  const fills = live('[data-variant="fill"]');
  const rail = document.querySelector('[aria-label="Draft rail"]');
  // The banner: the on-the-clock readout's parent, plus the status bar's two groups (sound toggle, assistant toggle,
  // Randomize), which are the buttons that sit with it.
  const banner = Array.from(document.querySelectorAll('[role="status"]')).find((r) => /clock/i.test(r.textContent || ''))?.parentElement;
  const statusBar = document.querySelectorAll('[role="group"][aria-label="Draft controls"]');
  const pools = [document.querySelector('[data-testid="players-scroll-region"]'), document.querySelector('[role="list"][aria-label="Available players"]')];
  const queuedRow = (el: Element) => /Amon-Ra/.test((el.closest('tr, [role="listitem"]') as HTMLElement | null)?.textContent || '');

  return {
    cursors: live('.cursor').length,
    filled: fills.length,
    filledOnQueuedRow: fills.length === 1 && queuedRow(fills[0]),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    shortRail: [...tall(rail, 44), ...tall(banner, 44), ...Array.from(statusBar).flatMap((g) => tall(g, 44))],
    shortPool: pools.flatMap((p) => tall(p, 36)),
    buttonInLiveRegion: Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
      .filter((r) => r.querySelector('button, [role="button"], a[data-variant]'))
      .map((r) => `${r.getAttribute('role')}: ${(r.textContent || '').trim().slice(0, 40)}`),
  };
}

// At 390 the room is tabs: add up what each tab shows. Wider, the whole room is one screen.
async function probeRoom(page: Page): Promise<Probe[]> {
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  if (count === 0) return [await page.evaluate(probe)];
  const out: Probe[] = [];
  for (let i = 0; i < count; i += 1) {
    await tabs.nth(i).click();
    out.push(await page.evaluate(probe));
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

        expect(sum((p) => p.cursors), 'cursor count').toBe(m.cursor);
        expect(sum((p) => p.filled), 'filled action count').toBe(m.filled);
        if (m.name === 'on the clock, with a queue') {
          expect(probes.some((p) => p.filledOnQueuedRow), 'the filled Draft is on the first queued player').toBe(true);
        }
        for (const p of probes) {
          expect(p.scrollWidth, `document scrollWidth ${p.scrollWidth} vs innerWidth ${p.innerWidth}`).toBeLessThanOrEqual(p.innerWidth);
          expect(p.shortRail, 'rail and banner buttons are at least 44px tall').toEqual([]);
          expect(p.shortPool, 'pool buttons are at least 36px tall').toEqual([]);
          expect(p.buttonInLiveRegion, 'no live region contains a button').toEqual([]);
        }
      });
    }
  }
}
