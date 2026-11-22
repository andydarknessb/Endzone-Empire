/**
 * Accessibility sweep for the weekly browser suite (spec #2998, ticket #3005). Each page loads with the mocks its e2e
 * spec installs, axe runs once it is ready, and a serious or critical violation whose rule id is not in
 * a11y-baseline.json fails the page. A11Y_WRITE_BASELINE=1 writes what is found instead. Runs against the dev server.
 *
 * not covered:
 *   Reset password: auth-offline.spec.ts mocks its API inline in the test body, with state that test shares.
 *   Matchup: league-wave2-matchup.spec.ts builds its Matchup detail in a spec-local helper and routes it inline.
 *   Game Center: league-wave2-gamecenter.spec.ts needs a spec-local lineup detail on top of its dashboard fixture.
 *   Draft presenter: draft-presenter.spec.ts builds its board and activity data inline, with its own test fixture.
 */
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockAnonymousApi } from '../e2e/fixtures/anonymousApi';
import { HOME_URL, setupHome } from '../e2e/fixtures/homePlayselectFixtures';
import { MY_LEAGUES_URL, setupMyLeaguesLayout } from '../e2e/fixtures/myLeaguesLayoutFixtures';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from '../e2e/fixtures/wave3LineupFixtures';
import { DASHBOARD_URL, setupLayoutGuard } from '../e2e/fixtures/layoutGuardFixtures';
import { PLAYERS_LAYOUT_URL, setupPlayersPageLayout } from '../e2e/fixtures/playersPageLayoutFixtures';
import { PICKEM_URL, setupPickem } from '../e2e/fixtures/pickemWave2Fixtures';
import { WAIVERS_URL, setupWave3Waivers } from '../e2e/fixtures/wave3WaiversFixtures';
import { TRADES_URL, setupTradesFixture } from '../e2e/fixtures/wave3TradesFixtures';
import { installDraftRestApi, installDraftSocketHarness } from '../e2e/fixtures/draftHarness';
import { ACTIVE_PICKS, ACTIVE_STATE, FIXTURE_LEAGUE_ID } from '../e2e/fixtures/draftFixtures';
import { DRAFT_SETTINGS_URL, setupDraftSettings } from '../e2e/fixtures/wave5DraftSettingsFixtures';
import { COMMISSIONER_URL, setupCommissionerFixture } from '../e2e/fixtures/wave5CommissionerFixtures';
import { RULES_URL, setupRulesFixture } from '../e2e/fixtures/wave5RulesFixtures';
import { ACTIVITY_URL, setupActivityFixture } from '../e2e/fixtures/wave5ActivityFixtures';
import { POWER_RANKINGS_URL, setupPowerRankingsFixture } from '../e2e/fixtures/wave5PowerRankingsFixtures';
import { HISTORY_URL, setupHistoryFixture } from '../e2e/fixtures/wave5HistoryFixtures';

type SweepPage = { name: string; setup: (page: Page) => Promise<unknown>; url: string; ready: (page: Page) => Locator };
type Violation = { id: string; help: string; targets: string[] };

const BASELINE_PATH = path.join(__dirname, 'a11y-baseline.json');
const WRITE_BASELINE = process.env.A11Y_WRITE_BASELINE === '1';
const baseline: Record<string, string[]> = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {};
const found: Record<string, string[]> = {};

// The Draft room fixture, the same two calls draft-board.spec.ts makes before it opens the room.
async function setupDraftBoard(page: Page) {
  await installDraftSocketHarness(page, ACTIVE_STATE);
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
}

