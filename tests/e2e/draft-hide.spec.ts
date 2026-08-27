// End-to-end acceptance for live content moderation in the Draft room (#482,
// parent #441), driven against the real Draft room through the same controlled
// REST + Socket.IO harness the rest of tests/e2e uses (nothing here reaches a
// live league, the shared database or Tank01).
//
// The behaviour under test is multi-client: when a commissioner hides a message
// from the Draft room, every member in the room sees the neutral tombstone live,
// with no refetch and no navigation - the same mechanism the Dashboard drawer
// already had (#441), now reaching the combined feed (#482).
//
// The harness simulates no live feed of its own, so this spec plays the server's
// broadcast role explicitly: it seeds the same chat message on each page's fake
// socket, drives the hide through the commissioner's real UI on the first page
// (which posts to the harness's /api/safety/hide route), then delivers the
// `chat:hidden` broadcast into each page's socket through the injection hook the
// fake exposes. Both pages must then show the tombstone in place.
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

// The abusive message both pages hold before the hide, and the tombstone
// broadcast that replaces it. Same id and seq on the wire, so each page rewrites
// the entry it already holds in place (the combined feed keys on seq).
const HELD_MESSAGE = {
  type: 'league_chat',
  id: 4242,
  seq: 90,
  teamId: 2,
  teamName: 'Harbor Hawks',
  message: 'you are worthless',
  created_at: '2026-01-01T12:00:00Z',
};
const HIDDEN_BROADCAST = {
  type: 'league_chat',
  id: 4242,
  seq: 90,
  hidden: true,
  message: null,
  teamId: 2,
  teamName: 'Harbor Hawks',
  created_at: '2026-01-01T12:00:00Z',
};
const TOMBSTONE = 'Message hidden by commissioner';

async function openDraftRoom(page: Page, over: Partial<DraftSocketState>) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, ...over });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
  // The desktop rail shows League Chat directly (no tab change); its listeners
  // are registered by the time the region is on screen.
  await expect(page.getByRole('region', { name: 'League Chat' })).toBeVisible();
}

// Deliver a server-pushed event into this page's fake draft socket, the way a
// real broadcast would arrive (the fake's injection hook, #482).
async function deliver(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ([e, p]) => {
      (window as unknown as { __ENDZONE_DRAFT_DELIVER__: (ev: string, pl?: unknown) => void })
        .__ENDZONE_DRAFT_DELIVER__(e as string, p);
    },
    [event, payload] as const
  );
}

test.describe('live content moderation in the Draft room (#482)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('a commissioner hides from the room and both clients live-tombstone it, no navigation', async ({ page, context }) => {
    // Page one is the commissioner; page two is an ordinary member. Each is its
    // own client with its own fake socket in the same league room.
    const memberPage = await context.newPage();
    await openDraftRoom(page, { isCommissioner: true });
    await openDraftRoom(memberPage, { isCommissioner: false });

    // Both clients hold the same abusive message (delivered as a live broadcast).
    await deliver(page, 'chat:message', HELD_MESSAGE);
    await deliver(memberPage, 'chat:message', HELD_MESSAGE);
    const commishChat = page.getByRole('region', { name: 'League Chat' });
    const memberChat = memberPage.getByRole('region', { name: 'League Chat' });
    await expect(commishChat.getByText('you are worthless')).toBeVisible();
    await expect(memberChat.getByText('you are worthless')).toBeVisible();

    // The member sees no hide affordance; only the commissioner does (AC3).
    await expect(memberChat.getByRole('button', { name: /Hide message/ })).toHaveCount(0);

    // The commissioner hides it through the real UI: open the form, give a
    // reason, confirm. This posts to the shared /api/safety/hide route.
    const urlBefore = page.url();
    await commishChat.getByRole('button', { name: 'Hide message from Harbor Hawks' }).click();
    await commishChat.getByLabel('Reason for hiding').fill('targeted harassment of a member');
    await commishChat.getByRole('button', { name: 'Confirm hide' }).click();

    // The server would answer that hide with a chat:hidden broadcast to the room;
    // the harness plays that role, delivering it to each connected client.
    await deliver(page, 'chat:hidden', HIDDEN_BROADCAST);
    await deliver(memberPage, 'chat:hidden', HIDDEN_BROADCAST);

    // Both clients now show the neutral tombstone in place, with the original
    // content gone and no page navigation on either.
    await expect(commishChat.getByText(TOMBSTONE)).toBeVisible();
    await expect(memberChat.getByText(TOMBSTONE)).toBeVisible();
    await expect(commishChat.getByText('you are worthless')).toHaveCount(0);
    await expect(memberChat.getByText('you are worthless')).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    // The tombstone leaves no lingering hide control on the now-hidden message.
    await expect(commishChat.getByRole('button', { name: /Hide message/ })).toHaveCount(0);

    await memberPage.close();
  });
});
