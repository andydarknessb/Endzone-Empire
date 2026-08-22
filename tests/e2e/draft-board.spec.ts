// Deterministic DraftBoard browser acceptance harness (issue #110, parent
// spec #108). Establishes one controlled, offline seam for the authenticated
// HashRouter Draft route: REST and Socket.IO state are entirely supplied by
// tests/e2e/fixtures/*, so nothing here can ever reach a live league, the
// shared Supabase database, or the Tank01 API. Every test also automatically
// fails on a browser console error or an uncaught page error (see the
// extended `test` in fixtures/draftHarness.ts).
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  VIEWPORTS,
  type DraftApiHandle,
} from './fixtures/draftHarness';
import type { Page, Locator } from '@playwright/test';
import {
  PENDING_STATE,
  ACTIVE_STATE,
  COMPLETE_STATE,
  ACTIVE_NOT_MY_TURN_STATE,
  ACTIVE_PAUSED_STATE,
  ACTIVE_AUTOPICK_STATE,
  ACTIVE_OFFLINE_STATE,
  ACTIVE_PICKS,
  FIXTURE_PLAYERS,
  FIXTURE_TEAMS,
  buildLeague,
} from './fixtures/draftFixtures';

async function setupActiveDraft(page: Page): Promise<DraftApiHandle> {
  await installDraftSocketHarness(page, ACTIVE_STATE);
  const api = await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.getByText('Bijan Robinson')).toBeVisible();
  return api;
}

// --- Acceptance criterion (1): pending / active / complete fixtures load ---

test.describe('draft status fixtures', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('loads the pending draft under a fully controlled fixture', async ({ page }) => {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, PENDING_STATE);
    await installDraftRestApi(page, { league: PENDING_STATE.league, picks: [] });

    await gotoDraft(page);

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    await expect(page.getByText('pending', { exact: true })).toBeVisible();
    await expect(page.getByText('No picks yet')).toBeVisible();
    // No draft has happened yet - every fixture player is still available.
    for (const player of FIXTURE_PLAYERS) {
      await expect(page.getByRole('button', { name: player.name })).toBeVisible();
    }
  });

  test('loads the active draft under a fully controlled fixture', async ({ page }) => {
    await setTheme(page, 'light');
    await setupActiveDraft(page);

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    await expect(page.getByText('On the clock: Ridge Runners (harness-manager)')).toBeVisible();
    // Josh Allen was drafted in the fixture and hide-drafted defaults on, so
    // he's gone from the available-players pool - but not from pick history,
    // where his name is also a quick-view button, so this must be scoped to
    // the pool table specifically.
    await expect(page.locator('table').getByRole('button', { name: 'Josh Allen' })).toHaveCount(0);
  });

  test('loads the complete draft under a fully controlled fixture', async ({ page }) => {
    await setTheme(page, 'light');
    await installDraftSocketHarness(page, COMPLETE_STATE);
    await installDraftRestApi(page, { league: COMPLETE_STATE.league, picks: COMPLETE_STATE.picks });

    await gotoDraft(page);

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    await expect(page.getByText('complete', { exact: true })).toBeVisible();
    // Every fixture player was drafted; the pool is empty with the default
    // hide-drafted filter on.
    await expect(page.getByText('No available players')).toBeVisible();
  });
});

// --- Acceptance criterion (3): desktop/mobile viewports, light/dark themes ---

test.describe('viewport and theme selection', () => {
  test('renders the draft route at a mobile viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await setTheme(page, 'light');
    await setupActiveDraft(page);

    await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
    // Below the medium breakpoint (issue #122), the Grid `order` swap is gone
    // - Players/Board/Draft are three persistent tabs, one region at a time,
    // landing on Players by default.
    await expect(page.getByRole('tab', { name: 'Players' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Draft' })).toBeVisible();
    await expect(page.getByText('Bijan Robinson')).toBeVisible();
    await expect(page.getByText('My Queue')).toHaveCount(0);
  });

  test('renders the draft route under the dark theme', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await setTheme(page, 'dark');
    await setupActiveDraft(page);

    // AppThemeProvider derives the MUI/CssBaseline background from the same
    // dark-mode token DraftBoard.test.jsx and tokens.js pin at #0f1419.
    const bodyBackground = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bodyBackground).toBe('rgb(15, 20, 25)');
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });
});

// --- Acceptance criterion (2): everything stays on the mocked origin ---

test('never issues a request to a host other than the mocked app origin', async ({ page, baseURL }) => {
  const foreignRequests: string[] = [];
  page.on('request', (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== new URL(baseURL || 'http://127.0.0.1:4173').origin) foreignRequests.push(request.url());
  });

  await setTheme(page, 'light');
  await setupActiveDraft(page);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByRole('columnheader', { name: 'Rd' })).toBeVisible();

  expect(foreignRequests).toEqual([]);
});

// --- Acceptance criterion (4): existing sorting/filtering/Queue/Hide/QuickView/Board ---

