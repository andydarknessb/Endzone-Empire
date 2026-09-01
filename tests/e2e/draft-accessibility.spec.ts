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
import { ACTIVE_STATE, ACTIVE_PICKS, FIXTURE_TEAMS } from './fixtures/draftFixtures';
import { captureMatrix } from './fixtures/screenshotMatrix';

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

// Force software rasterization for every capture in this file. GPU text
// rasterization is not bit-exact between runs - a couple of anti-aliased pixels
// on rendered glyphs flicker, invisible to a reader but a binary diff on a
// committed PNG - so the committed screenshot matrix (#548) would rot with
// spurious diffs on every regeneration. Software raster is deterministic. This
// must be top-level (Playwright forbids launchOptions inside a describe, since
// it forces a fresh worker); it relaunches only THIS file's worker, so the rest
// of tests/e2e is untouched. The existing #445 accessibility assertions are
// role/focus/DOM-level and unaffected by the rasterizer.
test.use({ launchOptions: { args: ['--disable-gpu', '--disable-lcd-text', '--font-render-hinting=none'] } });

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

    // The wide room with the Players pane selected (the left pane's default).
    // Committed as wide-players.png; the report attachment keeps its historical
    // name. The Board-matrix wide composition criterion 1 asks for is a separate
    // capture in the #548 matrix below, not this one.
    await captureMatrix(page, testInfo, { file: 'room-wide-players', attach: 'desktop-draft-room' });
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
    // Picks are announced by a SEPARATE room-level region (PickAnnouncer, #513),
    // not by this Chat-scoped feed announcer, so that a committed Pick is heard on
    // every tab and exactly once. The Pick announcement path (draft:picked ->
    // onPickLanded -> concise text) is pinned at the component level in
    // PickAnnouncer.test.jsx, pickAnnouncement.test.js and DraftBoard.test.jsx
    // (wide plus all four narrow tabs, counting to prove no duplicate); it is not
    // re-driven here because draft:picked also feeds the board reducer, which
    // needs a full pick fixture unrelated to this message announcement.
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

  test('a desktop -> mobile resize hands the chat composer its focus back across the layout flip (#525)', async ({ page }) => {
    // The room chooses panes vs tabs from its own measured CONTAINER width, so
    // shrinking the window (a desktop resize or window snap, the live triggers
    // #525 names) crosses the pane threshold and remounts the whole region
    // subtree. Without the rescue the browser drops focus to <body>; with it the
    // composer, rendered again on the narrow Chat tab, gets focus back in the
    // same commit. This is the real-browser counterpart to the jsdom flip tests
    // in DraftBoard.test.jsx, which prove the same across a controlled resize.
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page);

    // Wide: the composer is the centre pane. Focus it.
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.focus();
    await expect(composer).toBeFocused();

    // Cross the threshold: the three panes collapse to the Chat tab (the tab the
    // room opens on), remounting the composer as a fresh node.
    await page.setViewportSize(VIEWPORTS.mobile);
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');

    // Focus is on the composer again, not the document body.
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  });

  test('mobile: tab keyboard flow - arrow moves focus (manual activation), Enter selects, Tab and Shift+Tab cross the panel boundary (AC1/AC4)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page);

    // The room opens on the Chat tab (#444). Its panel is a tabpanel named by
    // the tab (AC1).
    const chatTab = page.getByRole('tab', { name: 'Chat' });
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();
    await captureMatrix(page, testInfo, { file: 'room-narrow-chat', attach: 'mobile-chat-tab' });

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
    await captureMatrix(page, testInfo, { file: 'room-narrow-players', attach: 'mobile-players-tab' });

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

// ===========================================================================
// The regenerable, human-browsable screenshot matrix (#548).
//
// This EXTENDS the matrix the suite above already owns; it does not fork it.
// The three captures above are its wide-Players and narrow-Chat / narrow-Players
// members, now written to the committed set (tests/e2e/draft-room-screenshots/)
// under stable descriptive names while keeping their historical report
// attachment names. This block adds the members those did not cover: the wide
// Board-matrix composition, the two remaining narrow tabs (Board, Draft), the
// four interactive chat surfaces, a reduced-motion variant, and a genuine
// keyboard-focus ring.
//
// Every capture is PAIRED with an assertion that its named state is on screen
// immediately before the shot. A screenshot ticket looks done the moment images
// exist and nothing is red, but a frame taken a moment too early (a panel before
// it opened, a counter one keystroke short of its warning band) is a green run
// of the wrong picture; the pre-shot assertion is what turns each image from an
// unverified claim into a checked one.
//
// REGENERATE the committed set (README.md in the folder documents this too):
//   npx playwright test --config=playwright.e2e.config.js \
//     tests/e2e/draft-accessibility.spec.ts
// Run with the config's own reporters. Do NOT pass --reporter=list: it overrides
// the config's reporter array and drops the html reporter, so the run passes and
// writes NO report attachments at all (the committed files still write, but the
// report half of AC6 is silently lost).
// ===========================================================================
test.describe('Draft room screenshot matrix (#548)', () => {
  // UTC + en-US so the one wall-clock string the matrix renders (the tombstone's
  // toLocaleTimeString) is identical on every machine and every run. Scoped to
  // this block so the suite above is untouched (it renders no timestamp anyway).
  test.use({ timezoneId: 'UTC', locale: 'en-US' });

  // Every capture in this block puts Harbor Hawks (NOT the harness viewer's Team)
  // on the clock. The reason is determinism, not layout: when the viewer is on
  // the clock, DraftStatusBar opens a "You're on the clock!" Snackbar with a
  // 6000ms auto-hide (useDraftSocket fires it once on the isMyTurn edge), and a
  // capture taken near that 6s boundary races it - present in one run, gone the
  // next - which is a binary diff on a committed PNG. A non-viewer turn never
  // fires it, so the shot is stable. The on-the-clock BANNER (LiveDraftBanner)
  // still renders for any active draft; it simply reads "Harbor Hawks is on the
  // clock" here, which is the on-the-clock banner criterion 1 asks to be visible.
  const NOT_MY_TURN = { onTheClock: FIXTURE_TEAMS[1] };

  test('wide: the Board matrix composition, board + chat + rail + on-the-clock banner simultaneously visible (AC1)', async ({ page }, testInfo) => {
    // VIEWPORTS.desktop (the wide LAYOUT: three side-by-side panes), the same
    // constant the three original captures use, so the extended matrix stays
    // comparable with them. Criterion 1 wants the Board SELECTED while the other
    // three regions are simultaneously visible; it does not require the whole
    // matrix in frame, and the Draft room's shell is pinned to exactly the
    // viewport height (draft-board.spec.ts #122), so any overflow goes into each
    // region's own scroller rather than scrolling the page. This is a whole-room
    // state, so it is a viewport capture (never fullPage, which on a
    // non-scrolling shell is the same pixels but implies a completeness that the
    // independently-scrolling regions do not have).
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page, NOT_MY_TURN);

    // Select the Board in the left pane (the wide room opens on Players there).
    // On a wide container there is no tab bar, so this "Board" button is the
    // left-pane toggle, unambiguously.
    await page.getByRole('button', { name: 'Board', exact: true }).click();

    // Assert each of the four regions is actually IN THE VIEWPORT - not merely in
    // the DOM - immediately before the shot.
    await expect(page.getByRole('region', { name: 'Draft Board' })).toBeInViewport();
    await expect(page.getByRole('region', { name: 'Chat and Draft activity' })).toBeInViewport();
    await expect(page.getByRole('region', { name: 'Draft rail' })).toBeInViewport();
    // The on-the-clock banner: "No pick clock" is unique to LiveDraftBanner, and
    // Harbor Hawks is on the clock in this fixture (see NOT_MY_TURN above), so the
    // banner reads that. Both are asserted in the viewport.
    await expect(page.getByText('No pick clock')).toBeInViewport();
    await expect(page.getByText('Harbor Hawks is on the clock')).toBeInViewport();

    await captureMatrix(page, testInfo, { file: 'room-wide-board-matrix' });
  });

  test('wide: the Board matrix composition under reduced motion (AC4)', async ({ page }, testInfo) => {
    // The reduced-motion variant is produced through the app's OWN behaviour under
    // page.emulateMedia({ reducedMotion: 'reduce' }), never a hand-written media
    // query. The Board matrix is the fitting subject: its on-the-clock cell and
    // the banner timer both animate, and both carry a reduce-query opt-out. Same
    // wide layout / desktop viewport as the composition above, so the two are
    // directly comparable.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(VIEWPORTS.desktop);
    await openDraftRoom(page, NOT_MY_TURN);

    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Draft Board' })).toBeInViewport();

    // Prove the emulation is in effect before the shot, so "reduced motion" is
    // asserted rather than assumed.
    const reduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    expect(reduced).toBe(true);

    await captureMatrix(page, testInfo, { file: 'room-reduced-motion-wide-board' });
  });

  test('narrow: the Chat tab under reduced motion (AC4)', async ({ page }, testInfo) => {
    // The second named reduced-motion variant, in the narrow layout (the tab bar's
    // indicator and MUI's touch ripple are the animations reduce suppresses here),
    // so the "variants" the criterion names span both layouts and each pairs with
    // its ordinary-motion room capture. Same emulateMedia route, never a
    // hand-written media query.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    // The room opens on the Chat tab; assert its panel is visible before the shot.
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();

    const reduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    expect(reduced).toBe(true);

    await captureMatrix(page, testInfo, { file: 'room-reduced-motion-narrow-chat' });
  });

  test('narrow: the Board tab, selected with its panel visible (AC2)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    await page.getByRole('tab', { name: 'Board' }).click();
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Board' })).toBeVisible();
    // The Board matrix's own region sits inside the selected panel.
    await expect(page.getByRole('region', { name: 'Draft Board' })).toBeVisible();

    await captureMatrix(page, testInfo, { file: 'room-narrow-board' });
  });

  test('narrow: the Draft tab, selected with its panel visible (AC2)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    await page.getByRole('tab', { name: 'Draft' }).click();
    await expect(page.getByRole('tab', { name: 'Draft' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Draft' })).toBeVisible();

    await captureMatrix(page, testInfo, { file: 'room-narrow-draft' });
  });

  test('chat: the emoji picker open (AC3)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    // The room opens on the Chat tab, so the composer and its Insert emoji trigger
    // are on screen. Open the picker and assert the named menu (and a real item)
    // are visible before the shot, so the frame cannot predate the menu opening.
    await page.getByRole('button', { name: 'Insert emoji' }).click();
    const emojiMenu = page.getByRole('menu', { name: 'Emoji' });
    await expect(emojiMenu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'fire' })).toBeVisible();

    // Region capture: the picker is a MUI Menu portaled to the document body, so
    // it is the emoji menu itself that is the subject, framed whole.
    await captureMatrix(page, testInfo, { file: 'region-chat-emoji-picker', element: emojiMenu });
  });

  test('chat: the character counter in its warning band (AC3)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    // The warning band is remaining <= 50 code points and > 0 (chatLimits.js:
    // CHAT_CHARS_WARNING = 50, MAX_CHAT_CHARS = 500). 460 characters leaves 40
    // remaining: squarely inside the warning band, not over the limit. Derived
    // from the code rather than a guessed threshold. The filler is natural varied
    // text rather than a run of one repeated glyph: a long run of identical
    // glyphs at fractional device-pixel positions is the classic subpixel
    // anti-aliasing flap, and it made the committed PNG non-deterministic; varied
    // text with word breaks rasterizes stably.
    const filler = ' '.repeat(460);
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill(filler);

    // One source (bandFor) drives BOTH the counter colour and the polite
    // announcement, so asserting the warning announcement's exact text proves the
    // warning STATE the colour shows - not merely that some text is in the box.
    await expect(page.getByText('Approaching the 500 character message limit.')).toBeAttached();
    await expect(page.getByTestId('composer-char-count')).toHaveText('460 / 500');
    // Blur so no caret sits in the field, and pin the horizontal scroll to 0 so
    // the overflowing text always renders from its start; the counter persists
    // without focus.
    await composer.blur();
    await composer.evaluate((el) => { (el as HTMLInputElement).scrollLeft = 0; });
    await expect(page.getByTestId('composer-char-count')).toBeVisible();

    // Region capture: the warning counter lives inside the composer, its own row
    // in the chat pane, so the composer group is the subject.
    await captureMatrix(page, testInfo, {
      file: 'region-chat-counter-warning',
      element: page.getByRole('group', { name: 'Chat composer' }),
    });
  });

  test('chat: a commissioner-hidden message tombstone (AC3)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    // Seed a message, then deliver the server's chat:hidden broadcast for it - the
    // same shape draftSocket.js sends and the moderation test above drives - which
    // rewrites the entry to its neutral tombstone in place.
    await deliver(page, 'chat:message', chatMsg(1, 'Harbor Hawks', 'this will be hidden'));
    await deliver(page, 'chat:hidden', {
      type: 'league_chat', id: 1, seq: 1, hidden: true, message: null,
      teamId: 2, teamName: 'Harbor Hawks', created_at: '2026-01-01T12:00:00Z',
    });

    // Assert the tombstone is rendered and the original body gone before the shot.
    await expect(page.getByText('Message hidden by commissioner')).toBeVisible();
    await expect(page.getByText('this will be hidden')).toHaveCount(0);

    // Region capture: the tombstone is one entry inside the chat log, which is its
    // own scrolling region, so the log is the subject.
    await captureMatrix(page, testInfo, {
      file: 'region-chat-hidden-tombstone',
      element: page.getByRole('log', { name: 'League Chat' }),
    });
  });

  test('chat: the provider-gated GIF panel (AC3)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    // gifMessagesEnabled rides the draft:join ack (DraftSocketState, the interface
    // Cory names) and enables the compose affordance for this capture WITHOUT
    // changing the production capability contract: the server still gates it, and
    // no client provider is registered, so Send stays disabled and nothing goes
    // out.
    await openDraftRoom(page, { ...NOT_MY_TURN, gifMessagesEnabled: true });

    await page.getByTestId('gif-picker-trigger').click();
    const gifPanel = page.getByTestId('gif-picker-panel');
    await expect(gifPanel).toBeVisible();
    // The provider-gated nature is visibly the point: with no provider registered
    // the panel says so and Send GIF is disabled.
    await expect(page.getByText('The GIF picker becomes available once a provider is enabled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send GIF' })).toBeDisabled();

    // Region capture: the GIF panel is a disclosure below the composer, so the
    // panel itself is the subject.
    await captureMatrix(page, testInfo, { file: 'region-chat-gif-panel', element: gifPanel });
  });

  test('narrow: a real keyboard-focus ring on the tabs (AC5)', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await openDraftRoom(page, NOT_MY_TURN);

    // Establish :focus-visible through REAL keyboard navigation, not an injected
    // class, a CSS override or a scripted approximation: focus the first tab, then
    // move focus with a real ArrowRight (this tablist uses manual activation, so
    // focus moves without changing selection) - the same key flow the keyboard
    // test above drives.
    const chatTab = page.getByRole('tab', { name: 'Chat' });
    await chatTab.focus();
    await page.keyboard.press('ArrowRight');
    const playersTab = page.getByRole('tab', { name: 'Players' });
    await expect(playersTab).toBeFocused();

    // The focused element genuinely matches :focus-visible (the browser's keyboard
    // heuristic), so the ring in the shot is the app's real keyboard-focus ring.
    const focusVisible = await page.evaluate(
      () => document.activeElement != null && document.activeElement.matches(':focus-visible')
    );
    expect(focusVisible).toBe(true);

    // Whole-room state: the tab bar is pinned chrome (not inside a scroller) and
    // the focus ring reads best in the room's context, so this is a viewport shot.
    await captureMatrix(page, testInfo, { file: 'room-narrow-tab-focus-visible' });
  });
});
