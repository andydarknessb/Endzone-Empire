// End-to-end acceptance for the provider-gated GIF composer inside the Draft
// room (#516), driven against the real Draft-room composer through the same
// controlled REST + Socket.IO harness the rest of tests/e2e uses. Nothing here
// reaches a live league, the shared database, Tank01, or any GIF provider.
//
// These prove the two OBSERVABLE states Cory's criteria name at the real-app
// level, complementing the unit and integration coverage of the send payload,
// acknowledgement reconciliation and refusals:
//   - AC1: with the capability off (the production answer: the ack omits the
//     field, so the client reads it absent -> off), the GIF trigger is absent
//     while text composition still works.
//   - AC2: with the capability on, the trigger and composer are available.
//
// AC7 fence: enabling the capability introduces no provider, key or outbound
// request. A real build registers no client GIF provider, so opening the
// composer only mounts local text fields and Send stays disabled - there is
// nothing here that could issue a provider request, which the assertions below
// make observable by failing any unexpected network call.
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

async function openDraftRoom(page: Page, gifMessagesEnabled: boolean) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, gifMessagesEnabled });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  // Any request to a GIF-provider host is a fence breach (AC7). No real provider
  // ships, so nothing should ever hit one; fail loudly if a scenario does.
  await page.route(/giphy|tenor/i, (route) => {
    throw new Error(`unexpected provider request: ${route.request().url()}`);
  });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

test.describe('provider-gated GIF composer in the Draft room (#516)', () => {
  test('desktop: with the capability enabled, the Draft-room GIF composer is available (AC2)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page, true);

    const chat = page.getByRole('region', { name: 'League Chat' });
    // The trigger is present because the join ack enabled the capability...
    const trigger = chat.getByRole('button', { name: 'Add a GIF' });
    await expect(trigger).toBeVisible();
    // Text composition is unaffected while the trigger sits beside it: the
    // message field and its Send are here before the composer is even opened.
    await expect(chat.getByLabel('Message')).toBeVisible();
    // exact: true so this names the text composer's Send alone - once the GIF
    // panel opens below it adds a "Send GIF" button, which a loose substring
    // match would also select (the strict-mode ambiguity #516 must not create
    // for any single-element locator).
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    // ...and the trigger opens the composer, whose accessible fields are the
    // local text inputs - no provider grid, no network.
    await trigger.click();
    await expect(chat.getByLabel('GIF asset id')).toBeVisible();
    await expect(chat.getByLabel(/description/i)).toBeVisible();
  });

  test('desktop: with the capability off (the production answer), no GIF trigger appears and text still works (AC1)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    // The ack omits gifMessagesEnabled, exactly as production does today.
    await openDraftRoom(page, false);

    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat.getByRole('button', { name: 'Add a GIF' })).toHaveCount(0);
    // Text composition is complete without it.
    const input = chat.getByLabel('Message');
    await input.fill('gg wp');
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(input).toHaveValue('');
  });
});
