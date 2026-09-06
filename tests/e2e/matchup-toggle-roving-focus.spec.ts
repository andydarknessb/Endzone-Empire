/**
 * Browser-decided keyboard focus for the Standard / Scoreboard view toggle (#933).
 *
 * The jsdom suites (SegmentedControl / ToggleMatchupView) bind that the roving
 * move calls `.focus()` and that the tabIndex flips, but two things here are the
 * BROWSER's to decide, not jsdom's, and the ticket was filed about exactly them:
 *
 *   1. Whether a real arrow key on the rendered toggle leaves the focus ring on
 *      the option the user just selected. jsdom asserts our own `.focus()` call
 *      landed; Chromium is what actually paints and holds the focus after the
 *      keydown, the preventDefault and the React re-render.
 *   2. Whether the group is then a SINGLE tab stop - the reported symptom was
 *      that after an arrow the desynced (unchecked, tabindex -1) button still
 *      held focus while the tab stop had moved to the other radio, so Tab landed
 *      on that other radio first and it took TWO presses to leave the group.
 *      Roving tabindex Tab traversal is decided by the browser, so it is
 *      measured here rather than asserted through userEvent.tab in jsdom.
 *
 * It also guards, in the browser, that the MatchupPage "Full comparison" focus
 * move (a DISJOINT mechanism this ticket must not touch) still returns focus to
 * the toggle after that action - the repo's only other focus behaviour bound to
 * this control.
 *
 * Runs in the `browser-security` job (`npm run test:e2e`, which collects every
 * spec under tests/e2e with no file argument), Chromium-only. It imports the
 * #920 layout-guard fixture read-only for its mocked `/api/**` origin and the
 * Matchup route; it binds focus, not geometry, so it duplicates no layout
 * assertion.
 */
import { expect, test } from '@playwright/test';
import { setupLayoutGuard, MATCHUP_URL } from './fixtures/layoutGuardFixtures';

const TOGGLE = '[data-testid="toggle-matchup-view"]';

// A wide viewport, so the header keeps the toggle (it drops below 600) and there
// is a later header control (Set lineup) for Tab to land on when it leaves the
// group.
test.beforeEach(async ({ page }) => {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(MATCHUP_URL);
  await page.getByRole('radio', { name: 'Standard', exact: true }).waitFor();
  await page.getByTestId('slot-row').first().waitFor();
});

test('an arrow key carries focus to the neighbour, and the group is then one Tab from leaving', async ({ page }) => {
  const standard = page.getByRole('radio', { name: 'Standard', exact: true });
  const scoreboard = page.getByRole('radio', { name: 'Scoreboard', exact: true });

  await standard.focus();
  await expect(standard).toBeFocused();

  await page.keyboard.press('ArrowRight');

  // The move-focus half: Chromium holds the focus ring on the newly checked
  // option, not on the button just unchecked.
  await expect(scoreboard).toBeFocused();
  await expect(scoreboard).toBeChecked();
  await expect(scoreboard).toHaveAttribute('tabindex', '0');
  await expect(standard).not.toBeChecked();
  await expect(standard).toHaveAttribute('tabindex', '-1');

  // The single-tab-stop half (the reported symptom): one Tab press leaves the
  // group. Before #933 focus was on the unchecked Standard while the tab stop
  // was Scoreboard, so this Tab landed on Scoreboard and a second was needed.
  await page.keyboard.press('Tab');
  const focusInGroup = await page.evaluate((sel) => {
    const group = document.querySelector(sel);
    return !!(group && document.activeElement && group.contains(document.activeElement));
  }, TOGGLE);
  expect(focusInGroup, 'one Tab after an arrow move must leave the toggle group').toBe(false);
});

test('the disjoint "Full comparison" action still returns focus to the toggle (out of scope: not deleted)', async ({ page }) => {
  // Into Scoreboard view, where the Lineups card grows the "Full comparison"
  // button; its own button unmounts with the view when it fires, so the page's
  // one-shot focus effect is the only thing that can move focus back.
  await page.getByRole('radio', { name: 'Scoreboard', exact: true }).click();
  const fullComparison = page.getByRole('button', { name: 'Full comparison' });
  await fullComparison.click();

  const standard = page.getByRole('radio', { name: 'Standard', exact: true });
  await expect(standard).toBeChecked();
  await expect(standard).toBeFocused();
});
