// Runtime negative control for the Draft E2E harness coverage recorder
// (issue #474, ADR 0014). The harness records every request its route table
// does not answer, and the shared `test` fixture's teardown fails naming each
// one. This spec deliberately drives one unmocked path through the recorder to
// prove that failure fires with the exact `METHOD /path`, where a bare
// fallthrough 500 would otherwise reach the console only as "Failed to load
// resource: 500" with the path lost.
//
// It is marked expected-to-fail on purpose: a GREEN run here would mean the
// recorder stayed silent on an unanswered endpoint, which is the defect. Run
// it with:  npm run test:e2e:harness-coverage
import { test, expect, installDraftSocketHarness, installDraftRestApi, gotoDraft } from './fixtures/draftHarness';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

test.describe('harness coverage recorder', () => {
  // The teardown assertion is the point of the test, so the whole case is
  // expected to fail; Playwright reports it as an expected failure.
  test.fail();

  test('an unmocked endpoint fails teardown naming its METHOD and path', async ({ page }) => {
    await installDraftSocketHarness(page, ACTIVE_STATE);
    const api = await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
    await gotoDraft(page);
    // A normal render makes only answered calls, so nothing is recorded yet.
    await expect(page.getByText('Bijan Robinson')).toBeVisible();
    expect(api.unmocked).toEqual([]);

    // Now hit a path no responder answers. The route handler records it as
    // `GET /api/e2e-negative-control` and still returns the 500 fallthrough.
    await page.evaluate(() => fetch('/api/e2e-negative-control').then(() => {}, () => {}));
    await expect.poll(() => api.unmocked).toContain('GET /api/e2e-negative-control');

    // The recorder has captured it; the fixture teardown now fails on the
    // non-empty list (the expected failure).
  });
});
