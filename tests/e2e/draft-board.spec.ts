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
import type { Page } from '@playwright/test';
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

    await expect(page.getByRole('heading', { name: 'Harness League', level: 4 })).toBeVisible();
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

    await expect(page.getByRole('heading', { name: 'Harness League', level: 4 })).toBeVisible();
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

    await expect(page.getByRole('heading', { name: 'Harness League', level: 4 })).toBeVisible();
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

    await expect(page.getByRole('heading', { name: 'Harness League', level: 4 })).toBeVisible();
    // Mobile stacks the draft rail above the player pool (Grid `order` swap);
    // desktop puts the pool first. Confirm the swap actually took effect
    // rather than just that the page didn't crash at a narrow width.
    const railTop = await page.getByText('My Queue').first().boundingBox();
    const poolTop = await page.getByText('Available Players').boundingBox();
    expect(railTop).not.toBeNull();
    expect(poolTop).not.toBeNull();
    expect(railTop!.y).toBeLessThan(poolTop!.y);
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
