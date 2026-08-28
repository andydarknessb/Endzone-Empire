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

async function openRoom(
  page: Page,
  over: Partial<DraftSocketState> = {},
  apiOver: { draftFeedError?: { status: number; body?: unknown } } = {}
) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, ...over });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS, ...apiOver });
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

  test('a confirmed member whose member-only feed answers 403 is revoked IN THE BROWSER: chat collapses, no reload (#534 AC4, #541 AC7)', async ({ page, expectConsoleError }) => {
    // The mid-draft revocation this file's footer used to say could only be
    // jsdom-proven. It could not be driven in a browser because the intentional
    // 403 is logged by Chromium as a "Failed to load resource" console error,
    // which the shared harness treated as a fatal unexpected error. The #541
    // contract lets this spec DECLARE that one error, named by status AND
    // endpoint, so the behaviour is provable here without weakening the guard
    // for anyone else: any OTHER console error, and any uncaught page error,
    // still fails teardown.
    // The endpoint match tolerates an optional query string ((\?|$)), so the
    // declaration stays valid even if the feed read ever carries a cursor param.
    expectConsoleError.resourceError({
      status: 403,
      url: /\/api\/league\/\d+\/draft-feed(\?|$)/,
      because: 'member-only combined-feed read is authoritative: a 403 revokes membership mid-draft (#534 AC4)',
    });

    // Wait for the specific 403 console line deterministically (attached before
    // navigation), so teardown never races the CDP delivery of the event.
    const feed403Seen = page.waitForEvent('console', {
      predicate: (m) => m.type() === 'error' && /status of 403/.test(m.text()) && /\/draft-feed/.test(m.location()?.url ?? ''),
      timeout: 10_000,
    });

    // A CONFIRMED member (join succeeds, no refusal), whose very first
    // combined-feed read then answers 403 - a manager removed between join and
    // the feed read. useDraftRoomFeed routes the 403 through feedErrorRevokesMembership
    // and the room collapses chat to the non-member surface, with no reload.
    await openRoom(page, { isCommissioner: false }, { draftFeedError: { status: 403 } });
    await feed403Seen;

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    // The room swapped in the single explicit non-member surface, inside the
    // same section + h2 "League Chat" shell (a heading-navigation user still
    // finds chat). Scoped to the region so the chrome's polite membership
    // announcer copy is not mistaken for the surface.
    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat).toBeVisible();
    await expect(chat.getByText('League chat is available to league members only.')).toBeVisible();

    // The member controls the feed hook had mounted are gone: no log, no
    // composer, no Send. The revocation actually tore them out (#534 AC4).
    await expect(page.getByRole('log', { name: 'League Chat' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
  });
});

// The two mid-session revocation channels (AC4) and the AC5 survival case are
// pinned in the jsdom suites (useDraftRoomFeed, DraftRoomChat, DraftBoard,
// useDraftSocket); their in-browser coverage is being sequenced:
//  - chat:send returning NOT_A_MEMBER now REVOKES membership (chat collapses to
//    the non-member surface). tests/e2e/draft-send-refusals.spec.ts still asserts
//    the pre-#534 behaviour for that send, so the e2e for this channel is being
//    reconciled with its owner rather than duplicated here.
//  - a 403 from the member-only feed: now proven IN THE BROWSER by the test
//    above, using the #541 expected-console-error contract to declare the
//    intentional 403 (by status and endpoint) that Chromium logs as a console
//    error. Before #541 that console error tripped the shared harness teardown,
//    so this channel could only be jsdom-proven.
//  - AC5 (a confirmed member survives JOIN_FAILED and an unknown code) needs a
//    member-then-refused-reconnect the harness does not yet express.