test.describe('existing draft behavior baseline (active fixture)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  test('sorts the player pool by name', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByText('Name', { exact: true }).click();

    // The Name column is the first cell (issue #119 removed the leading
    // render-index column).
    const names = await page.locator('table tbody tr td:nth-child(1) button').allTextContents();
    expect(names).toEqual([
      'Amon-Ra St. Brown',
      'Bijan Robinson',
      'Christian McCaffrey',
      "Ja'Marr Chase",
      'Justin Jefferson',
      'Patrick Mahomes',
      'Travis Kelce',
    ]);
  });

  test('sorts the player pool descending while keeping missing values last', async ({ page }) => {
    // A regression case for the harness's own sort simulation: a naive
    // "sort ascending nulls-last, then .reverse() for desc" implementation
    // flips the nulls to the front on a descending sort. This asserts the
    // fix - nulls stay last in both directions.
    const players = [
      { id: 101, name: 'Alpha Prospect', position: 'RB', nfl_team: 'ATL', adp: 4.0, position_rank: 5, projected_points: 120.0, bye_week: 9 },
      { id: 102, name: 'Beta Prospect', position: 'RB', nfl_team: 'DAL', adp: 2.0, position_rank: 3, projected_points: 140.0, bye_week: 7 },
      { id: 103, name: 'Undrafted Rookie', position: 'RB', nfl_team: 'NYJ', adp: null, position_rank: null, projected_points: null, bye_week: null },
    ];
    const league = buildLeague({ draft_status: 'active' });
    await installDraftSocketHarness(page, { league, teams: FIXTURE_TEAMS, picks: [], onTheClock: FIXTURE_TEAMS[0] });
    await installDraftRestApi(page, { league, picks: [], players });
    await gotoDraft(page);
    await expect(page.getByRole('button', { name: 'Alpha Prospect' })).toBeVisible();

    // Default sort is already ADP ascending; one click on the active column
    // toggles it to descending. Scoped to the column header's accessible
    // name (an AbbreviationTooltip button), not `getByText('ADP')` - other
    // page text matches that substring too.
    await page.getByRole('button', { name: /^ADP:/ }).click();

    const names = await page.locator('table tbody tr td:nth-child(1) button').allTextContents();
    expect(names).toEqual(['Alpha Prospect', 'Beta Prospect', 'Undrafted Rookie']);
  });

  test('filters the player pool by position', async ({ page }) => {
    await setupActiveDraft(page);

    // Not `getByLabel('Position')`: the ADP/Pos-rank column header tooltips
    // also carry an aria-label containing the substring "Position".
    await page.getByRole('combobox', { name: 'Position', exact: true }).click();
    await page.getByRole('option', { name: 'WR', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Amon-Ra St. Brown' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Justin Jefferson' })).toBeVisible();
    await expect(page.getByRole('button', { name: "Ja'Marr Chase" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bijan Robinson' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Patrick Mahomes' })).toHaveCount(0);
  });

  test('filters the player pool by search text', async ({ page }) => {
    await setupActiveDraft(page);

    // Not `getByLabel('Search')`: the Nav bar's global player search is
    // labelled "Search players", which also contains the substring "Search".
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('kelce');
    await page.waitForTimeout(400); // usePlayerPool debounces the search box by 300ms

    await expect(page.getByRole('button', { name: 'Travis Kelce' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bijan Robinson' })).toHaveCount(0);
  });

  test('hide drafted toggles whether an already-picked player is shown', async ({ page }) => {
    await setupActiveDraft(page);

    const poolTable = page.locator('table');
    await expect(poolTable.getByRole('button', { name: 'Josh Allen' })).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Hide drafted' }).click();

    const joshAllenRow = poolTable.getByRole('button', { name: 'Josh Allen' }).locator('xpath=ancestor::tr');
    await expect(joshAllenRow).toBeVisible();
    await expect(joshAllenRow.getByText('Drafted')).toBeVisible();
    // An already-drafted row has nothing left to Pick or Queue: both actions
    // are hidden entirely rather than shown disabled (#120 acceptance
    // criterion 5).
    await expect(joshAllenRow.getByRole('button', { name: 'Draft' })).toHaveCount(0);
    await expect(joshAllenRow.getByRole('button', { name: 'Queue' })).toHaveCount(0);
  });

  test('queues a player, then reorders and removes from the queue', async ({ page }) => {
    const api = await setupActiveDraft(page);

    // Scoped to `<button aria-label="Queue">`: MUI's Tooltip wrapper span
    // also exposes an aria-label of "Queue" on disabled-button rows, so
    // `getByLabel` alone matches two elements per row.
    await page.locator('tr', { hasText: 'Bijan Robinson' }).getByRole('button', { name: 'Queue' }).click();
    await page.locator('tr', { hasText: 'Justin Jefferson' }).getByRole('button', { name: 'Queue' }).click();

    await expect.poll(() => api.queueWrites.length).toBeGreaterThanOrEqual(2);
    const queuePanel = page.getByText('My Queue').locator('xpath=ancestor::*[contains(@class, "MuiPaper-root")][1]');
    await expect(queuePanel.getByRole('button', { name: 'Bijan Robinson' })).toBeVisible();
    await expect(queuePanel.getByRole('button', { name: 'Justin Jefferson' })).toBeVisible();

    await page.getByRole('button', { name: 'Move up' }).last().click();
    await expect.poll(() => api.queueWrites.at(-1)?.playerIds).toEqual([2, 1]);

    await page.getByRole('button', { name: 'Remove from queue' }).first().click();
    await expect.poll(() => api.queueWrites.at(-1)?.playerIds).toEqual([1]);
  });

  test('opens Quick View for a player without drafting them', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByRole('button', { name: 'Bijan Robinson' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Bijan Robinson' })).toBeVisible();
    await expect(dialog.getByText('RB')).toBeVisible();
    await expect(dialog.getByText('ATL')).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('switches to the Board tab and shows the team-by-round matrix', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByRole('tab', { name: 'Board' }).click();

    await expect(page.getByRole('columnheader', { name: 'Ridge Runners' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Harbor Hawks' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Round 1 pick 1, Harbor Hawks: Josh Allen/ })).toBeVisible();
  });
});

// --- Schedule-aware, truthful available-player pool (issue #119, parent #108) ---

test.describe('schedule-aware player pool (issue #119)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  test('the final columns are exactly Name/Position/NFL Team/Bye/ADP/Pos rank/17-game pace/Actions', async ({ page }) => {
    await setupActiveDraft(page);

    const headers = (await page.getByRole('columnheader').allTextContents()).map((h) => h.trim());
    expect(headers).toEqual([
      'Name', 'Position', 'NFL Team', 'Bye', 'ADP', 'Pos rank', '17-game pace', 'Actions',
    ]);
    // Render index, Draft value, and Tier are all absent.
    await expect(page.getByText('Draft value')).toHaveCount(0);
    await expect(page.getByText('Tier', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Season Proj')).toHaveCount(0);
  });

  test('sorts by NFL Team across the full pool before pagination', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByText('NFL Team', { exact: true }).click();

    const teams = await page.locator('table tbody tr td:nth-child(3)').allTextContents();
    expect(teams).toEqual([...teams].sort());
  });

  test('sorts by Bye with deterministic null-last behavior in both directions', async ({ page }) => {
    const players = [
      { id: 201, name: 'Early Bye', position: 'RB', nfl_team: 'DAL', adp: 4.0, position_rank: 5, projected_points: 120.0, bye_week: 6 },
      { id: 202, name: 'Late Bye', position: 'RB', nfl_team: 'ATL', adp: 2.0, position_rank: 3, projected_points: 140.0, bye_week: 12 },
      { id: 203, name: 'Unknown Bye', position: 'RB', nfl_team: 'NYJ', adp: 1.0, position_rank: 1, projected_points: 150.0, bye_week: null },
    ];
    const league = buildLeague({ draft_status: 'active' });
    await installDraftSocketHarness(page, { league, teams: FIXTURE_TEAMS, picks: [], onTheClock: FIXTURE_TEAMS[0] });
    await installDraftRestApi(page, { league, picks: [], players });
    await gotoDraft(page);
    await expect(page.getByRole('button', { name: 'Early Bye' })).toBeVisible();

    await page.getByRole('button', { name: /^Bye:/ }).click();
    await expect(page.locator('table tbody tr td:nth-child(1) button')).toHaveText([
      'Early Bye', 'Late Bye', 'Unknown Bye',
    ]);

    await page.getByRole('button', { name: /^Bye:/ }).click(); // toggle to descending
    await expect(page.locator('table tbody tr td:nth-child(1) button')).toHaveText([
      'Late Bye', 'Early Bye', 'Unknown Bye', // the unknown Bye stays last either direction
    ]);
  });

  test('the Bye-weeks multi-select filters the full pool and renders a removable chip', async ({ page }) => {
    await setupActiveDraft(page);

    // Patrick Mahomes and Travis Kelce (both KC) share Bye 10; nobody else does.
    // Not `getByLabel('Bye week')`: the Bye column header's AbbreviationTooltip
    // aria-label ("Bye: Bye week: ...") also contains that substring.
    await page.getByRole('combobox', { name: 'Bye week' }).click();
    await page.getByRole('option', { name: 'Week 10' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: 'Patrick Mahomes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Travis Kelce' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bijan Robinson' })).toHaveCount(0);
    await expect(page.getByText('Bye 10')).toBeVisible(); // the removable-chip rendering of the selection
  });

  test('shows a neutral Bye overlap hint against the caller\'s own roster', async ({ page }) => {
    // The harness viewer's own team (Ridge Runners, team 1) already holds
    // Travis Kelce (KC, Bye 10); Patrick Mahomes (also KC, Bye 10) is still
    // available and should surface the overlap.
    const picks = [
      { pick_number: 1, team_id: 1, player_id: 5, name: 'Travis Kelce', position: 'TE', nfl_team: 'KC' },
    ];
    const league = buildLeague({ draft_status: 'active' });
    await installDraftSocketHarness(page, { league, teams: FIXTURE_TEAMS, picks, onTheClock: FIXTURE_TEAMS[0] });
    await installDraftRestApi(page, { league, picks });
    await gotoDraft(page);

    const mahomesRow = page.locator('tr', { hasText: 'Patrick Mahomes' });
    await expect(mahomesRow).toBeVisible();
    const overlapHint = mahomesRow.getByLabel(/Bye overlap: 1 rostered player.*Travis Kelce/);
    await expect(overlapHint).toBeVisible();
    // Neutral: no harm/severity language anywhere in the hint.
    expect(await overlapHint.getAttribute('aria-label')).not.toMatch(/conflict|risk|warning/i);
  });

  test('a keyboard-reachable Column guide explains abbreviations and injury-status codes', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByRole('button', { name: 'Column guide' }).focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('17-game pace')).toBeVisible();
    await expect(dialog.getByText('Injured Reserve')).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});

// --- Unambiguous Draft time (issue #117, parent #108) ----------------------
//
// A fixed, far-future instant so the pending Countdown is always well past
// 24h out (the fixture-controlled "days" tier) regardless of when this suite
// actually runs. 2099-09-03T18:00:00Z is a Thursday.
const FUTURE_DRAFT_ISO = '2099-09-03T18:00:00.000Z';

async function setupPendingSchedule(page: Page, timezoneOverride: string | null = null) {
  const league = buildLeague({
    draft_status: 'pending',
    draft_date: FUTURE_DRAFT_ISO,
    draft_timezone: timezoneOverride,
  });
  await installDraftSocketHarness(page, {
    league, teams: FIXTURE_TEAMS.map((t) => ({ ...t, draft_ready: false })), picks: [], onTheClock: null,
  });
  await installDraftRestApi(page, { league, picks: [] });
  await gotoDraft(page);
  await expect(page.getByText(/^Draft in/)).toBeVisible();
  return league;
}

test.describe('unambiguous Draft time - viewer in America/New_York (#117 AC1)', () => {
  test.use({ viewport: VIEWPORTS.desktop, timezoneId: 'America/New_York' });

  test('the primary schedule is short weekday, no seconds, with an explicit viewer zone abbreviation', async ({ page }) => {
    await setTheme(page, 'light');
    await setupPendingSchedule(page);

    await expect(page.getByText('· Thu, Sep 3, 2:00 PM EDT')).toBeVisible();
  });
});

test.describe('unambiguous Draft time - viewer in Asia/Tokyo (#117 AC1)', () => {
  test.use({ viewport: VIEWPORTS.desktop, timezoneId: 'Asia/Tokyo' });

  test('a different viewer time zone reads a different wall time for the same instant', async ({ page }) => {
    await setTheme(page, 'light');
    await setupPendingSchedule(page);

    await expect(page.getByText(/^· Fri, Sep 4, 3:00 AM/)).toBeVisible();
  });
});

test.describe('unambiguous Draft time - league Draft time zone detail (#117 AC2)', () => {
  test.use({ viewport: VIEWPORTS.desktop, timezoneId: 'America/Chicago' });

  test('hover/tap detail names the league Draft time zone for the same instant', async ({ page }) => {
    await setTheme(page, 'light');
    await setupPendingSchedule(page, 'America/New_York');

    // The viewer (Chicago) and the league Draft zone (New York) read the
    // same instant differently - the detail names the league's zone
    // explicitly rather than repeating the viewer-local line above it.
    await expect(page.getByText('· Thu, Sep 3, 1:00 PM CDT')).toBeVisible();
    await expect(page.getByLabel('League draft time zone (America/New_York): Thu, Sep 3, 2:00 PM EDT')).toBeAttached();
  });

  test('falls back to UTC for a legacy schedule with no draft time zone confirmed', async ({ page }) => {
    await setTheme(page, 'light');
    await setupPendingSchedule(page, null);

    await expect(page.getByLabel('No draft time zone set - shown in UTC: Thu, Sep 3, 6:00 PM UTC')).toBeAttached();
  });
});

test.describe('unambiguous Draft time - calendar export and announcer structure (#117 AC3, AC6)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('downloads a .ics with a UTC start, stable UID, league title, and the authenticated route - no invented duration', async ({ page }) => {
    await setTheme(page, 'light');
    const league = await setupPendingSchedule(page, 'America/New_York');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Add to calendar' }).click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf-8');

    expect(text).toContain('DTSTART:20990903T180000Z');
    expect(text).toContain(`UID:draft-${league.id}@endzone-empire.app`);
    expect(text).toContain('SUMMARY:Harness League Draft');
    expect(text).toContain(`URL:${new URL(page.url()).origin}/#/league/${league.id}/draft`);
    expect(text).not.toMatch(/DTEND|DURATION/);
  });

  test('the visible ticker carries no live region of its own; a separate polite status region exists', async ({ page }) => {
    await setTheme(page, 'light');
    await setupPendingSchedule(page);

    const ticker = page.getByText(/^Draft in/);
    await expect(ticker).not.toHaveAttribute('aria-live');
    // Scoped to a sibling of the ticker: getByRole('status') alone also
    // matches DraftRail's unrelated "N of N managers ready" status region.
    const announcer = ticker.locator('xpath=following-sibling::*[@role="status"]');
    await expect(announcer).toBeAttached();
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
  });
});

// --- State-correct player actions, Pick-safe manual Draft (#120, parent #108) ---
// status (pending/active/complete) x type (snake/autopick/offline) x turn
// ownership x pause, exercised through the real browser DOM rather than
// jsdom - focus/hover-driven Tooltip text, aria-disabled vs the native
// disabled attribute, and the end-to-end confirm-then-commit flow.

test.describe('pick-safe player actions across draft state (issue #120)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  test('a pending draft exposes Queue but never a manual Draft control', async ({ page }) => {
    await installDraftSocketHarness(page, PENDING_STATE);
    await installDraftRestApi(page, { league: PENDING_STATE.league, picks: [] });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    // exact: true - the ADP column header's own sort button carries an
    // aria-label mentioning "Average draft position", a substring match
    // Playwright's default (non-exact) name matching would also catch.
    await expect(page.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0);
    await expect(
      page.locator('tr', { hasText: 'Bijan Robinson' }).getByRole('button', { name: 'Queue', exact: true })
    ).toBeVisible();
  });

  test('a complete draft never renders a manual Draft control, even for a player nobody claimed', async ({ page }) => {
    const players = [
      { id: 301, name: 'Leftover Waiver Guy', position: 'RB', nfl_team: 'NYJ', adp: null, position_rank: null, projected_points: null, bye_week: null },
    ];
    const league = buildLeague({ draft_status: 'complete' });
    await installDraftSocketHarness(page, { league, teams: FIXTURE_TEAMS, picks: [], onTheClock: null });
    await installDraftRestApi(page, { league, picks: [], players });
    await gotoDraft(page);
    await expect(page.getByRole('button', { name: 'Leftover Waiver Guy' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0);
    await expect(
      page.locator('tr', { hasText: 'Leftover Waiver Guy' }).getByRole('button', { name: 'Queue', exact: true })
    ).toBeVisible();
  });

  test('an autopick-type draft is read-only: no manual Draft control anywhere', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_AUTOPICK_STATE);
    await installDraftRestApi(page, { league: ACTIVE_AUTOPICK_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0);
    // Queue still exists - it just no longer has a manual override to reach
    // for, since autopick resolves every pick itself.
    await expect(
      page.locator('tr', { hasText: 'Bijan Robinson' }).getByRole('button', { name: 'Queue', exact: true })
    ).toBeVisible();
  });

  test('an offline-type draft never renders a manual Draft control from the row or Quick View', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_OFFLINE_STATE);
    await installDraftRestApi(page, { league: ACTIVE_OFFLINE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Bijan Robinson' }).first().click();
    const quickView = page.getByRole('dialog');
    await expect(quickView.getByRole('heading', { name: 'Bijan Robinson' })).toBeVisible();
    await expect(quickView.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0);
    await expect(quickView.getByRole('button', { name: 'Queue', exact: true })).toBeVisible();
  });

  test('off-turn, Draft stays focusable but aria-disabled with the shared explanation, and clicking is a no-op', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_NOT_MY_TURN_STATE);
    await installDraftRestApi(page, { league: ACTIVE_NOT_MY_TURN_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    const draftButton = page
      .locator('tr', { hasText: 'Bijan Robinson' })
      .getByRole('button', { name: 'Draft', exact: true });
    // Temporarily unavailable, not nonexistent: aria-disabled, not the
    // native disabled attribute - still focusable and reachable. (Not
    // toBeEnabled(): Playwright's actionability checks treat aria-disabled
    // the same as the native attribute, so this asserts the DOM directly.)
    await expect(draftButton).toHaveAttribute('aria-disabled', 'true');
    expect(await draftButton.evaluate((el) => el.hasAttribute('disabled'))).toBe(false);

    await draftButton.hover();
    await expect(
      page.getByText("You can only Pick when it's your turn and the draft isn't paused.")
    ).toBeVisible();

    // force: true - Playwright's own actionability checks already refuse to
    // click an aria-disabled element (proving it's inert to a real pointer
    // user on its own), so bypass them here to exercise the app's own
    // suppressed-activation guard specifically.
    await draftButton.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a paused draft shows the exact same shared explanation as off-turn, not a different reason string', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_PAUSED_STATE);
    await installDraftRestApi(page, { league: ACTIVE_PAUSED_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    await expect(page.getByText('Bijan Robinson')).toBeVisible();

    const draftButton = page
      .locator('tr', { hasText: 'Bijan Robinson' })
      .getByRole('button', { name: 'Draft', exact: true });
    await expect(draftButton).toHaveAttribute('aria-disabled', 'true');

    await draftButton.hover();
    await expect(
      page.getByText("You can only Pick when it's your turn and the draft isn't paused.")
    ).toBeVisible();
  });

  test('a manual Pick requires confirmation naming the player before it commits', async ({ page }) => {
    await setupActiveDraft(page);

    await page
      .locator('tr', { hasText: 'Bijan Robinson' })
      .getByRole('button', { name: 'Draft', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Draft Bijan Robinson?')).toBeVisible();
    await expect(dialog.getByText(/advances the draft for everyone right away/)).toBeVisible();

    // Canceling never commits.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Drafted Bijan Robinson!')).toHaveCount(0);

    // Confirming does.
    await page
      .locator('tr', { hasText: 'Bijan Robinson' })
      .getByRole('button', { name: 'Draft', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Draft Bijan Robinson' }).click();
    await expect(page.getByText('Drafted Bijan Robinson!')).toBeVisible();
  });

  test('Quick View exposes the same gated Draft action and confirmation as the row', async ({ page }) => {
    await setupActiveDraft(page);

    await page.getByRole('button', { name: 'Bijan Robinson' }).first().click();
    const quickView = page.getByRole('dialog');
    await expect(quickView.getByRole('heading', { name: 'Bijan Robinson' })).toBeVisible();

    await quickView.getByRole('button', { name: 'Draft', exact: true }).click();
    const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Draft Bijan Robinson?' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Draft Bijan Robinson' }).click();

    await expect(page.getByText('Drafted Bijan Robinson!')).toBeVisible();
  });
});

// --- Accessible structure (issue #121, parent spec #108) ---

test.describe('accessible structure: skip link, landmarks, headings', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  test('a visible-on-focus skip link is the first focusable element and targets the main landmark', async ({ page }) => {
    await setupActiveDraft(page);

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toHaveAttribute('href', '#draft-main-content');

    // Off-screen until focused (translated above the viewport).
    const before = await skipLink.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.y).toBeLessThan(-20);

    await skipLink.focus();
    await page.waitForTimeout(250); // CSS transition (transform 0.15s) settling
    const after = await skipLink.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(60);

    // It's genuinely first: nothing focusable precedes it in DOM order.
    const firstFocusableIsSkipLink = await page.evaluate(() => {
      const all = document.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]'
      );
      return all[0]?.textContent?.trim() === 'Skip to main content';
    });
    expect(firstFocusableIsSkipLink).toBe(true);

    // Activating it lands focus inside the main landmark's content.
    await page.keyboard.press('Enter');
    const main = page.getByRole('main');
    await expect(main).toHaveAttribute('id', 'draft-main-content');
  });

  test('exposes primary navigation, a named main landmark, and named panel regions', async ({ page }) => {
    await setupActiveDraft(page);

    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    expect(await main.getAttribute('aria-labelledby')).toBe('draft-league-name');

    await expect(page.getByRole('region', { name: 'Available Players' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'My Queue' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pick History' })).toBeVisible();

    // The Board tab swaps in a different named region - the panel set is not
    // a fixed count, and whichever one is showing is still correctly named.
    await page.getByRole('tab', { name: 'Board' }).click();
    await expect(page.getByRole('region', { name: 'Draft Board' })).toBeVisible();
  });

  test('the league name is the single H1, panel titles are H2, with no skipped heading levels', async ({ page }) => {
    await setupActiveDraft(page);

    const h1s = page.getByRole('heading', { level: 1 });
    await expect(h1s).toHaveCount(1);
    await expect(h1s).toHaveText('Harness League');

    await expect(page.getByRole('heading', { level: 2, name: 'Available Players' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'My Queue' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Pick History' })).toBeVisible();

    const levels = await page.evaluate(() => (
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => Number(h.tagName[1]))
    ));
    const present = new Set(levels);
    const maxLevel = Math.max(...levels);
    for (let level = 1; level <= maxLevel; level += 1) {
      expect(present.has(level)).toBe(true);
    }
  });

  test('no positive tabindex exists anywhere - DOM order is tab order', async ({ page }) => {
    await setupActiveDraft(page);

    const hasPositiveTabIndex = await page.evaluate(() => (
      Array.from(document.querySelectorAll('[tabindex]')).some((el) => Number(el.getAttribute('tabindex')) > 0)
    ));
    expect(hasPositiveTabIndex).toBe(false);
  });

  test('tabbing through the page advances focus without getting stuck (no accidental focus trap)', async ({ page }) => {
    await setupActiveDraft(page);

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        // Distinguish same-label elements (e.g. two "Move up" buttons) by position.
        const rect = el.getBoundingClientRect();
        const label = el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || '';
        return `${el.tagName}:${label}:${Math.round(rect.x)},${Math.round(rect.y)}`;
      });
      if (id) seen.add(id);
    }
    // 20 real Tab presses should reach at least ~15 distinct elements - a
    // trap would repeatedly cycle a small subset (e.g. stuck inside one row).
    expect(seen.size).toBeGreaterThanOrEqual(15);
  });

  test('every interactive element shares the same focus-visible outline treatment', async ({ page }) => {
    await setupActiveDraft(page);

    // Real Tab presses (not a scripted .focus()) so both the browser's native
    // :focus-visible and MUI ButtonBase's own focus-visible polyfill actually
    // engage, exactly like a real keyboard user tabbing through the page:
    // the skip link, then Nav's brand/link/search/bell/theme controls -
    // enough of them to prove the shared token holds across that stretch
    // without needing to tab all the way into the (much longer) player pool.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const outlineColors = new Set<string>();
    for (let i = 0; i < 14; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop
      const style = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor };
      });
      if (style && style.outlineStyle !== 'none') outlineColors.add(style.outlineColor);
    }

    expect(outlineColors.size).toBeGreaterThan(0);
    const [sharedColor] = outlineColors;
    expect([...outlineColors]).toEqual([sharedColor]); // every visible ring so far is the SAME color

    // PlayerNameLink (issue #121 finding): a plain MUI `Link
    // component="button"`, not a ButtonBase - MuiButtonBase's
    // Mui-focusVisible override above never touches it, and Link bakes in
    // its own `outline: 0` / `outline: auto` rules that would otherwise win
    // over the global :focus-visible fallback. Confirms its explicit
    // override still resolves to the exact same token, not just a similar
    // color.
    const nameLink = page.getByRole('button', { name: 'Bijan Robinson' }).first();
    await nameLink.focus();
    const nameLinkOutline = await nameLink.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(nameLinkOutline).toBe(sharedColor);
  });
});

