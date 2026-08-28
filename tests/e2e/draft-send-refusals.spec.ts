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
import { ACTIVE_STATE, ACTIVE_PICKS, FIXTURE_LEAGUE_ID } from './fixtures/draftFixtures';

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

  test('a manager removed after joining is told they may no longer speak, and the unsent text is not lost (#534 AC4)', async ({ page }) => {
    // Updated for #534 AC4 (this ticket supersedes the pre-#534 behavior this
    // test used to pin). draftSocket.js revalidates membership PER SEND, so a
    // NOT_A_MEMBER send means a manager removed after joining. Before #534 the
    // send was merely refused and the composer kept its text; #534 makes that
    // refusal AUTHORITATIVE - chat collapses to the explicit non-member surface
    // without a reload, so the composer and its inline error are gone.
    //
    // This test still guards BOTH promises its name has always made, just through
    // the surfaces #534 moved them to:
    //  1. the manager is still TOLD they may no longer speak - now on the
    //     non-member panel rather than a composer error (a removed manager
    //     silently given a blank room would be a worse outcome, not a better one);
    //  2. no unsent text is LOST - useComposerDraft persists every keystroke to
    //     sessionStorage per league + account (#442/#529), and a refused send
    //     never clears it, so the text survives the unmount in storage and is
    //     there to restore if membership returns. The guarantee holds; only the
    //     mechanism carrying it changed from the live composer to its saved draft.
    const input = await openRoom(page, {
      chatSendRefusal: { error: 'you are not in this league', code: 'NOT_A_MEMBER' },
    });

    await input.fill('am I still here?');
    await page.getByRole('button', { name: 'Send' }).click();

    // 1. Told: the explicit non-member surface replaces the chat, composer gone.
    await expect(
      page.getByRole('region', { name: 'League Chat' })
        .getByText('League chat is available to league members only.')
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);

    // 2. Not lost: the unsent draft is still in sessionStorage (never cleared by a
    // refused send), keyed by this league, ready to restore.
    const savedText = await page.evaluate(
      (key) => {
        try {
          const raw = window.sessionStorage.getItem(key);
          return raw ? (JSON.parse(raw).text ?? null) : null;
        } catch {
          return null;
        }
      },
      `endzone:composerDraft:${FIXTURE_LEAGUE_ID}`
    );
    expect(savedText).toBe('am I still here?');
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

// The OTHER blocked-manager path (#447 AC2): a non-member whose draft:join is
// refused NOT_A_MEMBER, never a member in this league. The board reads league,
// teams and the clock ONLY from the draft:state snapshot (useDraftSocket), which
// never arrives on a refusal, so the room surfaces the refusal and shows no board
// content. This test asserts the error and the absent board; the #534 non-member
// CHAT surface for this same join refusal (the mounted-dead-composer defect this
// comment used to flag as unfixed) is now implemented and asserted in
// draft-member-gated-chat.spec.ts, so it is not duplicated here.
test.describe('a refused join surfaces the error without a board (#447 AC2 blocked manager, join path)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('a non-member whose draft:join is refused sees the refusal and no board content', async ({ page }) => {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, {
      ...ACTIVE_STATE,
      joinRefusal: { error: 'you are not in this league', code: 'NOT_A_MEMBER' },
    });
    await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);

    // The refusal is surfaced as the room's error.
    await expect(page.getByText('you are not in this league')).toBeVisible();
    // No snapshot arrived, so no board content renders: the league name never
    // lands (the H1 falls back to "Draft Board"), and nobody is shown on the clock.
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toHaveCount(0);
    await expect(page.getByText('On the clock: Ridge Runners')).toHaveCount(0);
  });
});
