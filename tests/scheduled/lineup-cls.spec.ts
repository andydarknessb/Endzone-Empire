/**
 * Lineup layout-shift guard for the weekly browser suite (spec #2998). Ported from the lineup scratch harness
 * (ee-perf-tools/lineup/zz-lineup-perf.spec.ts): the wave 3 fixture, the harness's settle rule, and the phone's 4x CPU
 * throttle. The harness's per-request API latency and timing marks are not ported. Runs against the dev server.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from '../e2e/fixtures/wave3LineupFixtures';

// shortcut: dev-server budgets, each the five-run high plus 0.03 (phone 0.0659 x5; desktop 0.0252, 0.0303, 0.0312, 0.0226, 0.0252; measured 2026-11-21), re-measure when the Lineup layout changes, measure a production build if dev-server noise turns green runs red
const PHONE_BUDGET = 0.0959;
const DESKTOP_BUDGET = 0.0612;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

type Shift = { value: number; sources: string[] };

const readShifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
const total = (shifts: Shift[]) => shifts.reduce((sum, s) => sum + s.value, 0);

// Installed before the page loads so the buffered observer sees every shift from first paint. Shifts after input are
// the user's own scrolling or typing, not a layout bug, so they are skipped.
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
          sources: (entry.sources || []).map((s) => (s.node as Element | null)?.closest?.('[data-testid]')?.getAttribute('data-testid') ?? '?'),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await setupWave3Lineup(page, 'pre', 'dark');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.setViewportSize(viewport);
}

// The harness's settle rule: every region the page draws is in the DOM, then 800 ms for late shifts to land.
async function settle(page: Page) {
  await page.waitForFunction(
    () => ['lineup-page', 'ledger-starters', 'strip-win-probability', 'start-sit-apply', 'matchup-preview', 'matchup-versus']
      .every((id) => document.querySelector(`[data-testid="${id}"]`))
      && !document.querySelector('[data-testid="matchup-skeleton"]'),
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
}

for (const c of [
  { name: 'phone', viewport: PHONE, cpu: 4, budget: PHONE_BUDGET },
  { name: 'desktop', viewport: DESKTOP, cpu: 1, budget: DESKTOP_BUDGET },
]) {
  test(`Lineup ${c.name} ${c.viewport.width}x${c.viewport.height}: layout shift within budget`, async ({ page }, testInfo) => {
    await openLineup(page, c.viewport, c.cpu);
    const started = Date.now();
    await page.goto(WAVE3_LINEUP_URL);
    await expect(page.getByTestId('ledger-starters')).toBeVisible();
    testInfo.annotations.push({ type: 'roster visible', description: `${Date.now() - started} ms` });
    await settle(page);

    const shifts = await readShifts(page);
    // eslint-disable-next-line no-console
    console.log(`LINEUP_CLS ${c.name} ${total(shifts).toFixed(4)}`);
    expect(total(shifts), `layout shifts: ${JSON.stringify(shifts)}`).toBeLessThanOrEqual(c.budget);
  });
}

// Proves the observer sees shifts: a block inserted above the roster must push the phone score over its budget.
test('control: a 300px block inserted above the roster is over the phone budget', async ({ page }) => {
  await openLineup(page, PHONE, 4);
  await page.goto(WAVE3_LINEUP_URL);
  await settle(page);
  await page.evaluate(() => {
    const block = document.createElement('div');
    block.style.height = '300px';
    document.querySelector('[data-testid="ledger-starters"]')?.before(block);
  });
  await expect.poll(async () => total(await readShifts(page))).toBeGreaterThan(PHONE_BUDGET);
});
