/**
 * Lineup layout-shift guard for the weekly browser suite (spec #2998). Ported from the lineup scratch harness
 * (ee-perf-tools/lineup/zz-lineup-perf.spec.ts): the wave 3 fixture, the harness's settle rule, the phone's 4x CPU
 * throttle and its per-request API latency. The harness's timing marks are not ported. Runs against the dev server.
 * The spec sets the session hint because a signed-in visitor always has it.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from '../e2e/fixtures/wave3LineupFixtures';

// shortcut: budgets are the highest seen plus 0.03, rounded up. Phone 0.10: with the session hint and 150 ms latency the build machine gave 0.0430 in 22 of 25 runs, 0.0500 once and 0.0620 twice (a strip and week-picker entry of 0.019), on 2026-11-22; the GitHub runner's 0.0663 predates both. Desktop 0.07: with the hint 0.0237 to 0.0299 on the build machine (10 runs, 2026-11-22); the GitHub runner's 0.0373 (run 44969166698, 2026-11-22) also predates the hint. Not seen: a visit without the session hint, where the pixel font arrives late and the team name re-wraps (0.066 to 0.227 depending on timing). Tighten the phone budget once the runner's hinted score is known over a few weeks.
const PHONE_BUDGET = 0.10;
const DESKTOP_BUDGET = 0.07;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

// Production reads take 130 to 360 ms; instant answers make the render order depend on machine speed.
const API_LATENCY_MS = 150;

// The 300px control block alone must add at least this much; decoupled from the phone budget.
const CONTROL_MIN_SHIFT = 0.1;

type Shift = { value: number; sources: string[] };

const readShifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
const total = (shifts: Shift[]) => shifts.reduce((sum, s) => sum + s.value, 0);

// Installed before the page loads so the buffered observer sees every shift from first paint. Shifts after input are
// the user's own scrolling or typing, not a layout bug, so they are skipped. Returns the API reads that failed.
async function openLineup(page: Page, viewport: { width: number; height: number }, cpuRate: number) {
  // A signed-in visitor always has this hint; without it the pixel font arrives late and the team name re-wraps at a machine-speed moment.
  await page.addInitScript(() => localStorage.setItem('endzone_session_hint', '1'));
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: Shift[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__shifts.push({
          value: entry.value,
          sources: (entry.sources || []).map((s) => {
            const node = s.node as Element | null;
            return node?.closest?.('[data-testid]')?.getAttribute('data-testid') ?? node?.nodeName ?? '?';
          }),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await setupWave3Lineup(page, 'pre', 'dark');
  // The wave3 fixture answers these two with a 500; every other signed-in fixture answers them with an empty payload.
  const answerGet = (path: string, body: object) => page.route(
    (url) => url.pathname === path,
    (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fallback()),
  );
  await answerGet('/api/notifications', { notifications: [], unread: 0 });
  await answerGet('/api/notifications/prefs', { prefs: {} });
  // Registered last, so it runs first on every API read and delays it before the answer.
  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, API_LATENCY_MS));
    await route.fallback();
  });
  const failed: string[] = [];
  page.on('response', (res) => {
    // The signed-in fixture relies on this read failing: an empty 204 signs the app out.
    if (new URL(res.url()).pathname === '/api/auth/refresh') return;
    if (res.url().includes('/api/') && res.status() >= 500) failed.push(`${res.status()} ${res.url()}`);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.setViewportSize(viewport);
  return failed;
}

// The harness's settle rule: every region the page draws is in the DOM, then 800 ms for late shifts to land.
async function settle(page: Page) {
  await page.waitForFunction(
    () => ['lineup-page', 'ledger-starters', 'strip-win-probability', 'start-sit-apply', 'matchup-preview', 'matchup-versus']
      .every((id) => document.querySelector(`[data-testid="${id}"]`))
      && !document.querySelector('[data-testid="matchup-skeleton"]'),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(800);
}

for (const c of [
  { name: 'phone', viewport: PHONE, cpu: 4, budget: PHONE_BUDGET },
  { name: 'desktop', viewport: DESKTOP, cpu: 1, budget: DESKTOP_BUDGET },
]) {
  test(`Lineup ${c.name} ${c.viewport.width}x${c.viewport.height}: layout shift within budget`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const failed = await openLineup(page, c.viewport, c.cpu);
    const started = Date.now();
    await page.goto(WAVE3_LINEUP_URL);
    await expect(page.getByTestId('ledger-starters')).toBeVisible({ timeout: 20_000 });
    const rosterMs = Date.now() - started;
    testInfo.annotations.push({ type: 'roster visible', description: `${rosterMs} ms` });
    await settle(page);

    const shifts = await readShifts(page);
    // eslint-disable-next-line no-console
    console.log(`LINEUP_CLS ${c.name} ${total(shifts).toFixed(4)} roster ${rosterMs}ms`);
    expect(failed, `API reads answered 500 or unmocked: ${failed.join('; ')}`).toEqual([]);
    expect(total(shifts), `layout shifts: ${JSON.stringify(shifts)}`).toBeLessThanOrEqual(c.budget);
  });
}

// Proves the observer sees shifts: a block inserted first in the page must add at least CONTROL_MIN_SHIFT.
test('control: a 300px block inserted first in the page adds at least the control minimum', async ({ page }) => {
  test.setTimeout(60_000);
  await openLineup(page, PHONE, 4);
  await page.goto(WAVE3_LINEUP_URL);
  await settle(page);
  const seen = await readShifts(page);
  const before = total(seen);
  await page.evaluate(() => {
    const block = document.createElement('div');
    block.style.height = '300px';
    document.querySelector('[data-testid="lineup-page"]')?.prepend(block);
  });
  await expect.poll(async () => (await readShifts(page)).length).toBeGreaterThan(seen.length);
  const after = total(await readShifts(page));
  expect(after - before, `shift added by the control block, minimum ${CONTROL_MIN_SHIFT}`).toBeGreaterThan(CONTROL_MIN_SHIFT);
});
