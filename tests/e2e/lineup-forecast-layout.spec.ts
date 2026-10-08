/**
 * Layout guard for the Endzone Forecast card (#2099): jsdom has no layout
 * engine, so row alignment between the Sit and Start columns is measured in
 * headless Chromium over the real Team Lineup page, fed a fixture advice
 * (fixtures/lineupLedgerFixtures.ts FORECAST_ADVICE) whose Start side carries a
 * fact chip row the Sit side lacks. Before the fix the shorter column
 * stretched and its rows sat lower than the taller column's.
 */
import { expect, test } from '@playwright/test';
import { FORECAST_ADVICE, LINEUP_URL, setupLineupLedgerFixture } from './fixtures/lineupLedgerFixtures';

test('at 390px the Sit and Start columns line up row for row', async ({ page }) => {
  await setupLineupLedgerFixture(page, { advice: FORECAST_ADVICE });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINEUP_URL);
  await page.getByTestId('lineup-mobile-tabs').getByRole('button', { name: /^Outlook/ }).click();
  await expect(page.getByTestId('suggestion-card')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const columns = await page.locator('[data-testid="suggestion-player"]').evaluateAll((els) =>
    els.map((el) => Array.from(el.children).map((child) => child.getBoundingClientRect().top))
  );
  expect(columns).toHaveLength(2);
  const [sit, start] = columns;
  // label, name row, bar, Floor line, kickoff
  for (let i = 0; i < 5; i++) {
    expect(Math.abs(sit[i] - start[i]), `row ${i}: Sit ${sit[i]} vs Start ${start[i]}`).toBeLessThanOrEqual(1);
  }
  expect(start).toHaveLength(6);
  expect(sit).toHaveLength(5);
  await expect(page.getByTestId('suggestion-fact-chip')).toHaveText(/Favored by 7 context only/);
});
