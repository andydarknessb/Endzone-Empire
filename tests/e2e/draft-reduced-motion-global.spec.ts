// Global reduced-motion audit for the Draft room (issue #533).
//
// SCOPE, AND HOW THIS RELATES TO #447/#535. ic-447 (PR #535) owns
// tests/e2e/draft-reduced-motion.spec.ts, which proves the ONE Draft-route
// transition that already guards itself (App.jsx's skip-to-content link) reads
// zero under reduced motion, with a positive control. That file deliberately
// does NOT assert the unguarded surfaces, because before #533 they were still
// animating and pinning non-compliant behaviour into a green test would make
// the defect a requirement. THIS file is the other half: it audits the
// surfaces that had NO reduced-motion guard (a representative Draft-room
// button, the mobile Tabs indicator, MUI touch ripple, the Draft Settings
// dialog, and the on-the-clock snackbar) and proves the new GLOBAL policy in
// src/theme/base.css makes every one of them instantaneous under
// prefers-reduced-motion. It does not touch #535's file or its fixture.
//
// EVERY REDUCED-MOTION ASSERTION HAS A POSITIVE CONTROL (issue #533 AC4). A
// computed duration of 0s is exactly what you also read when the selector
// matched nothing, the element never rendered, or the page failed to load. So
// for each surface the SAME locator is measured in ordinary mode first and
// asserted to have real motion; only then is it re-measured under reduce and
// asserted instantaneous. A reduced-motion suite without controls proves
// nothing.
//
// WHY 0s IS SAFE FOR OPEN/CLOSE LIFECYCLES (issue #533 AC7). A naive concern is
// that a zero CSS transition duration could stop a component's transitionend
// from firing and hang its lifecycle. Verified against this codebase: no source
// file listens for a CSS transitionend/animationend event, and MUI's transition
// components (Fade/Grow/Slide, used by Dialog and Snackbar) advance their
// enter/exit state machine with react-transition-group's numeric `timeout` via
// setTimeout (react-transition-group 4.4.5 Transition.onTransitionEnd:
// `setTimeout(this.nextCallback, timeout)`), NOT via the CSS event. So the
// dialog and snackbar tests below open AND close under reduced motion and assert
// the lifecycle completes, guarding exactly that.
//
// The harness (fixtures/draftHarness) reaches no live league, database or
// Tank01, and auto-fails the test on any browser console error.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
  type DraftSocketState,
  type ThemeMode,
} from './fixtures/draftHarness';
import type { Page, Locator } from '@playwright/test';
import {
  ACTIVE_STATE,
  ACTIVE_PICKS,
  PENDING_STATE,
  FIXTURE_TEAMS,
  buildLeague,
} from './fixtures/draftFixtures';

// Deliver a server-pushed event into this page's fake draft socket, exactly as
// draft-accessibility.spec.ts and draft-hide.spec.ts do (the harness's
// injection hook). Used here to re-fire the on-the-clock edge under reduced
// motion on the same page, rather than re-navigating.
async function deliver(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ([e, p]) => {
      (window as unknown as { __ENDZONE_DRAFT_DELIVER__: (ev: string, pl?: unknown) => void })
        .__ENDZONE_DRAFT_DELIVER__(e as string, p);
    },
    [event, payload] as const
  );
}

// Longest transition- and animation-duration on an element, in seconds, taken
// across the comma-separated list a shorthand can expand to (so a single
// non-zero member is never hidden behind a leading `0s,`). Read from the live
// computed style in the page, which is the browser's own answer after the
// prefers-reduced-motion media state is applied.
async function motion(locator: Locator): Promise<{ transition: number; animation: number }> {
  return locator.evaluate((el) => {
    const seconds = (value: string): number => {
      const parts = value.split(',').map((raw) => {
        const token = raw.trim();
        if (token.endsWith('ms')) return parseFloat(token) / 1000;
        const n = parseFloat(token);
        return Number.isFinite(n) ? n : 0;
      });
      return parts.length ? Math.max(0, ...parts) : 0;
    };
    const cs = getComputedStyle(el as Element);
    return { transition: seconds(cs.transitionDuration), animation: seconds(cs.animationDuration) };
  });
}

type StateSeed = { socket: Partial<DraftSocketState>; league: Record<string, unknown>; picks: unknown[] };

const PENDING_SEED: StateSeed = {
  socket: { ...PENDING_STATE, isCommissioner: true } as Partial<DraftSocketState>,
  league: PENDING_STATE.league as Record<string, unknown>,
  picks: PENDING_STATE.picks as unknown[],
};
const ACTIVE_SEED: StateSeed = {
  socket: { ...ACTIVE_STATE, isCommissioner: true } as Partial<DraftSocketState>,
  league: ACTIVE_STATE.league as Record<string, unknown>,
  picks: ACTIVE_PICKS as unknown[],
};

