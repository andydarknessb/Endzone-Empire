// Real-browser acceptance for issue #532: a null-relatedTarget CLICK-AWAY must
// not leave a stale focus hold that a later Draft-room layout flip rescues,
// while a genuine tear-down flip must still rescue. Driven against the real room
// through the shared harness (this file only IMPORTS draftHarness, it does not
// change it - the e2e specs and the harness are owned elsewhere). The harness
// auto-fails on any browser console or page error.
//
// Chromium only, like the rest of tests/e2e (CI installs chromium; the config
// declares no other project). The WebKit half of #532's AC6 - that activating
// the Players tab focuses the tab and a later flip does not move focus into Chat
// - was verified locally in Playwright WebKit and is recorded in the PR body; it
// is deliberately NOT a spec here, because a WebKit-scoped spec would fail the
// chromium-only browser-security gate and shipping a skipped spec would make the
// suite green while proving nothing.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
} from './fixtures/draftHarness';
import type { Page } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

async function openDraftRoom(page: Page) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

test.describe('Draft room focus hold across click-away and flip (#532)', () => {
  test('a click-away to non-focusable content invalidates the hold, so a later flip does not yank focus back', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    // Focus the composer (the tracked region's control), then click empty,
    // non-focusable room content so focus falls to <body> with no relatedTarget -
    // the exact click-away shape that used to leave a stale hold.
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.focus();
    await expect(composer).toBeFocused();
    await page.mouse.click(2, 2);

    // Assert the precondition actually happened: focus is on <body>, not on any
    // focusable control. Without this the test could pass vacuously if the click
    // landed somewhere focusable.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe('BODY');

    // Now flip the layout (desktop -> mobile). With the click-away hold cleared,
    // the rescue must move nothing: focus stays where the user left it (<body>),
    // never pulled into the composer or another region control.
    await page.setViewportSize(VIEWPORTS.mobile);
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByRole('textbox', { name: 'Message' })).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  });

  test('a genuine tear-down flip still rescues the composer whose node is removed, with no pointer behind it', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    // Focus the composer and flip WITHOUT any intervening click-away. The
    // composer's node is torn down and rebuilt on the narrow Chat tab; the rescue
    // hands focus back to it in the same commit (issue #525 AC3), and the #532
    // change must not weaken that - the flip carries no pointer gesture, so the
    // hold survives.
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.focus();
    await expect(composer).toBeFocused();

    await page.setViewportSize(VIEWPORTS.mobile);
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  });
});
