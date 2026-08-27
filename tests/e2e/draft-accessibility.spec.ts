// End-to-end accessibility acceptance for the centerpiece Draft room (#445,
// parent #429), driven against the real room through the same controlled REST +
// Socket.IO harness the rest of tests/e2e uses (nothing here reaches a live
// league, the shared database or Tank01). The harness auto-fails on any browser
// console error or uncaught page error.
//
// WHAT THIS FILE IS, AND IS NOT (see the PR body and Cory's #125 ruling). AC8
// asks for automated checks plus MANUAL keyboard and screen-reader evidence. A
// background agent cannot run NVDA, JAWS or VoiceOver, so:
//   - the KEYBOARD half is delivered here in full: Playwright is a real browser
//     and drives real Tab, Shift+Tab, Enter and arrow keys, so AC4's focus
//     predictability across tabs, the moderation hide form and new-entry
//     navigation is asserted, not described. Emoji selection focus (open, choose,
//     Escape-to-dismiss) is covered in draft-emoji.spec.ts and EmojiPicker.test
//     and not repeated here.
//   - the SCREEN-READER half is SUBSTITUTED with DOM-level evidence: the roles
//     and accessible names a reader computes from, and a live region's text at
//     the moment it changes. That is a STRICTLY WEAKER claim than a reader
//     announcing it; the reader run remains a named gap for the maintainer
//     (#156, which absorbed #507).
//   - the screenshot matrix at both layouts is attached to the report.
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

async function openDraftRoom(page: Page, over: Partial<DraftSocketState> = {}) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE, ...over });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
}

// Deliver a server-pushed event into this page's fake draft socket, exactly as
// draft-hide.spec.ts does (the fake's injection hook).
async function deliver(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ([e, p]) => {
      (window as unknown as { __ENDZONE_DRAFT_DELIVER__: (ev: string, pl?: unknown) => void })
        .__ENDZONE_DRAFT_DELIVER__(e as string, p);
    },
    [event, payload] as const
  );
}

const chatMsg = (seq: number, teamName: string, message: string) => ({
  type: 'league_chat', id: seq, seq, teamId: 2, teamName, message, created_at: '2026-01-01T12:00:00Z',
});