test.describe('accessible structure: 44x44 minimum interactive targets', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  async function expectAtLeast44(locator: Locator, opts: { widthToo?: boolean } = {}) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (opts.widthToo) expect(box!.width).toBeGreaterThanOrEqual(44);
  }

  test('desktop: nav chrome, tabs, sortable headers, and row actions all meet the 44px minimum', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await setupActiveDraft(page);

    await expectAtLeast44(page.getByRole('button', { name: 'Toggle theme' }), { widthToo: true });
    await expectAtLeast44(page.getByRole('button', { name: /notifications/i }), { widthToo: true });
    await expectAtLeast44(page.getByRole('tab', { name: 'Draft' }));
    await expectAtLeast44(page.getByRole('button', { name: /^Bye:/ }));
    await expectAtLeast44(page.getByRole('button', { name: 'Draft', exact: true }).first());
    await expectAtLeast44(page.locator('tr', { hasText: 'Bijan Robinson' }).getByRole('button', { name: 'Queue' }), { widthToo: true });
    await expectAtLeast44(page.getByRole('button', { name: 'Column guide' }), { widthToo: true });
  });

  test('mobile: the nav drawer trigger and its rows, plus card actions, meet the 44px minimum', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await setupActiveDraft(page);

    const hamburger = page.getByRole('button', { name: 'open navigation menu' });
    await expectAtLeast44(hamburger, { widthToo: true });
    await hamburger.click();
    await expectAtLeast44(page.getByRole('link', { name: 'League', exact: true }));
    await page.keyboard.press('Escape');

    await expectAtLeast44(page.getByRole('tab', { name: 'Board' }));
    // Mobile renders cards, not table rows (issue #122) - find the Queue
    // button inside Bijan Robinson's own card the same way the queue panel
    // is scoped elsewhere in this file.
    const card = page.getByRole('button', { name: 'Bijan Robinson' }).locator('xpath=ancestor::*[contains(@class, "MuiPaper-root")][1]');
    await expectAtLeast44(card.getByRole('button', { name: 'Queue' }), { widthToo: true });
  });
});

