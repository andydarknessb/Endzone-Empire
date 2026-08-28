// Commissioner-controls browser evidence (issue #447 AC3 controls, AC4 Escape).
//
// The existing suites assert the "Commissioner draft controls" region is NAMED
// and present, but do not DRIVE it, and the draft-admin endpoints are declared
// `unstubbed` in the route table on purpose. This spec drives the two things it
// can without a server change: it enumerates the control buttons the region
// exposes (AC3), and it exercises the Escape key path AC4 names on a control
// (open the Correct-latest-Pick dialog, Escape closes it). Opening and dismissing
// that dialog is entirely client-side (no admin endpoint is called), so it stays
// inside the harness's no-unmocked-endpoint contract.
//
// Firing the destructive controls themselves (pause, correct, reset) is out of
// scope here: it would need the admin endpoints stubbed, and this ticket proves
// the shipped surface rather than the pick-mutation flow (#439 owns that).
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
import { buildLeague, FIXTURE_TEAMS, ACTIVE_PICKS } from './fixtures/draftFixtures';

test.describe('commissioner controls: present and keyboard-operable (#447 AC3 controls, AC4 Escape)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  // An active draft, viewed as commissioner, with current_pick reaching pick 1 so
  // "Correct latest Pick" is enabled (its target is the latest reached non-keeper
  // Pick).
  async function openActiveCommissionerRoom(page: Page) {
    await setTheme(page, 'light');
    const league = buildLeague({ draft_status: 'active', current_pick: 1 });
    const state = {
      league,
      teams: FIXTURE_TEAMS,
      picks: ACTIVE_PICKS,
      onTheClock: FIXTURE_TEAMS[0],
      isCommissioner: true,
    };
    await installDraftSocketHarness(page, state);
    await installDraftRestApi(page, { league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
  }

  test('the controls region exposes Pause, Correct, Reset and Presenter link (AC3)', async ({ page }) => {
    await openActiveCommissionerRoom(page);

    const controls = page.getByRole('region', { name: 'Commissioner draft controls' });
    await expect(controls).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Pause Draft' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Correct latest Pick' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Reset draft' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Presenter link' })).toBeVisible();
  });

  test('Escape closes the Correct-latest-Pick dialog without submitting (AC4 Escape path)', async ({ page }) => {
    await openActiveCommissionerRoom(page);

    const controls = page.getByRole('region', { name: 'Commissioner draft controls' });
    await controls.getByRole('button', { name: 'Correct latest Pick' }).click();

    const dialog = page.getByRole('dialog', { name: 'Correct latest pick?' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
