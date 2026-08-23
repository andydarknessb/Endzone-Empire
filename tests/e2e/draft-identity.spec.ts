// Team identity across pending, active and complete drafts (issue #113,
// acceptance criterion 5, contract #112). Runs on the same deterministic,
// entirely offline harness issue #110 established: REST and Socket.IO are
// both supplied by tests/e2e/fixtures/*, so nothing here can reach a live
// league, the shared Supabase database, or the Tank01 API.
//
// These drive the real browser DOM rather than a component tree, so what they
// assert is what a manager would actually see. The heart of the ticket is a
// negative - no other manager's account identity may be rendered by a Draft
// surface - and this file can make that assertion honestly: FIXTURE_USER's
// username is 'harness-manager', the rival manager has no account in the
// fixtures at all, and before this migration the on-the-clock chip printed
// the former in parentheses after the Team name.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  gotoDraft,
  VIEWPORTS,
} from './fixtures/draftHarness';
import type { Page } from '@playwright/test';
import {
  PENDING_STATE,
  ACTIVE_STATE,
  COMPLETE_STATE,
  ACTIVE_PICKS,
  COMPLETE_PICKS_WITH_NULL_TEAM,
  FIXTURE_USER,
} from './fixtures/draftFixtures';

test.describe('Team identity', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  /** Nothing on the rendered page names a manager by account. */
  const expectNoAccountIdentity = async (page: Page) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(FIXTURE_USER.username);
    // An email would be the other account identifier a surface could leak.
    expect(body).not.toContain('@');
    // A Team the surface failed to resolve would print one of these instead
    // of a name, which is the failure mode a blank-looking label hides.
    expect(body).not.toContain('undefined');
    expect(body).not.toMatch(/\bnull\b/);
  };

  test('pending: Readiness and Draft order name Teams, and the viewer is found by Team', async ({ page }) => {
    await installDraftSocketHarness(page, PENDING_STATE);
    await installDraftRestApi(page, { league: PENDING_STATE.league, picks: [] });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    // Readiness counts every Team and names each one (CONTEXT.md: Readiness;
    // the not-yet-ready group is Not ready).
    const readiness = page.getByRole('region', { name: 'Draft readiness' });
    await expect(readiness).toBeVisible();
    await expect(readiness.getByText('Ridge Runners: Not ready')).toBeVisible();
    await expect(readiness.getByText('Harbor Hawks: Not ready')).toBeVisible();
    await expect(readiness.getByText('0 of 2 managers ready')).toBeVisible();

    // That panel renders at all only because the viewer was matched to a
    // Team, and the only place this harness supplies one is the draft:join
    // acknowledgement: it is on none of the broadcast payloads.
    await expect(page.getByRole('checkbox', { name: 'I am ready for the draft' })).toBeVisible();

    // Draft order names Teams in slot order (CONTEXT.md: Draft order).
    const order = page.getByRole('region', { name: 'Draft Order' });
    await expect(order.getByText('Ridge Runners')).toBeVisible();
    await expect(order.getByText('Harbor Hawks')).toBeVisible();

    await expectNoAccountIdentity(page);
  });

  test('active: On the clock, Pick attribution and Pick history all speak Team', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_STATE);
    await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    // On-the-clock state, in both places it is shown.
    await expect(page.getByText('On the clock: Ridge Runners')).toBeVisible();
    await expect(page.getByText('Your pick!')).toBeVisible();

    // Pick attribution: the fixture's one Pick belongs to the OTHER Team and
    // was already on the board when the room opened. Before the contract
    // landed, a snapshot Pick carried no attribution at all, because a Pick's
    // own `name` is the PLAYER's.
    await expect(page.getByText('by Harbor Hawks')).toBeVisible();

    await expectNoAccountIdentity(page);
  });

  test('active: a viewer holding another Team is not the one on the clock', async ({ page }) => {
    // The same broadcast snapshot, a different acknowledgement. Nothing about
    // the draft:state payload changes between this test and the one above,
    // which is exactly the property that makes viewerTeamId safe to keep off
    // it: one payload, N recipients, N different answers to "is that me".
    await installDraftSocketHarness(page, { ...ACTIVE_STATE, viewerTeamId: 2 });
    await installDraftRestApi(page, {
      league: ACTIVE_STATE.league,
      picks: ACTIVE_PICKS,
      myTeamId: 2,
    });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    await expect(page.getByText('On the clock: Ridge Runners')).toBeVisible();
    await expect(page.getByText('Ridge Runners is on the clock')).toBeVisible();
    await expect(page.getByText('Your pick!')).toHaveCount(0);

    await expectNoAccountIdentity(page);
  });

  test('complete: the Board is a read-only record of Teams', async ({ page }) => {
    await installDraftSocketHarness(page, COMPLETE_STATE);
    await installDraftRestApi(page, { league: COMPLETE_STATE.league, picks: COMPLETE_STATE.picks });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    // The board's columns are the Teams, and every filled cell names its
    // round, its Team and its player.
    await page.getByRole('tab', { name: 'Board' }).click();
    const board = page.getByRole('region', { name: 'Draft Board' });
    await expect(board.getByRole('columnheader', { name: /Ridge Runners/ })).toBeVisible();
    await expect(board.getByRole('columnheader', { name: /Harbor Hawks/ })).toBeVisible();
    await expect(
      board.getByRole('button', { name: 'Round 1 pick 1, Harbor Hawks: Bijan Robinson' })
    ).toBeVisible();

    await expectNoAccountIdentity(page);
  });

  test('complete: a Pick with no Team identity reads as a former manager', async ({ page }) => {
    // The rendering rule, not a payload the server produces today: the
    // contract lets any LEFT-joined Team identity read back null, but a
    // Pick's cannot, because draft_picks.team_id is NOT NULL and cascades, so
    // removing a team removes its picks rather than orphaning them. Either
    // way a null is named rather than left blank or printed as "null".
    const state = { ...COMPLETE_STATE, picks: COMPLETE_PICKS_WITH_NULL_TEAM };
    await installDraftSocketHarness(page, state);
    await installDraftRestApi(page, { league: state.league, picks: state.picks });
    await gotoDraft(page);
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    await expect(page.getByText('by Former manager')).toBeVisible();
    await expectNoAccountIdentity(page);
  });
});
