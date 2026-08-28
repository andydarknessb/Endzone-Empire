// Presenter-session browser evidence (issue #447 AC2, the known harness gap).
//
// The anonymous presenter board (/#/present/:token, src/components/DraftPresenter)
// is the one Draft-room surface no tests/e2e spec exercised. It is a share-link
// page with NO account: DraftPresenter uses a bare axios client (never apiClient),
// polls two public endpoints, and renders a read-only board with no chat, no
// composer and no commissioner controls (server allowlist in draft.router.js,
// component in DraftPresenter.jsx).
//
// This spec drives that page through real HTTP on the mocked origin and asserts
// the three member-only surfaces are ABSENT BY ROLE QUERY. An absence assertion
// with no control is the commonest way to ship a test that cannot fail: if the
// query is wrong, or the page never loaded, or the selector is stale, "absent"
// is exactly what you observe. So the LAST describe here is the POSITIVE CONTROL
// Cory names: the SAME role queries, run against a member commissioner session,
// where every one of them must FIND its element. That is what separates
// "correctly absent" from "never looked".
//
// The presenter page is anonymous, so this file does NOT use installDraftRestApi
// (its route table is for the authenticated room); it routes the two presenter
// endpoints plus the logged-out /api/user + refresh the app boot attempts, and
// nothing else is requested because no Nav is mounted on the presenter route.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
  type ExpectConsoleError,
} from './fixtures/draftHarness';
import type { Page, Route } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

// The presenter surface is DELIBERATELY anonymous, so /api/user and the token
// refresh answer 401 - the correct response for a logged-out share-link visitor.
// The browser logs each 401 as a "Failed to load resource" console error.
//
// This fixture USED to carry a broad `/Failed to load resource/` ignore. That is
// exactly the per-test blanket ignore #541 exists to remove: it also swallowed
// any UNINTENDED failed resource (a 404, a broken asset, a CDN timeout), so the
// presenter had no way to tell an expected 401 from a real regression. It now
// extends the shared harness `test`, so each presenter test DECLARES its expected
// 401s by status AND endpoint through `expectConsoleError` (see
// declarePresenterBootErrors below), and every other console error - and every
// uncaught page error - still fails teardown. Route-level rigour against
// unexpected endpoints is kept here per page, mirroring the shared harness's own
// unmockedByPage WeakMap (draftHarness.ts) so nothing bleeds between tests.
const unexpectedByPage = new WeakMap<Page, string[]>();
const presenterTest = test.extend<{}>({
  page: async ({ page }, use) => {
    const recordedUnexpected: string[] = [];
    unexpectedByPage.set(page, recordedUnexpected);
    await use(page);
    unexpectedByPage.delete(page);
    expect(
      recordedUnexpected,
      `the presenter page requested endpoints this spec does not mock:\n${recordedUnexpected.join('\n')}`
    ).toEqual([]);
  },
});

// The anonymous shell boot, declared on the shared contract: apiClient dispatches
// GET /api/user (401, no session), and its 401 interceptor then attempts
// POST /api/auth/refresh (also 401, retried once). Both are the correct
// logged-out response, so each is declared by its status and endpoint - never a
// blanket "Failed to load resource" - and each MUST fire or teardown fails.
function declarePresenterBootErrors(expectConsoleError: ExpectConsoleError) {
  expectConsoleError.resourceError({
    status: 401,
    url: /\/api\/user$/,
    because: 'anonymous presenter boot: no session, GET /api/user answers 401 (#447)',
  });
  expectConsoleError.resourceError({
    status: 401,
    url: /\/api\/auth\/refresh$/,
    because: 'anonymous presenter boot: the 401 interceptor attempts a refresh, also 401 (#447)',
  });
}

// The presenter board payload, shaped exactly as draft.router.js's allowlist
// serialises it (PUBLIC_LEAGUE_FIELDS / PUBLIC_TEAM_FIELDS / PUBLIC_PICK_FIELDS):
// Team identity only, never an account - because that is what the server sends
// an anonymous viewer. That also means the DOM privacy assertion below is a
// rendered-surface CONFIRMATION, not the pin: the client has no account
// identifier available to render, so it could not fail even if the allowlist
// leaked. The falsifiable proof that the allowlist STRIPS account fields is the
// server test server/test/draftPresenterBoard.test.js (:224 no account identity
// anywhere in the response; :274 no chat/tombstone), which feeds the serializer
// WIDER-than-contract rows carrying owner_id/username/email and asserts they are
// gone. This spec's job is the absence-by-role of chat/composer/controls, with
// the member positive control below.
const PRESENTER_BOARD = {
  league: {
    name: 'Harness League',
    draft_status: 'active',
    draft_paused: false,
    pick_deadline_at: null,
    draft_rounds: null,
    roster_limit: 13,
    ir_slots: 1,
  },
  teams: [
    { teamId: 1, teamName: 'Ridge Runners', draft_position: 1 },
    { teamId: 2, teamName: 'Harbor Hawks', draft_position: 2 },
  ],
  picks: [
    {
      pick_number: 1,
      teamId: 2,
      teamName: 'Harbor Hawks',
      is_keeper: false,
      player_id: 6,
      name: 'Josh Allen',
      position: 'QB',
      nfl_team: 'BUF',
    },
  ],
  onTheClock: { teamId: 1, teamName: 'Ridge Runners', draft_position: 1 },
};

