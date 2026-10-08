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