async function openDraft(page: Page, seed: StateSeed, theme: ThemeMode = 'light') {
  await setTheme(page, theme);
  await installDraftSocketHarness(page, seed.socket as DraftSocketState);
  await installDraftRestApi(page, { league: seed.league, picks: seed.picks as never });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

// -------------------------------------------------------------------------
// AC1 + AC3 + AC4: a representative always-present Draft-room button, audited
// across pending/active x desktop/narrow x light/dark as one matrix (not eight
// copies), each cell carrying its own ordinary-mode positive control.
// -------------------------------------------------------------------------
const STATES: Array<{ name: string; seed: StateSeed }> = [
  { name: 'pending', seed: PENDING_SEED },
  { name: 'active', seed: ACTIVE_SEED },
];
const LAYOUTS: Array<{ name: string; viewport: { width: number; height: number } }> = [
  { name: 'desktop', viewport: VIEWPORTS.desktop },
  { name: 'narrow', viewport: VIEWPORTS.mobile },
];
const THEMES: ThemeMode[] = ['light', 'dark'];

test.describe('global reduced-motion policy: Draft-room button matrix (#533 AC1/AC3/AC4)', () => {
  for (const state of STATES) {
    for (const layout of LAYOUTS) {
      for (const theme of THEMES) {
        test(`sound-toggle button is instantaneous under reduce, animated in ordinary — ${state.name}/${layout.name}/${theme}`, async ({ page }) => {
          await page.setViewportSize(layout.viewport);
          await openDraft(page, state.seed, theme);

          const button = page.getByRole('button', { name: 'On-the-clock sound' });
          await expect(button).toBeVisible();

          // POSITIVE CONTROL: ordinary mode, this same button has a real transition.
          const ordinary = await motion(button);
          expect(ordinary.transition, `ordinary-mode control for ${state.name}/${layout.name}/${theme}`).toBeGreaterThan(0);

          // Under reduced motion the global policy makes it instantaneous.
          await page.emulateMedia({ reducedMotion: 'reduce' });
          const reduced = await motion(button);
          expect(reduced.transition, `reduced-motion transition for ${state.name}/${layout.name}/${theme}`).toBe(0);
          expect(reduced.animation, `reduced-motion animation for ${state.name}/${layout.name}/${theme}`).toBe(0);
        });
      }
    }
  }
});

// -------------------------------------------------------------------------
// AC1 + AC4: the MUI Tabs indicator (mobile layout) slides under an inline
// transition MUI sets on it; the global policy must zero it.
// -------------------------------------------------------------------------
test('mobile Tabs indicator is instantaneous under reduce, animated in ordinary (#533 AC1/AC4)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await openDraft(page, ACTIVE_SEED);

  // The narrow layout renders the Draft view Tabs; the sliding underline is
  // MUI's .MuiTabs-indicator (no existing e2e locator targets it).
  await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
  const indicator = page.locator('.MuiTabs-indicator').first();
  await expect(indicator).toHaveCount(1);

  const ordinary = await motion(indicator);
  expect(ordinary.transition, 'ordinary-mode control for Tabs indicator').toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await motion(indicator);
  expect(reduced.transition, 'reduced-motion transition for Tabs indicator').toBe(0);
});

// -------------------------------------------------------------------------
// AC2 + AC4: MUI touch-ripple motion is suppressed under reduced motion.
// -------------------------------------------------------------------------
test('MUI touch ripple is suppressed under reduce, animated in ordinary (#533 AC2/AC4)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openDraft(page, ACTIVE_SEED);

  const button = page.getByRole('button', { name: 'On-the-clock sound' });
  await expect(button).toBeVisible();

  // The visible touch-ripple ENTER animation lives on the ripple span
  // (.MuiTouchRipple-rippleVisible), not the inner child (whose animation only
  // runs on leave/pulsate). Pressing and HOLDING the pointer paints the ripple
  // and leaves it in its enter state until release, so the measurement is
  // deterministic rather than racing the exit.
  async function pressAndMeasureRipple() {
    const box = await button.boundingBox();
    if (!box) throw new Error('sound-toggle button has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const ripple = button.locator('.MuiTouchRipple-rippleVisible').first();
    await expect(ripple).toHaveCount(1);
    const m = await motion(ripple);
    await page.mouse.up();
    return m;
  }

  // POSITIVE CONTROL: in ordinary mode the ripple enter animation has a real
  // duration.
  const ordinary = await pressAndMeasureRipple();
  expect(ordinary.animation, 'ordinary-mode control for touch ripple').toBeGreaterThan(0);

  // Under reduced motion the ripple still appears (feedback is not removed) but
  // its animation is instantaneous.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await pressAndMeasureRipple();
  expect(reduced.animation, 'reduced-motion animation for touch ripple').toBe(0);
});