// --- Desktop dual-scroll shell / mobile tab-card layouts (issue #122, parent
// spec #108). A large pool and a long pick history so the two desktop
// regions actually overflow and there's something real to scroll. ---

function manyPlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    name: `Depth Player ${i + 1}`,
    position: 'WR',
    nfl_team: 'FA',
    adp: 50 + i,
    position_rank: 10 + i,
    projected_points: 100 - i,
    bye_week: (i % 14) + 1,
  }));
}

function manyPicks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    pick_number: i + 1,
    team_id: FIXTURE_TEAMS[i % 2].id,
    player_id: 900 + i,
    name: `Drafted Guy ${i + 1}`,
    position: 'RB',
    nfl_team: 'FA',
  }));
}

async function setupOverflowingDraft(page: Page) {
  const league = buildLeague({ draft_status: 'active' });
  const players = manyPlayers(40);
  const picks = manyPicks(20);
  await installDraftSocketHarness(page, { league, teams: FIXTURE_TEAMS, picks, onTheClock: FIXTURE_TEAMS[0] });
  await installDraftRestApi(page, { league, picks, players });
  await gotoDraft(page);
  await expect(page.getByText('Depth Player 1', { exact: true })).toBeVisible();
}

test.describe('desktop dual-scroll shell (issue #122 acceptance criteria 1-2)', () => {
  test.use({ viewport: VIEWPORTS.desktop });
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  test('the page itself does not scroll - the shell is exactly the viewport height', async ({ page }) => {
    await setupOverflowingDraft(page);

    const pageScrolls = await page.evaluate(() => (
      document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
    ));
    expect(pageScrolls).toBe(false);

    await expect(page.getByRole('region', { name: 'Available Players' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Draft rail' })).toBeVisible();
  });

  test('the players region scrolls independently, and its filter bar plus table header stay put', async ({ page }) => {
    await setupOverflowingDraft(page);

    const scrollRegion = page.getByTestId('players-scroll-region');
    const nameHeader = page.getByRole('columnheader', { name: 'Name' });
    const searchBox = page.getByRole('textbox', { name: 'Search', exact: true });
    await expect(nameHeader).toBeVisible();
    await expect(searchBox).toBeVisible();

    const before = await scrollRegion.evaluate((el) => el.scrollTop);
    await scrollRegion.hover();
    await page.mouse.wheel(0, 1500);
    const after = await scrollRegion.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(before);

    // The table header and the filter bar above it are still exactly where
    // they were - neither moved with the rows underneath them.
    await expect(nameHeader).toBeVisible();
    await expect(searchBox).toBeVisible();

    // Scrolling the players region never moved the page - the rail's own
    // content (a completely different scroll region) is untouched.
    await expect(page.getByRole('heading', { name: 'My Queue', level: 2 })).toBeVisible();
  });

  test('the Draft rail region scrolls independently of the players region', async ({ page }) => {
    await setupOverflowingDraft(page);

    const railRegion = page.getByRole('region', { name: 'Draft rail' });
    const before = await railRegion.evaluate((el) => el.scrollTop);
    await railRegion.hover();
    await page.mouse.wheel(0, 1500);
    const after = await railRegion.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(before);

    // Unaffected: the players table header is still visible and the pool
    // scroll position hasn't moved.
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    const playersScrollTop = await page.getByTestId('players-scroll-region').evaluate((el) => el.scrollTop);
    expect(playersScrollTop).toBe(0);
  });

  test('no Footer renders on the desktop Draft route - the shell owns the whole viewport', async ({ page }) => {
    await setupOverflowingDraft(page);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
  });
});

test.describe('mobile/tablet single-scroll tab layout (issue #122 acceptance criteria 3-6)', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
  });

  for (const [label, viewport] of [['mobile', VIEWPORTS.mobile], ['tablet', VIEWPORTS.tablet]] as const) {
    test(`${label}: no horizontal body overflow, and the page itself is the one scroll region`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setupOverflowingDraft(page);

      const horizontalOverflow = await page.evaluate(() => (
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      ));
      expect(horizontalOverflow).toBe(false);

      // No table (and so no independently horizontally-scrolling
      // TableContainer either) - cards stack instead.
      await expect(page.locator('table')).toHaveCount(0);

      // The page itself grows tall enough to need scrolling - there's no
      // separate bounded region competing with it (unlike the desktop shell,
      // which is pinned to exactly the viewport height).
      const pageScrolls = await page.evaluate(() => (
        document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
      ));
      expect(pageScrolls).toBe(true);
    });

    test(`${label}: persistent Players, Board, and Draft tabs; on-the-clock stays visible across all three`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setupOverflowingDraft(page);

      const tabs = await page.getByRole('tab').allTextContents();
      expect(tabs).toEqual(['Players', 'Board', 'Draft']);

      const onClockChip = page.getByText('On the clock: Ridge Runners (harness-manager)');
      await expect(onClockChip).toBeVisible();
      await expect(page.getByText('Depth Player 1', { exact: true })).toBeVisible();

      await page.getByRole('tab', { name: 'Board' }).click();
      await expect(onClockChip).toBeVisible();
      await expect(page.getByRole('region', { name: 'Draft Board' })).toBeVisible();

      await page.getByRole('tab', { name: 'Draft' }).click();
      await expect(onClockChip).toBeVisible();
      await expect(page.getByRole('heading', { name: 'My Queue', level: 2 })).toBeVisible();
      await expect(page.getByText('Depth Player 1', { exact: true })).toHaveCount(0);

      await page.getByRole('tab', { name: 'Players' }).click();
      await expect(onClockChip).toBeVisible();
      await expect(page.getByText('Depth Player 1', { exact: true })).toBeVisible();
    });

    test(`${label}: player cards carry the approved columns and state-valid Draft/Queue actions`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setupOverflowingDraft(page);

      const card = page.getByRole('button', { name: 'Depth Player 1', exact: true })
        .locator('xpath=ancestor::*[contains(@class, "MuiPaper-root")][1]');
      await expect(card.getByText('FA')).toBeVisible();
      await expect(card.getByText(/^Bye:/)).toBeVisible();
      await expect(card.getByText(/^ADP:/)).toBeVisible();
      await expect(card.getByText(/^Pos rank:/)).toBeVisible();
      await expect(card.getByText(/^17-game pace:/)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Draft', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Queue' })).toBeVisible();
    });
  }

  test('keyboard order matches the visible layout - the Draft tab is keyboard-operable, no swipe needed', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await setupOverflowingDraft(page);

    // DOM tab order matches the visible Players/Board/Draft order.
    const tabOrder = await page.getByRole('tab').evaluateAll((els) => els.map((el) => el.textContent?.trim()));
    expect(tabOrder).toEqual(['Players', 'Board', 'Draft']);

    // Activated purely by keyboard (focus, then Enter) - proves the tabs are
    // ordinary operable controls, not a swipe-only surface.
    const draftTab = page.getByRole('tab', { name: 'Draft' });
    await draftTab.focus();
    await expect(draftTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'My Queue', level: 2 })).toBeVisible();
  });
});

// --- Browser evidence across 390/768/1280/1920, light and dark (acceptance
// criterion 7) - one sanity pass per width/theme combination. ---

test.describe('browser evidence: every required width in both themes', () => {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${label} (${viewport.width}x${viewport.height}), ${theme} theme renders the Draft route cleanly`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await setTheme(page, theme);
        await setupOverflowingDraft(page);

        await expect(page.getByRole('heading', { name: 'Harness League', level: 1 })).toBeVisible();
        const tabs = await page.getByRole('tab').allTextContents();
        // Desktop/wide collapse Players+Draft into one workspace tab;
        // mobile/tablet expose all three separately (issue #122).
        if (viewport.width >= 900) {
          expect(tabs).toEqual(['Draft', 'Board']);
        } else {
          expect(tabs).toEqual(['Players', 'Board', 'Draft']);
        }

        const horizontalOverflow = await page.evaluate(() => (
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        ));
        expect(horizontalOverflow).toBe(false);
      });
    }
  }
});
