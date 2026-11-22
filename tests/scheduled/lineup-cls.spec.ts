/**
 * Lineup layout-shift guard for the weekly browser suite (spec #2998). Ported from the lineup scratch harness
 * (ee-perf-tools/lineup/zz-lineup-perf.spec.ts): the wave 3 fixture, the harness's settle rule, and the phone's 4x CPU
 * throttle. The harness's per-request API latency and timing marks are not ported. Runs against the dev server.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from '../e2e/fixtures/wave3LineupFixtures';

// shortcut: budgets are the highest seen plus 0.03, rounded up. Phone 0.0659 on the build machine in every run and 0.0663 on a GitHub runner; desktop 0.0226 to 0.0354 on the build machine and 0.0373 on a GitHub runner (run 44969166698, 2026-11-22). Tighten when the phone's fixed shift is fixed.
const PHONE_BUDGET = 0.10;
const DESKTOP_BUDGET = 0.07;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

// Production reads take 130 to 360 ms; instant answers make the render order depend on machine speed.
const API_LATENCY_MS = 150;

type Shift = { value: number; sources: string[] };

const readShifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
const total = (shifts: Shift[]) => shifts.reduce((sum, s) => sum + s.value, 0);

// Installed before the page loads so the buffered observer sees every shift from first paint. Shifts after input are
// the user's own scrolling or typing, not a layout bug, so they are skipped. Returns the API reads that failed.
async function openLineup(page: Page, viewport: { width: number; height: number }, cpuRate: number) {
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

// Proves the observer sees shifts: a block inserted first in the page must add more than the phone budget.
test('control: a 300px block inserted first in the page adds more than the phone budget', async ({ page }) => {
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
  expect(after - before, `shift added by the control block, budget ${PHONE_BUDGET}`).toBeGreaterThan(PHONE_BUDGET);
});