test.describe('Draft room accessibility (#445)', () => {
  test('desktop: roles and names a screen reader computes from (DOM-level evidence for AC1)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page, { isCommissioner: true });

    // The three wide panes are each a named region (#444/#445 AC1).
    await expect(page.getByRole('region', { name: 'Chat and Draft activity' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Draft rail' })).toBeVisible();

    // The feed is a named accessible log, and the composer and commissioner
    // toolbar are named (AC1).
    await expect(page.getByRole('log', { name: 'League Chat' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Chat composer' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Commissioner draft controls' })).toBeVisible();

    await testInfo.attach('desktop-draft-room', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('desktop: a live message speaks once in a polite region (AC2 DOM evidence)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    // The opening feed is seeded silently; the FIRST delivery is that opening
    // state and is not announced. A SECOND, genuinely-live message is.
    await deliver(page, 'chat:message', chatMsg(1, 'Harbor Hawks', 'first'));
    await deliver(page, 'chat:message', chatMsg(2, 'Ridge Runners', 'good luck all'));
    // The announcement names WHO spoke, not the message body.
    await expect(page.getByText('New message from Ridge Runners')).toBeAttached();
    await expect(page.getByText('good luck all')).toBeVisible();
    // The Pick announcement path (draft:picked -> feed activity -> concise text)
    // is pinned end-to-end at the component level in DraftRoomChat.test.jsx and
    // feedAnnouncement.test.js; it is not re-driven here because draft:picked
    // also feeds the board reducer, which needs a full pick fixture unrelated to
    // this announcement.
  });

  test('desktop: the moderation hide FORM keeps focus predictable, including a committed hide (AC4)', async ({ page }) => {
    // It is an inline form, not a role="dialog" (no focus trap, no Escape
    // handler) - named accordingly. Both close paths are driven: Cancel, and a
    // committed hide whose chat:hidden broadcast removes the Hide button.
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page, { isCommissioner: true });

    await deliver(page, 'chat:message', chatMsg(1, 'Ridge Runners', 'seed'));
    await deliver(page, 'chat:message', chatMsg(2, 'Harbor Hawks', 'you are worthless'));
    const chat = page.getByRole('region', { name: 'League Chat' });
    await expect(chat.getByText('you are worthless')).toBeVisible();

    // Open the hide form from the keyboard: focus the Hide button, press Enter.
    const hide = chat.getByRole('button', { name: 'Hide message from Harbor Hawks' });
    await hide.focus();
    await page.keyboard.press('Enter');

    // Focus moves into the reason field.
    await expect(chat.getByLabel('Reason for hiding')).toBeFocused();

    // CANCEL returns focus to the Hide button that opened the form.
    await chat.getByRole('button', { name: 'Cancel' }).click();
    await expect(chat.getByRole('button', { name: 'Hide message from Harbor Hawks' })).toBeFocused();

    // COMMITTED hide: reopen, give a reason, confirm. The server would answer
    // with chat:hidden; the harness plays that role, removing the Hide button.
    await chat.getByRole('button', { name: 'Hide message from Harbor Hawks' }).click();
    await chat.getByLabel('Reason for hiding').fill('targeted harassment of a member');
    await chat.getByRole('button', { name: 'Confirm hide' }).click();
    await deliver(page, 'chat:hidden', {
      type: 'league_chat', id: 2, seq: 2, hidden: true, message: null, teamId: 2, teamName: 'Harbor Hawks',
      created_at: '2026-01-01T12:00:00Z',
    });

    // The tombstone replaces the content and THIS message's Hide button is gone
    // (the seed message keeps its own); focus is in the feed log, never on the
    // document body (the BLOCKER-2 regression).
    await expect(chat.getByText('Message hidden by commissioner')).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Hide message from Harbor Hawks' })).toHaveCount(0);
    await expect(page.getByRole('log', { name: 'League Chat' })).toBeFocused();
  });

  test('desktop: the N-new jump lands focus on the live log (AC4 new-entry navigation)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    // Seed enough messages to overflow the scrollback, so the reader can be up
    // in the backlog rather than pinned to the bottom.
    for (let seq = 1; seq <= 25; seq += 1) {
      await deliver(page, 'chat:message', chatMsg(seq, 'Harbor Hawks', `message number ${seq}`));
    }
    const log = page.getByRole('log', { name: 'League Chat' });
    await expect(log).toBeVisible();

    // Scroll up into older content (fires the scroll handler that records the
    // reader is no longer at the bottom).
    await log.evaluate((el) => { el.scrollTop = 0; });

    // A new message arrives while they read: the N-new affordance appears.
    await deliver(page, 'chat:message', chatMsg(26, 'Ridge Runners', 'over here'));
    const jump = page.getByRole('button', { name: /new message/i });
    await expect(jump).toBeVisible();

    // Activating it from the keyboard lands focus on the log itself.
    await jump.focus();
    await page.keyboard.press('Enter');
    await expect(log).toBeFocused();
  });

  test('mobile: tab keyboard flow - arrow moves focus (manual activation), Enter selects, Tab and Shift+Tab cross the panel boundary (AC1/AC4)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page);

    // The room opens on the Chat tab (#444). Its panel is a tabpanel named by
    // the tab (AC1).
    const chatTab = page.getByRole('tab', { name: 'Chat' });
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();
    await testInfo.attach('mobile-chat-tab', { body: await page.screenshot(), contentType: 'image/png' });

    // Arrow keys walk the tablist; this room uses manual activation (MUI's
    // default), so ArrowRight moves focus and Enter activates the tab.
    await chatTab.focus();
    await page.keyboard.press('ArrowRight');
    const playersTab = page.getByRole('tab', { name: 'Players' });
    await expect(playersTab).toBeFocused();
    // Focus moved without yet changing the selection.
    await expect(playersTab).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('Enter');
    await expect(playersTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Players' })).toBeVisible();
    await testInfo.attach('mobile-players-tab', { body: await page.screenshot(), contentType: 'image/png' });

    // Focus stays on the selected tab; one Tab press moves into its panel...
    await expect(playersTab).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel', { name: 'Players' })).toBeFocused();

    // ...and Shift+Tab returns from the panel to its tab, so the boundary is
    // crossable in both directions.
    await page.keyboard.press('Shift+Tab');
    await expect(playersTab).toBeFocused();
  });
});