const PAGES: SweepPage[] = [
  { name: 'Landing', setup: mockAnonymousApi, url: '/', ready: (p) => p.getByRole('heading', { level: 1, name: 'Welcome to Endzone Empire' }) },
  { name: 'Login', setup: mockAnonymousApi, url: '/#/login', ready: (p) => p.locator('.formPanel') },
  { name: 'Registration', setup: mockAnonymousApi, url: '/#/registration', ready: (p) => p.locator('.formPanel') },
  { name: 'Home', setup: (p) => setupHome(p, 'main'), url: HOME_URL, ready: (p) => p.getByRole('heading', { name: 'Call your plays' }) },
  { name: 'My leagues', setup: setupMyLeaguesLayout, url: MY_LEAGUES_URL, ready: (p) => p.getByTestId('shared-league-card').first() },
  { name: 'Lineup', setup: (p) => setupWave3Lineup(p, 'pre', 'light'), url: WAVE3_LINEUP_URL, ready: (p) => p.getByTestId('ledger-starters') },
  { name: 'League dashboard', setup: setupLayoutGuard, url: DASHBOARD_URL, ready: (p) => p.getByTestId('quick-actions') },
  { name: 'Players', setup: setupPlayersPageLayout, url: PLAYERS_LAYOUT_URL, ready: (p) => p.getByTestId('player-row').first() },
  { name: "Pick'em", setup: (p) => setupPickem(p), url: PICKEM_URL, ready: (p) => p.getByTestId('pickem-status') },
  { name: 'Waivers', setup: (p) => setupWave3Waivers(p, 'light'), url: WAIVERS_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'Waivers' }) },
  { name: 'Trades', setup: (p) => setupTradesFixture(p, { theme: 'light' }), url: TRADES_URL, ready: (p) => p.getByTestId('trade-11') },
  { name: 'Draft board', setup: setupDraftBoard, url: `/#/league/${FIXTURE_LEAGUE_ID}/draft`, ready: (p) => p.getByRole('heading', { name: 'Harness League', level: 1 }) },
  { name: 'Draft settings', setup: (p) => setupDraftSettings(p, 'light'), url: DRAFT_SETTINGS_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'Draft Settings' }) },
  { name: 'Commissioner', setup: (p) => setupCommissionerFixture(p, { theme: 'light', pending: true }), url: COMMISSIONER_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'Commissioner console' }) },
  { name: 'Rules', setup: (p) => setupRulesFixture(p, { theme: 'light' }), url: RULES_URL, ready: (p) => p.getByRole('heading', { level: 1, name: 'League Rules' }) },
  { name: 'Activity', setup: (p) => setupActivityFixture(p, { theme: 'light' }), url: ACTIVITY_URL, ready: (p) => p.getByTestId('txn-1').or(p.getByTestId('txn-5')).first() },
  { name: 'Power rankings', setup: (p) => setupPowerRankingsFixture(p, 'light'), url: POWER_RANKINGS_URL, ready: (p) => p.getByTestId('movement').first() },
  { name: 'History', setup: (p) => setupHistoryFixture(p, { theme: 'light' }), url: HISTORY_URL, ready: (p) => p.getByTestId('season-panel-2026') },
  { name: 'Rankings', setup: mockAnonymousApi, url: '/rankings', ready: (p) => p.getByText('Josh Allen', { exact: true }) },
];

async function open(page: Page, p: SweepPage) {
  await p.setup(page);
  await page.goto(p.url);
  await expect(p.ready(page)).toBeVisible();
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

for (const p of PAGES) {
  test(`a11y: ${p.name}`, async ({ page }, testInfo) => {
    await open(page, p);
    const violations = await scan(page);
    const ids = [...new Set(violations.map((v) => v.id))].sort();
    found[p.name] = ids;
    if (WRITE_BASELINE) return;

    const known = baseline[p.name] ?? [];
    for (const id of known.filter((k) => !ids.includes(k))) {
      testInfo.annotations.push({ type: 'stale-baseline', description: `${p.name}: ${id}` });
    }
    const fresh = violations
      .filter((v) => !known.includes(v.id))
      .map((v) => `${v.id} (${v.help}): ${v.targets.slice(0, 3).join(', ')}`);
    expect(fresh, `${p.name} has serious or critical axe violations not in a11y-baseline.json`).toEqual([]);
  });
}

test.afterAll(() => {
  if (!WRITE_BASELINE) return;
  const sorted = Object.fromEntries(Object.keys(found).sort().map((name) => [name, [...found[name]].sort()]));
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
});

// Proves axe ran and sees a new violation: an image with no alt, added to the Landing page after it is ready.
test('control: an injected image with no alt is reported as image-alt', async ({ page }) => {
  const [landing] = PAGES;
  await open(page, landing);
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'data:,';
    (document.querySelector('main') ?? document.body).append(img);
  });
  expect((await scan(page)).map((v) => v.id)).toContain('image-alt');
});