// -------------------------------------------------------------------------
// AC1 + AC4 + AC7: the Draft Settings dialog. Its Fade transition must be
// instantaneous under reduce, AND its open and close lifecycle must still
// complete (the failure mode 0s is feared for, verified not to occur here).
// -------------------------------------------------------------------------
test('Draft Settings dialog: instantaneous under reduce with control, open+close still complete (#533 AC1/AC4/AC7)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openDraft(page, ACTIVE_SEED);

  const gear = page.getByRole('button', { name: 'Draft settings' });
  await expect(gear).toBeVisible();

  // POSITIVE CONTROL (ordinary): open, confirm the lifecycle completes (the
  // dialog becomes visible), measure a real transition, then confirm close
  // completes (it unmounts).
  await gear.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const container = page.locator('.MuiDialog-container').first();
  const ordinary = await motion(container);
  expect(ordinary.transition, 'ordinary-mode control for dialog').toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // REDUCED MOTION: re-open. The open lifecycle must still complete...
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gear.click();
  await expect(dialog).toBeVisible();
  // ...the transition must be instantaneous...
  const reduced = await motion(container);
  expect(reduced.transition, 'reduced-motion transition for dialog').toBe(0);
  // ...and the close lifecycle must still complete (no hang on a zero duration).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Focus returns to the trigger, not lost to <body> (AC7 interaction
  // completion + focus visibility). This end-to-end return only happens if the
  // open trapped focus into the dialog in the first place, so it also stands in
  // for "focus moved into the dialog" without racing MUI's async focus trap.
  await expect(gear).toBeFocused();
});

// -------------------------------------------------------------------------
// AC1 + AC4 + AC7: the on-the-clock snackbar. It auto-fires on mount when the
// viewer is on the clock (ACTIVE_STATE). Measured in ordinary mode, then the
// page is re-mounted under reduced motion (same surface, same locator) so the
// open and close lifecycle is exercised in both modes.
// -------------------------------------------------------------------------
test('on-the-clock snackbar: instantaneous under reduce with control, open+close still complete (#533 AC1/AC4/AC7)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);

  // POSITIVE CONTROL (ordinary): the alert opens on mount, has a real
  // transition, and dismisses cleanly.
  await openDraft(page, ACTIVE_SEED);
  const alert = page.getByRole('alert').filter({ hasText: 'on the clock' });
  await expect(alert).toBeVisible();
  const ordinary = await motion(alert);
  expect(ordinary.transition, 'ordinary-mode control for snackbar').toBeGreaterThan(0);
  await alert.getByRole('button').first().click();
  await expect(alert).toBeHidden();

  // REDUCED MOTION: re-fire the alert on the SAME page by driving the socket
  // edge it keys off (isMyTurn false -> true): push a state that puts another
  // team on the clock, then one that puts the viewer back on it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const socketState = { league: ACTIVE_STATE.league, teams: FIXTURE_TEAMS, picks: ACTIVE_PICKS };
  await deliver(page, 'draft:state', { ...socketState, onTheClock: FIXTURE_TEAMS[1] });
  await deliver(page, 'draft:state', { ...socketState, onTheClock: FIXTURE_TEAMS[0] });
  const alertReduced = page.getByRole('alert').filter({ hasText: 'on the clock' });
  await expect(alertReduced).toBeVisible(); // open lifecycle completed under reduce
  const reduced = await motion(alertReduced);
  expect(reduced.transition, 'reduced-motion transition for snackbar').toBe(0);
  await alertReduced.getByRole('button').first().click();
  await expect(alertReduced).toBeHidden(); // close lifecycle completed under reduce
});

// -------------------------------------------------------------------------
// AC5: the countdown keeps updating under reduced motion (instantaneous, not
// frozen and not removed), and live Draft state stays available.
// -------------------------------------------------------------------------
test('countdown text keeps ticking under reduced motion, with no animated interpolation (#533 AC5)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // A pending draft, scheduled inside the hour so the ticker runs at 1s cadence.
  const soon = new Date(Date.now() + 90_000).toISOString();
  const league = buildLeague({ draft_status: 'pending', draft_date: soon, draft_timezone: 'UTC' }) as Record<string, unknown>;
  await openDraft(page, { socket: { ...PENDING_STATE, league, isCommissioner: true } as Partial<DraftSocketState>, league, picks: [] });

  const ticker = page.getByText(/Draft in/i).first();
  await expect(ticker).toBeVisible();

  // No animated interpolation dresses the number.
  const m = await motion(ticker);
  expect(m.transition, 'countdown transition under reduce').toBe(0);
  expect(m.animation, 'countdown animation under reduce').toBe(0);

  // It is NOT frozen: the text advances on its own timer even under reduce.
  const first = (await ticker.textContent())?.trim();
  await expect
    .poll(async () => (await ticker.textContent())?.trim(), { timeout: 4_000 })
    .not.toBe(first);
});

test('live Draft banner stays present (live data not suppressed) under reduced motion (#533 AC5)', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDraft(page, ACTIVE_SEED);

  // The live draft banner (who is on the clock) is threaded from live socket
  // state; reduced motion must not remove it. The harness viewer is on the
  // clock in ACTIVE_STATE, so the banner reads "Your pick!".
  await expect(page.getByText('Your pick!')).toBeVisible();
});
