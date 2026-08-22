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

    const names = await page.locator('table tbody tr td:nth-child(2) button').allTextContents();
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

    const names = await page.locator('table tbody tr td:nth-child(2) button').allTextContents();
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
    await expect(joshAllenRow.getByRole('button', { name: 'Draft' })).toBeDisabled();
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