// The presenter-safe Draft-activity feed (listPresenterDraftActivity): Team-only
// Pick and lifecycle facts, each with a distinct `seq` so feedEntryKey gives the
// list stable, unique React keys (a duplicate-key warning is a console.error the
// harness fails on, so this is load-bearing, not decoration).
const PRESENTER_ACTIVITY = [
  {
    kind: 'pick',
    seq: 1,
    teamName: 'Harbor Hawks',
    player: { name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' },
    round: 1,
    pickNumber: 1,
    isAutopick: false,
    created_at: '2026-08-01T17:00:00.000Z',
  },
];

async function installPresenterRoutes(
  page: Page,
  { board, activity }: { board: unknown; activity: unknown }
) {
  const reply = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // A logged-out visitor with a share link: the app boot dispatches FETCH_USER
    // (GET /api/user), and apiClient's 401 interceptor then attempts a token
    // refresh (POST /api/auth/refresh, retried once). Both 401, exactly as they
    // do for an anonymous visitor - no session is ever established.
    if (method === 'GET' && path === '/api/user') return reply(route, 401, { error: 'unauthorized' });
    if (method === 'POST' && path === '/api/auth/refresh') return reply(route, 401, { error: 'unauthorized' });

    // The two presenter endpoints. Activity is matched before the board so the
    // longer path wins.
    if (method === 'GET' && /\/api\/draft\/board\/[^/]+\/activity$/.test(path)) {
      return reply(route, 200, activity);
    }
    if (method === 'GET' && /\/api\/draft\/board\/[^/]+$/.test(path)) {
      return reply(route, 200, board);
    }

    // Nothing else should be requested on the presenter route (no Nav is
    // mounted). Record it against this page so the teardown fails by name, and
    // fail the request loudly rather than reaching a real network.
    (unexpectedByPage.get(page) || []).push(`${method} ${path}`);
    return reply(route, 500, { error: `unexpected presenter request: ${method} ${path}` });
  });
}

async function gotoPresenter(page: Page, token: string) {
  await page.goto(`/#/present/${token}`);
}

presenterTest.describe('presenter session: member surfaces are absent by role query (#447 AC2)', () => {
  presenterTest.use({ viewport: VIEWPORTS.desktop });

  presenterTest('chat, composer and commissioner controls are absent on the presenter board', async ({ page, expectConsoleError }) => {
    declarePresenterBootErrors(expectConsoleError);
    await setTheme(page, 'light');
    await installPresenterRoutes(page, { board: PRESENTER_BOARD, activity: PRESENTER_ACTIVITY });
    await gotoPresenter(page, 'share-token-abc');

    // The board DID load - the presenter surfaces it is supposed to have are
    // present - so an absence below is a real "not here", not a blank page. (The
    // member positive control at the bottom is the primary guard on the queries.)
    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Draft activity' })).toBeVisible();
    await expect(page.getByText('Ridge Runners is on the clock')).toBeVisible();

    // ABSENT BY ROLE QUERY. These are the exact locators the positive control
    // proves can FIND their elements in a member session.
    await expect(page.getByRole('log', { name: 'League Chat' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Chat composer' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Commissioner draft controls' })).toHaveCount(0);
  });

  presenterTest('the presenter board renders Team identity only, no account identifier (AC3 privacy seam)', async ({ page, expectConsoleError }) => {
    declarePresenterBootErrors(expectConsoleError);
    await setTheme(page, 'light');
    await installPresenterRoutes(page, { board: PRESENTER_BOARD, activity: PRESENTER_ACTIVITY });
    await gotoPresenter(page, 'share-token-abc');

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    // Team identity IS shown...
    await expect(page.getByText('Ridge Runners is on the clock')).toBeVisible();
    // ...and no account identity is anywhere on the rendered board. (The server
    // allowlist is pinned by server/test/draftPresenterBoard.test.js; this is the
    // rendered-surface confirmation that nothing account-shaped reaches the DOM.)
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('@');
    expect(body).not.toContain('harness-manager'); // FIXTURE_USER.username
  });
});

test.describe('presenter positive control: the same queries FIND the surfaces in a member session (#447 AC2 control)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('a member commissioner session has the chat log, composer and controls those queries look for', async ({ page }) => {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, { ...ACTIVE_STATE, isCommissioner: true });
    await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();

    // The IDENTICAL locators asserted absent on the presenter, now expected
    // present. If any of these could not find its element here, "absent on the
    // presenter" would prove nothing.
    await expect(page.getByRole('log', { name: 'League Chat' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Chat composer' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Commissioner draft controls' })).toBeVisible();
  });
});
