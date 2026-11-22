/**
 * Accessibility sweep for the weekly browser suite (spec #2998, ticket #3005). Each page loads with the mocks its e2e
 * spec installs, and axe runs once the page's ready locator is visible. A page fails when it has a serious or critical
 * rule that its a11y-baseline.json entry lacks, or more nodes of a rule than the entry allows. A11Y_WRITE_BASELINE=1
 * writes the counts found and keeps the entries of pages that did not run. A baseline entry the scan no longer reaches
 * warns (a ::warning:: line and an annotation) and does not fail. Runs against the dev server.
 *
 * not covered:
 *   Draft presenter: draft-presenter.spec.ts builds its board and activity data inline, with its own test fixture.
 *
 * not checked: axe's incomplete results (colour it could not compute, which is most of the Lineup ledger's text), the
 *   dark theme, phone widths (default desktop viewport and theme only), and the reads the fixtures answer with a 500 on
 *   purpose: Players (/api/league/4400, /api/waivers) and Lineup (/api/notifications).
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockAnonymousApi } from '../e2e/fixtures/anonymousApi';
import { HOME_URL, setupHome } from '../e2e/fixtures/homePlayselectFixtures';
import { MY_LEAGUES_URL, setupMyLeaguesLayout } from '../e2e/fixtures/myLeaguesLayoutFixtures';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from '../e2e/fixtures/wave3LineupFixtures';
import { DASHBOARD_URL, GAME_CENTER_URL, MATCHUP_URL, setupLayoutGuard } from '../e2e/fixtures/layoutGuardFixtures';
import { DASH_URL, setupDashboard } from '../e2e/fixtures/leagueDashboardPlayselectFixtures';
import { routeWeek17Trophies } from '../e2e/fixtures/trophyCaseFixtures';
import { PLAYERS_LAYOUT_URL, setupPlayersPageLayout } from '../e2e/fixtures/playersPageLayoutFixtures';
import { PICKEM_URL, setupPickem } from '../e2e/fixtures/pickemWave2Fixtures';
import { CURSOR_NAME, WAIVERS_URL, setupWave3Waivers } from '../e2e/fixtures/wave3WaiversFixtures';
import { TRADES_URL, setupTradesFixture } from '../e2e/fixtures/wave3TradesFixtures';
import { installDraftRestApi, installDraftSocketHarness } from '../e2e/fixtures/draftHarness';
import { ACTIVE_PICKS, ACTIVE_STATE, FIXTURE_LEAGUE_ID } from '../e2e/fixtures/draftFixtures';
import { DRAFT_SETTINGS_URL, setupDraftSettings } from '../e2e/fixtures/wave5DraftSettingsFixtures';
import { COMMISSIONER_URL, setupCommissionerFixture } from '../e2e/fixtures/wave5CommissionerFixtures';
import { RULES_URL, setupRulesFixture } from '../e2e/fixtures/wave5RulesFixtures';
import { ACTIVITY_URL, setupActivityFixture } from '../e2e/fixtures/wave5ActivityFixtures';
import { POWER_RANKINGS_URL, setupPowerRankingsFixture } from '../e2e/fixtures/wave5PowerRankingsFixtures';
import { HISTORY_URL, setupHistoryFixture } from '../e2e/fixtures/wave5HistoryFixtures';

type SweepPage = { name: string; setup: (page: Page) => Promise<unknown>; url: string; ready: (page: Page) => Locator | Promise<Locator> };
type Violation = { id: string; help: string; targets: string[] };
type Counts = Record<string, number>;

const BASELINE_PATH = path.join(__dirname, 'a11y-baseline.json');
const WRITE_BASELINE = process.env.A11Y_WRITE_BASELINE === '1';
const baseline: Record<string, Counts> = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {};
const found: Record<string, Counts> = {};

// The Draft room fixture, the same two calls draft-board.spec.ts makes before it opens the room.
async function setupDraftBoard(page: Page) {
  await installDraftSocketHarness(page, ACTIVE_STATE);
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
}

// The completed-league dashboard, the state that renders the trophy room: the same two calls trophy-case-layout.spec.ts makes.
async function setupCompletedDashboard(page: Page) {
  await setupDashboard(page, 'complete', { theme: 'light' });
  await routeWeek17Trophies(page);
}

// The landing spec waits for the network to settle before it measures, so the scan does not start on a skeleton.
async function landingReady(page: Page) {
  await page.waitForLoadState('networkidle');
  return page.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' });
}

const PAGES: SweepPage[] = [
  { name: 'Landing', setup: mockAnonymousApi, url: '/', ready: landingReady },
  { name: 'Login', setup: mockAnonymousApi, url: '/#/login', ready: (p) => p.locator('.formPanel') },
  { name: 'Registration', setup: mockAnonymousApi, url: '/#/registration', ready: (p) => p.locator('.formPanel') },
  { name: 'Reset password', setup: mockAnonymousApi, url: '/#/reset-password?token=reset-fixture-token', ready: (p) => p.locator('#reset-password') },
  { name: 'Home', setup: (p) => setupHome(p, 'main'), url: HOME_URL, ready: (p) => p.getByRole('heading', { name: 'My leagues' }) },
  { name: 'My leagues', setup: setupMyLeaguesLayout, url: MY_LEAGUES_URL, ready: (p) => p.getByTestId('shared-league-card').first() },
  { name: 'Lineup', setup: (p) => setupWave3Lineup(p, 'pre', 'light'), url: WAVE3_LINEUP_URL, ready: (p) => p.getByTestId('ledger-starters') },
  { name: 'League dashboard', setup: setupLayoutGuard, url: DASHBOARD_URL, ready: (p) => p.getByTestId('quick-actions') },
  { name: 'League dashboard, season complete', setup: setupCompletedDashboard, url: DASH_URL, ready: (p) => p.getByTestId('trophy-case') },
  { name: 'Matchup', setup: setupLayoutGuard, url: MATCHUP_URL, ready: (p) => p.getByTestId('slot-row').first() },
  { name: 'Game center', setup: setupLayoutGuard, url: GAME_CENTER_URL, ready: (p) => p.getByRole('radio', { name: 'Wk 18', exact: true }) },
  { name: 'Players', setup: setupPlayersPageLayout, url: PLAYERS_LAYOUT_URL, ready: (p) => p.getByTestId('player-row').first() },
  { name: "Pick'em", setup: (p) => setupPickem(p), url: PICKEM_URL, ready: (p) => p.getByTestId('pickem-status') },
  { name: 'Waivers', setup: (p) => setupWave3Waivers(p, 'light'), url: WAIVERS_URL, ready: (p) => p.getByText(CURSOR_NAME).first() },
  { name: 'Trades', setup: (p) => setupTradesFixture(p, { theme: 'light' }), url: TRADES_URL, ready: (p) => p.getByTestId('trade-11') },
  { name: 'Draft board', setup: setupDraftBoard, url: `/#/league/${FIXTURE_LEAGUE_ID}/draft`, ready: (p) => p.getByRole('heading', { name: 'Harness League', level: 1 }) },
  { name: 'Draft settings', setup: (p) => setupDraftSettings(p, 'light'), url: DRAFT_SETTINGS_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'Draft Settings' }) },
  { name: 'Commissioner', setup: (p) => setupCommissionerFixture(p, { theme: 'light', pending: true }), url: COMMISSIONER_URL, ready: (p) => p.getByTestId('join-requests-row-11') },
  { name: 'Rules', setup: (p) => setupRulesFixture(p, { theme: 'light' }), url: RULES_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'League Rules' }) },
  { name: 'Activity', setup: (p) => setupActivityFixture(p, { theme: 'light' }), url: ACTIVITY_URL, ready: (p) => p.getByTestId('txn-1').or(p.getByTestId('txn-5')).first() },
  { name: 'Power rankings', setup: (p) => setupPowerRankingsFixture(p, 'light'), url: POWER_RANKINGS_URL, ready: (p) => p.getByTestId('movement').first() },
  { name: 'History', setup: (p) => setupHistoryFixture(p, { theme: 'light' }), url: HISTORY_URL, ready: (p) => p.getByTestId('season-panel-2026') },
  { name: 'Rankings', setup: mockAnonymousApi, url: '/rankings', ready: (p) => p.getByText('Josh Allen', { exact: true }) },
];

async function open(page: Page, p: SweepPage) {
  await p.setup(page);
  await page.goto(p.url);
  await expect(await p.ready(page)).toBeVisible();
}

// The axe script is injected on each call, so the control test can rescan the same page after it changes it.
async function scan(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async () => {
    type Result = { violations: { id: string; help: string; impact?: string | null; nodes: { target: unknown[] }[] }[] };
    const { violations } = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<Result> } })
      .axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }));
  });
}

const countsOf = (violations: Violation[]): Counts => Object.fromEntries(violations.map((v) => [v.id, v.targets.length]));

// The one comparison: what a scan adds to its page's entry, a serious or critical rule the entry lacks or one with more nodes than it allows.
function unbaselined(name: string, violations: Violation[]): string[] {
  const known = baseline[name] ?? {};
  return violations.flatMap((v) => {
    const selectors = v.targets.slice(0, 3).join(', ');
    if (!(v.id in known)) return [`${v.id}: new rule, ${v.targets.length} nodes (${v.help}): ${selectors}`];
    if (v.targets.length > known[v.id]) return [`${v.id}: ${v.targets.length} nodes, baseline ${known[v.id]} (${v.help}): ${selectors}`];
    return [];
  });
}

// The entries the scan no longer reaches: a rule it did not find, or found with fewer nodes than the entry allows.
function staleEntries(name: string, violations: Violation[]): { id: string; detail: string }[] {
  const known = baseline[name] ?? {};
  return Object.keys(known).flatMap((id) => {
    const v = violations.find((x) => x.id === id);
    if (!v) return [{ id, detail: `${id}: not found, baseline ${known[id]}` }];
    return v.targets.length < known[id] ? [{ id, detail: `${id}: ${v.targets.length} of ${known[id]} nodes` }] : [];
  });
}

for (const p of PAGES) {
  test(`a11y: ${p.name}`, async ({ page }, testInfo) => {
    await open(page, p);
    const violations = await scan(page);
    found[p.name] = countsOf(violations);
    if (WRITE_BASELINE) return;

    for (const stale of staleEntries(p.name, violations)) {
      testInfo.annotations.push({ type: 'stale-baseline', description: `${p.name}: ${stale.detail}` });
      // eslint-disable-next-line no-console
      console.log(`::warning::stale-baseline ${p.name}: ${stale.id}`);
    }
    expect(unbaselined(p.name, violations), `${p.name} has serious or critical axe violations not in a11y-baseline.json`).toEqual([]);
  });
}

test.afterAll(() => {
  if (!WRITE_BASELINE) return;
  // A filtered run writes only the pages it ran, so the entries for every other page are kept from the file.
  const merged = { ...baseline, ...found };
  const sortCounts = (c: Counts) => Object.fromEntries(Object.keys(c).sort().map((id) => [id, c[id]]));
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((name) => [name, sortCounts(merged[name])]));
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
});

// Proves axe ran and the comparison works: an image with no alt, added to the Landing page after it is ready, must come
// back from unbaselined as a new image-alt.
test('control: an injected image with no alt is reported as a new image-alt', async ({ page }) => {
  const [landing] = PAGES;
  await open(page, landing);
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'data:,';
    (document.querySelector('main') ?? document.body).append(img);
  });
  expect(unbaselined(landing.name, await scan(page)).join('\n')).toContain('image-alt');
});
