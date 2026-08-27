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
//   - AC7: no provider network request is issued, proven by a recorded-request
//     assertion rather than a fence that cannot fail.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
} from './fixtures/draftHarness';
import type { Page, Request } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS, buildLeague, FIXTURE_TEAMS } from './fixtures/draftFixtures';

// The complete set of GIF-provider hosts the provider-neutral contract (#446)
// references: giphy and tenor are the only two named anywhere in the codebase
// (two comment strings, verified on #446), and no client provider is registered
// in a real build, so a breach could only reach one of these. The pattern
// matches their content/CDN subdomains too (media.giphy.com, c.tenor.com, ...).
const PROVIDER_HOST = /giphy|tenor/i;

/**
 * Record every request the page issues to a GIF-provider host. The returned
 * array is asserted EMPTY at the end of a scenario: an actual provider request
 * lands in it and fails the test by name, where a throwing route handler could
 * hang the request instead of surfacing as a failure. This is the AC7 proof
 * ("absence of any provider network request"), armed rather than merely present.
 */
function watchProviderRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (req: Request) => {
    if (PROVIDER_HOST.test(req.url())) hits.push(req.url());
  });
  return hits;
}

async function openDraftRoom(page: Page, gifMessagesEnabled: boolean) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, gifMessagesEnabled });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

test.describe('provider-gated GIF composer in the Draft room (#516)', () => {
  test('desktop: with the capability enabled, the composer is available and issues no provider request (AC2, AC7)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const providerRequests = watchProviderRequests(page);
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
    // match would also select (the strict-mode ambiguity #516 must not create).
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    // ...and the trigger opens the composer, whose accessible fields are the
    // local text inputs - no provider grid, no network.
    await trigger.click();
    await expect(chat.getByLabel('GIF asset id')).toBeVisible();
    await expect(chat.getByLabel(/description/i)).toBeVisible();
    // Its Cancel is distinct from the moderation form's Cancel (accessible-name
    // ambiguity fix): "Cancel GIF", not a bare "Cancel".
    await expect(chat.getByRole('button', { name: 'Cancel GIF' })).toBeVisible();

    // Nothing above reached a provider host.
    expect(providerRequests).toEqual([]);
  });

  test('desktop: with the capability off (the production answer), no GIF trigger appears and text still works (AC1)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const providerRequests = watchProviderRequests(page);
    // The ack omits gifMessagesEnabled, exactly as production does today.
    await openDraftRoom(page, false);

    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat.getByRole('button', { name: 'Add a GIF' })).toHaveCount(0);
    // Text composition is complete without it.
    const input = chat.getByLabel('Message');
    await input.fill('gg wp');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(input).toHaveValue('');

    expect(providerRequests).toEqual([]);
  });

  test('desktop: opening the GIF composer does not tip the shell past the viewport (issue #122 zero-slack, capability on)', async ({ page }) => {
    // The existing zero-slack guard (draft-board.spec.ts) runs with the
    // capability OFF, so it can never see the trigger or the open panel.
    // ChatConversation's own comment warns any element that grows the composer's
    // height tips the desktop shell past the viewport and makes the page scroll;
    // this re-runs that assertion with the capability ON and the panel open,
    // against an overflowing draft, so the contradiction is resolved by test.
    await page.setViewportSize(VIEWPORTS.desktop);
    await setTheme(page, 'light');
    const league = buildLeague({ draft_status: 'active' });
    await installDraftSocketHarness(page, {
      league, teams: FIXTURE_TEAMS, picks: ACTIVE_PICKS, onTheClock: FIXTURE_TEAMS[0],
      gifMessagesEnabled: true,
    });
    await installDraftRestApi(page, { league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    const chat = page.getByRole('region', { name: 'League Chat' });
    await chat.getByRole('button', { name: 'Add a GIF' }).click();
    // Fill the fields so the panel is at its full open height, not empty.
    await chat.getByLabel('GIF asset id').fill('abc123');
    await chat.getByLabel(/description/i).fill('a cat knocking a cup off a table');
    await expect(chat.getByLabel(/caption/i)).toBeVisible();

    // The page itself must still not scroll: the chat pane carries its own
    // overflow, so the open composer grows within that pane, not the shell.
    const pageScrolls = await page.evaluate(() => (
      document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
    ));
    expect(pageScrolls).toBe(false);
  });
});
