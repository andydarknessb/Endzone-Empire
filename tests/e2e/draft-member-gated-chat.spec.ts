// Browser evidence that the Draft room mounts League chat ONLY for a confirmed
// member (#534 AC6), driven against the real Draft room through the same
// controlled REST + Socket.IO harness the rest of tests/e2e uses. Nothing here
// reaches a live league, the shared database or Tank01.
//
// The bug #534 fixes: the chat subtree used to mount from socket existence
// alone, so a viewer refused NOT_A_MEMBER still got the log and composer mounted
// over a combined-feed request the server answers 403. These specs prove the
// three-state gate: a confirmed member gets the full surface, and an authoritative
// non-member gets one explicit message with none of the member controls and no
// feed request.
//
// The refusal is driven through the harness's joinRefusal seam (added for #447),
// shaped exactly as server/modules/draftSocket.js sends a viewer holding no Team.
// The chat:send and feed-403 mid-session revocation channels (AC4) are covered
// separately (see the note at the foot of this file).
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
import type { Page } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

// A held chat message, so a commissioner's Hide affordance (the moderation
// control the positive control asserts) has something to act on. Same shape the
// #482 moderation spec seeds.
const HELD_MESSAGE = {
  type: 'league_chat',
  id: 4242,
  seq: 90,
  teamId: 2,
  teamName: 'Harbor Hawks',
  message: 'good luck everyone',
  created_at: '2026-01-01T12:00:00Z',
};

async function openRoom(page: Page, over: Partial<DraftSocketState> = {}) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, ...over });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
}

async function deliver(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ([e, p]) => {
      (window as unknown as { __ENDZONE_DRAFT_DELIVER__: (ev: string, pl?: unknown) => void })
        .__ENDZONE_DRAFT_DELIVER__(e as string, p);
    },
    [event, payload] as const
  );
}

test.describe('the Draft room mounts League chat only for a confirmed member (#534)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('positive control: a confirmed member finds the log, composer, Send and moderation', async ({ page }) => {
    // The required positive control (#534 AC6): "the composer is absent" is also
    // what you see when a locator is wrong, the page did not load, or the harness
    // never connected. So the SAME locators the refusal test asserts ABSENT must
    // be proven to FIND the surface in a confirmed-member session - here a
    // commissioner, so the moderation control is present too.
    await openRoom(page, { isCommissioner: true });
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat).toBeVisible();
    // The log, the composer textbox and Send are all present for a member.
    await expect(page.getByRole('log', { name: 'League Chat' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    // Moderation: a delivered message gives the commissioner a Hide affordance.
    await deliver(page, 'chat:message', HELD_MESSAGE);
    await expect(chat.getByRole('button', { name: 'Hide message from Harbor Hawks' })).toBeVisible();
    // And the non-member surface is NOT shown to a member.
    await expect(page.getByText('League chat is available to league members only.')).toHaveCount(0);
  });

  test('an initial NOT_A_MEMBER refusal shows one explicit message, none of the member controls, and issues no feed request', async ({ page }) => {
    // Record every request so we can prove the combined-feed read never left the
    // client (#534 AC1): a request that would 403 for a non-member must not be
    // issued at all, not merely issued and swallowed.
    const requestPaths: string[] = [];
    page.on('request', (r) => requestPaths.push(new URL(r.url()).pathname));

    await openRoom(page, {
      // The join's only acknowledgement is the refusal, exactly as draftSocket.js
      // sends a viewer holding no Team. Discriminated on the code, never the text.
      joinRefusal: { error: 'you are not in this league', code: 'NOT_A_MEMBER' },
    });

    // The one explicit non-member message is shown, inside the section + h2
    // "League Chat" shell (so a heading-navigation user still finds chat). Scope
    // to the region: the same sentence also rides the chrome's polite membership
    // announcer, which is the a11y-intended second copy, not a duplicate surface.
    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat).toBeVisible();
    await expect(chat.getByText('League chat is available to league members only.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'League Chat', level: 2 })).toBeVisible();
    // The transition is announced once, politely, from the chrome (a11y finding
    // 3): the persistent surface itself is role="presentation", not a live region.
    await expect(page.getByRole('status').filter({ hasText: 'League chat is available' })).toHaveCount(1);

    // The SAME locators the positive control found now find nothing: no log, no
    // composer textbox, no Send control (AC3). Moderation is likewise absent, as
    // there is no chat surface to moderate.
    await expect(page.getByRole('log', { name: 'League Chat' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Hide message/ })).toHaveCount(0);

    // AC1: no combined-feed request was ever issued.
    expect(requestPaths.filter((p) => p.includes('/draft-feed'))).toEqual([]);
  });
});

// The two mid-session revocation channels (AC4) and the AC5 survival case are
// pinned in the jsdom suites (useDraftRoomFeed, DraftRoomChat, DraftBoard,
// useDraftSocket); their in-browser coverage is being sequenced:
//  - chat:send returning NOT_A_MEMBER now REVOKES membership (chat collapses to
//    the non-member surface). tests/e2e/draft-send-refusals.spec.ts still asserts
//    the pre-#534 behaviour for that send, so the e2e for this channel is being
//    reconciled with its owner rather than duplicated here.
//  - a 403 from the member-only feed: a raw HTTP 403 in-browser trips the shared
//    harness's console-error teardown, so this channel stays jsdom-proven.
//  - AC5 (a confirmed member survives JOIN_FAILED and an unknown code) needs a
//    member-then-refused-reconnect the harness does not yet express.
