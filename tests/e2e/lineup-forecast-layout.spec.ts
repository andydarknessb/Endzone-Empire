/**
 * Layout guard for the Endzone Forecast card (#2099): jsdom has no layout
 * engine, so row alignment between the Sit and Start columns is measured in
 * headless Chromium over the real Team Lineup page, fed a fixture advice
 * (fixtures/lineupLedgerFixtures.ts FORECAST_ADVICE) whose Start side carries a
 * fact chip row the Sit side lacks. Before the fix the shorter column
 * stretched and its rows sat lower than the taller column's.
 */
import { expect, test, type Page } from '@playwright/test';
import { FORECAST_ADVICE, FORECAST_ADVICE_WRAPPED_NAME, LINEUP_URL, setupLineupLedgerFixture } from './fixtures/lineupLedgerFixtures';
import { WAVE3_LINEUP_URL, setupWave3Lineup } from './fixtures/wave3LineupFixtures';

async function openForecast(page: Page, advice: object) {
  await setupLineupLedgerFixture(page, { advice });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINEUP_URL);
  await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: /^Outlook/ }).click();
  await expect(page.getByTestId('suggestion-card')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

// Per column: children tops, the column's bottom, its last child's bottom, the
// name's top (first child of the name row) and the range bar's top (third child).
const measure = (page: Page) =>
  page.locator('[data-testid="suggestion-player"]').evaluateAll((els) =>
    els.map((el) => {
      const kids = Array.from(el.children);
      return {
        tops: kids.map((child) => child.getBoundingClientRect().top),
        bottom: el.getBoundingClientRect().bottom,
        lastBottom: kids[kids.length - 1].getBoundingClientRect().bottom,
        nameTop: (kids[1].firstElementChild as Element).getBoundingClientRect().top,
        barTop: kids[2].getBoundingClientRect().top,
      };
    })
  );

test('at 390px the Sit and Start columns line up row for row', async ({ page }) => {
  await openForecast(page, FORECAST_ADVICE);

  const columns = await measure(page);
  expect(columns).toHaveLength(2);
  const [sit, start] = columns;
  // label, name row, bar, Floor line, kickoff
  for (let i = 0; i < 5; i++) {
    expect(Math.abs(sit.tops[i] - start.tops[i]), `row ${i}: Sit ${sit.tops[i]} vs Start ${start.tops[i]}`).toBeLessThanOrEqual(1);
  }
  expect(start.tops).toHaveLength(6);
  expect(sit.tops).toHaveLength(5);
  // The Start column ends at its chip row (Sit spans that track too, so only Start is checked).
  expect(start.bottom - start.lastBottom).toBeLessThanOrEqual(2);
  expect(Math.abs(sit.nameTop - start.nameTop)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('suggestion-fact-chip')).toHaveText(/Favored by 7 context only/);
});

test('at 390px a wrapped Sit name row does not push the Start name or bar out of line', async ({ page }) => {
  await openForecast(page, FORECAST_ADVICE_WRAPPED_NAME);

  const [sit, start] = await measure(page);
  // The Q tag wraps under the Sit name (the name itself is nowrap), so that row is two lines tall.
  const tagWrapped = await page.locator('[data-testid="suggestion-player"]').first().evaluate((el) => {
    const [name, tag] = Array.from(el.children[1].children).map((child) => child.getBoundingClientRect().top);
    return tag - name > 4;
  });
  expect(tagWrapped, 'the Sit name row must wrap for this check to mean anything').toBe(true);
  expect(Math.abs(sit.nameTop - start.nameTop), `name tops ${sit.nameTop} vs ${start.nameTop}`).toBeLessThanOrEqual(1);
  expect(Math.abs(sit.barTop - start.barTop), `bar tops ${sit.barTop} vs ${start.barTop}`).toBeLessThanOrEqual(1);
});

test('at 390px with no fact chips on either side nothing blank trails the columns', async ({ page }) => {
  const [suggestion] = FORECAST_ADVICE.suggestions;
  const { line, ...suggested } = suggestion.suggested;
  await openForecast(page, { ...FORECAST_ADVICE, suggestions: [{ ...suggestion, suggested }] });

  for (const column of await measure(page)) {
    expect(column.bottom - column.lastBottom, 'the empty chip track must not keep a row gutter').toBeLessThanOrEqual(2);
  }
});

// #2886: the suggestion head wraps inside its card rather than running out of it, at the rail's widths.
for (const width of [1280, 900]) {
  test(`at ${width}px every child of the suggestion head ends inside the first suggestion card (#2886)`, async ({ page }) => {
    await setupWave3Lineup(page, 'pre', 'light');
    await page.setViewportSize({ width, height: 900 });
    await page.goto(WAVE3_LINEUP_URL);
    await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const { children, overhang } = await page.getByTestId('suggestion-card').first().evaluate((card) => {
      const edge = card.getBoundingClientRect().right;
      const kids = Array.from(card.querySelector('[data-testid="suggestion-head"]')?.children ?? []);
      return {
        children: kids.length,
        overhang: kids.map((kid) => kid.getBoundingClientRect().right - edge).filter((over) => over > 0.5),
      };
    });
    expect(children, 'the suggestion head has its children').toBeGreaterThan(0);
    expect(overhang, 'px each head child runs past the card edge').toEqual([]);
  });
}

// #2886: the Bye clusters and the Matchup preview stay out of the rail's way while the Forecast's advice is held.
test('at 1280px no layout shift lists the Bye clusters or the Matchup preview while the advice is held (#2886)', async ({ page }) => {
  await setupWave3Lineup(page, 'pre', 'dark');
  await page.route('**/api/team/lineup/advice**', async (route) => {
    await page.waitForTimeout(600);
    await route.fallback();
  });
  await page.addInitScript(() => {
    const shifts: Array<{ near: string | null; inside: string | null }> = [];
    (window as unknown as { __layoutShifts: typeof shifts }).__layoutShifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { sources?: Array<{ node: Node | null }> }>) {
        for (const source of entry.sources ?? []) {
          const node = source.node instanceof Element ? source.node : null;
          shifts.push({
            near: node?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
            inside: node?.closest('[data-testid="bye-cluster-grid"], [data-testid="matchup-preview"]')?.getAttribute('data-testid') ?? null,
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(WAVE3_LINEUP_URL);
  await expect(page.getByTestId('start-sit-apply')).toBeAttached();
  await page.waitForTimeout(300);

  const shifts = await page.evaluate(() => (window as unknown as { __layoutShifts: Array<{ near: string | null; inside: string | null }> }).__layoutShifts);
  expect(shifts.filter((shift) => shift.near === 'bye-cluster-grid' || shift.near === 'matchup-preview' || shift.inside !== null)).toEqual([]);
});

// #2886: the longest verdict ("Too close to call") wraps inside the card instead of running out of it.
for (const [width, height] of [[900, 900], [360, 800]] as const) {
  test(`at ${width}px a tossup verdict keeps every suggestion-head child inside the card (#2886)`, async ({ page }) => {
    await setupLineupLedgerFixture(page, { advice: FORECAST_ADVICE });
    await page.setViewportSize({ width, height });
    await page.goto(LINEUP_URL);
    if (width < 600) await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: /^Outlook/ }).click();
    await expect(page.getByTestId('suggestion-verdict')).toHaveText(/Too close to call/i);
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const overhang = await page.getByTestId('suggestion-card').first().evaluate((card) => {
      const edge = card.getBoundingClientRect().right;
      const kids = Array.from(card.querySelector('[data-testid="suggestion-head"]')?.children ?? []);
      return kids.map((kid) => kid.getBoundingClientRect().right - edge).filter((over) => over > 0.5);
    });
    expect(overhang, 'px each head child runs past the card edge').toEqual([]);
  });
}
