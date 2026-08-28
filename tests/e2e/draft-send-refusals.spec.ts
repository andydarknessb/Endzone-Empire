// Refused-send browser evidence (issue #447 AC3 rate limit, AC2 blocked manager).
//
// Two of the Draft room's send refusals had no in-browser test: the rate-limited
// sender the ruling names as a harness gap, and the manager removed after joining
// who "may no longer speak" (draftSocket.js revalidates membership PER SEND, so a
// live socket is not a licence to send). Both share one observable guarantee from
// ChatConversation/useDraftRoomFeed: on a refused ack the composer KEEPS its text
// (it clears only on success) and the refusal surfaces as an error.
//
// The positive control is the third test: without a refusal the SAME send path
// clears the box and shows no error. Without it, "the text is still there" is
// indistinguishable from "the send never fired" and "the error is visible" from
// "the error node is always mounted".
//
// The refusal acks are shaped exactly as the server sends them
// (draftSocket.js:214-221 RATE_LIMITED, :190-192 NOT_A_MEMBER), delivered through
// the harness's chatSendRefusal seam - no feed, socket or server behaviour is
// changed here; this proves the shipped client's response to a shipped refusal.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
  type DraftSocketState,
} from './fixtures/draftHarness';
import type { Page, Locator } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

test.describe('Draft-room send refusals keep the message and surface the error (#447 AC3/AC2)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  // Opens the member Draft room with the given socket-state overrides and returns
  // the composer's message field, ready to type into.
  async function openRoom(page: Page, over: Partial<DraftSocketState> = {}): Promise<Locator> {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, { ...ACTIVE_STATE, ...over });
    await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    return page.getByRole('textbox', { name: 'Message' });
  }

  test('a rate-limited sender keeps the text and is told when to retry (AC3)', async ({ page }) => {
    const input = await openRoom(page, {
      chatSendRefusal: { error: 'you are sending too quickly', code: 'RATE_LIMITED', retryAfterSeconds: 30 },
    });

    await input.fill('hello everyone');
    await page.getByRole('button', { name: 'Send' }).click();

    // The client composes the retry hint from retryAfterSeconds (#440 AC5)...
    await expect(page.getByText('you are sending too quickly. Try again in 30s.')).toBeVisible();
    // ...and nothing is dropped: the message stays in the composer to retry.
    await expect(input).toHaveValue('hello everyone');
  });

  test('a manager removed after joining may no longer speak: the send is refused and the text is kept (AC2 blocked manager)', async ({ page }) => {
    const input = await openRoom(page, {
      chatSendRefusal: { error: 'you are not in this league', code: 'NOT_A_MEMBER' },
    });

    await input.fill('am I still here?');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('you are not in this league')).toBeVisible();
    await expect(input).toHaveValue('am I still here?');
  });

  test('positive control: an accepted send clears the composer and shows no error', async ({ page }) => {
    const input = await openRoom(page); // default ack accepts the send

    await input.fill('good luck all');
    await page.getByRole('button', { name: 'Send' }).click();

    // The success path clears the box (clearDraft on ok), and neither refusal
    // message is present - proving the two tests above observed a real refusal,
    // not a send that never happened or an error node that is always shown.
    await expect(input).toHaveValue('');
    await expect(page.getByText('you are sending too quickly. Try again in 30s.')).toHaveCount(0);
    await expect(page.getByText('you are not in this league')).toHaveCount(0);
  });
});
