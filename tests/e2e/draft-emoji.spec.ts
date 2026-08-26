// End-to-end acceptance for the accessible emoji composition feature (#443,
// parent #429), driven against the real Draft-room composer through the same
// controlled REST + Socket.IO harness the rest of tests/e2e uses (nothing here
// reaches a live league, the shared database or Tank01). The composer that
// carries the picker is shared by the League Dashboard drawer and the Draft
// room, so exercising it in the Draft room covers both surfaces.
//
// These cover the four behaviours the ticket names for end-to-end proof:
// keyboard operability, predictable focus return, per-league session
// persistence across a tab change, and send behaviour (a composed emoji sends
// as ordinary text and clears the composer).
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

const GRINNING = '\u{1F600}'; // the first emoji in the picker's palette

async function openDraftRoom(page: Page) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, ACTIVE_STATE);
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

test.describe('accessible emoji composition (#443)', () => {
  test('desktop: keyboard opens the picker, inserts Unicode at the caret, keeps focus, and does not send', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    const chat = page.getByRole('region', { name: 'League Chat' });
    const input = chat.getByLabel('Message');
    await input.fill('gg');

    // Reach and open the picker with the keyboard alone: no pointer.
    const trigger = chat.getByRole('button', { name: 'Insert emoji' });
    await trigger.focus();
    await page.keyboard.press('Enter');

    // The menu opens with focus inside it, so a keyboard user is never stranded.
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // Commit the first emoji straight from the keyboard.
    await page.keyboard.press('Enter');

    // The Unicode is appended to the composed text (caret was at the end)...
    await expect(input).toHaveValue(`gg${GRINNING}`);
    // ...focus returns to the composer so typing continues seamlessly...
    await expect(input).toBeFocused();
    // ...and choosing an emoji composed rather than sent: the text is still here.
    await expect(input).toHaveValue(`gg${GRINNING}`);

    // Sending then clears the composer, proving the emoji travels as text.
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(input).toHaveValue('');
  });

  test('mobile: a composed emoji survives a Draft tab change, as ordinary preserved text', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page);

    // On mobile the room is tabbed; League Chat rides under the Draft tab.
    await page.getByRole('tab', { name: 'Draft' }).click();
    const chat = page.getByRole('region', { name: 'League Chat' });
    const input = chat.getByLabel('Message');
    await input.fill('brb ');

    // Add an emoji through the picker (pointer here; keyboard is covered above).
    await chat.getByRole('button', { name: 'Insert emoji' }).click();
    await page.getByRole('menuitem', { name: 'thumbs up' }).click();
    await expect(input).toHaveValue(`brb \u{1F44D}`);

    // Leave the Draft tab (the composer unmounts) and come back.
    await page.getByRole('tab', { name: 'Players' }).click();
    await expect(page.getByRole('region', { name: 'League Chat' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Draft' }).click();

    // The composed emoji text is restored from the per-league session draft.
    await expect(page.getByRole('region', { name: 'League Chat' }).getByLabel('Message'))
      .toHaveValue(`brb \u{1F44D}`);
  });
});
