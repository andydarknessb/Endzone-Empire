// Reduced-motion browser evidence (issue #447 AC4 - PARTIAL; the global gap is
// filed as #533).
//
// AC4 as written asks that under emulateMedia({ reducedMotion: 'reduce' }) "no
// Draft-room element animates". That is NOT satisfiable as written: the app has
// no global prefers-reduced-motion rule and no MUI transitions override, so
// reduced motion is honoured PER COMPONENT. Inside the Draft room the guarded
// sites are App.jsx's skip-to-content link (transition), DraftBoardMatrix.jsx
// (the pick-landed flash and the on-the-clock pulse animations), RosterPanel.jsx
// (a background-color transition) and GifMessage/TeamAvatar via
// lib/reducedMotionMedia; everything else (MUI ripple, the mobile Tabs
// indicator, Dialog/Snackbar transitions, Countdown) still animates. That gap is
// FILED as a defect, not fixed here (this ticket proves what shipped).
//
// So this spec proves the guarded path honestly rather than overclaiming: the
// one always-present guarded Draft-route transition (the skip link) reads a
// zero duration under reduced motion. Its POSITIVE CONTROL is the same
// measurement WITHOUT emulateMedia, which must read NON-zero - otherwise
// "duration is 0s" is indistinguishable from "the selector matched nothing",
// the same failure as an absence assertion with no control. It does NOT assert
// the unguarded surfaces: measuring non-compliant behaviour into a green test
// would pin the defect as a requirement.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
} from './fixtures/draftHarness';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

test.describe('reduced motion, guarded Draft-route transition (#447 AC4, partial)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('the skip-to-content transition reads zero under reduced motion, and non-zero without it (positive control)', async ({ page }) => {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, ACTIVE_STATE);
    await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    // The skip link is rendered on every Draft route (App.jsx, isDraftRoute) and
    // is one of the few Draft-room elements that guards its own transition.
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toHaveCount(1);

    // POSITIVE CONTROL: with no emulation the transition is real. If this read
    // 0s too, the reduced-motion assertion below would be measuring nothing.
    const durationDefault = await skipLink.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(durationDefault).not.toBe('0s');

    // Under reduced motion, the App.jsx '@media (prefers-reduced-motion: reduce)'
    // guard turns the transition off.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const durationReduced = await skipLink.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(durationReduced).toBe('0s');
  });
});
