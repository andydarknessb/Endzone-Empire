// Coverage for the Draft browser expected-console-error contract (issue #541).
//
// Two layers:
//   1. Pure reconciler tests (no page) that pin every direction of the contract
//      - a precise declaration passes only when its error occurs (AC1); an
//      undeclared error fails with its raw text kept (AC2); a declaration that
//      never fires fails and is named (AC3); multiple declarations do not
//      cross-match and one error cannot broadly suppress (AC6); a spec that
//      declares nothing keeps the empty-console contract (AC5).
//   2. End-to-end tests that drive the real harness `test` fixture over a routed
//      blank page, proving the wiring goes red for the right reason - including
//      the one that looks safe but is not: an uncaught page error is NOT
//      suppressible through a console-error declaration (AC4).
import { test as base, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { test } from './fixtures/draftHarness';
import {
  reconcileConsoleErrors,
  formatReconciliation,
  resourceError,
  appError,
  type CapturedConsoleError,
} from './fixtures/consoleErrorContract';

// --- Layer 1: the pure reconciler (no browser) ---------------------------

const feed403: CapturedConsoleError = {
  text: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
  url: 'http://127.0.0.1:4173/api/league/1/draft-feed',
};
const assets404: CapturedConsoleError = {
  text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
  url: 'http://127.0.0.1:4173/static/js/broken.js',
};
const appBoom: CapturedConsoleError = { text: 'BOOM: render failed', url: '' };

base.describe('console-error contract: the pure reconciler (#541)', () => {
  base('AC1: a precise declaration passes only when that error occurs', () => {
    const decl = resourceError({ status: 403, url: /\/api\/league\/\d+\/draft-feed$/, because: 'member-feed revocation' });
    const ok = reconcileConsoleErrors([feed403], [decl]);
    expect(ok.ok).toBe(true);
    expect(ok.unmatchedActual).toEqual([]);
    expect(ok.unmatchedDeclarations).toEqual([]);

    // The SAME declaration against a run where the 403 never happened fails,
    // because a declaration that never fires is fatal (this is also AC3).
    const absent = reconcileConsoleErrors([], [decl]);
    expect(absent.ok).toBe(false);
    expect(absent.unmatchedDeclarations).toHaveLength(1);
  });

  base('AC2: an undeclared console error fails, with its original text kept for diagnosis', () => {
    const r = reconcileConsoleErrors([assets404], []);
    expect(r.ok).toBe(false);
    expect(r.unmatchedActual).toEqual([assets404]);
    const msg = formatReconciliation(r);
    // The raw message and the endpoint are both present: a reader debugging at a
    // distance gets the text, not a count.
    expect(msg).toContain('status of 404');
    expect(msg).toContain('/static/js/broken.js');
    expect(msg).toContain('UNDECLARED');
  });

  base('AC3: a declared expectation that never appears fails and names the missing declaration', () => {
    const decl = resourceError({ status: 403, url: '/api/league/1/draft-feed', because: 'member-feed 403 revocation' });
    const r = reconcileConsoleErrors([], [decl]);
    expect(r.ok).toBe(false);
    expect(r.unmatchedDeclarations).toEqual([decl]);
    const msg = formatReconciliation(r);
    expect(msg).toContain('DECLARED but never seen');
    // The status, the endpoint and the author's reason are all named.
    expect(msg).toContain('status: 403');
    expect(msg).toContain('/api/league/1/draft-feed');
    expect(msg).toContain('member-feed 403 revocation');
  });

  base('AC6: two errors matching one declaration do NOT discharge a second declaration (no cross-match)', () => {
    const declA = resourceError({ status: 403, url: '/api/league/1/draft-feed', because: 'A' });
    const declB = resourceError({ status: 409, url: '/api/draft/queue', because: 'B' });
    // Two A-shaped errors, nothing B-shaped.
    const feed403b: CapturedConsoleError = { ...feed403 };
    const r = reconcileConsoleErrors([feed403, feed403b], [declA, declB]);
    // Nothing is undeclared (both match A)...
    expect(r.unmatchedActual).toEqual([]);
    // ...but B never fired, so the run still fails. One noisy error cannot
    // silently satisfy the whole list.
    expect(r.ok).toBe(false);
    expect(r.unmatchedDeclarations).toEqual([declB]);
  });

  base('AC6: a text pattern can never broadly suppress a resource-load error', () => {
    // appError deliberately never matches a "Failed to load resource" line, so
    // this is the smuggled blanket-ignore that CANNOT work.
    const broadish = appError({ text: /status of 403/, because: 'tries (and fails) to swallow the 403' });
    const r = reconcileConsoleErrors([feed403], [broadish]);
    expect(r.ok).toBe(false);
    // The resource error is still undeclared, AND the app declaration never fired.
    expect(r.unmatchedActual).toEqual([feed403]);
    expect(r.unmatchedDeclarations).toEqual([broadish]);
  });

  base('AC6/AC3: a single error cannot witness two OVERLAPPING declarations (no double-discharge)', () => {
    // Both declarations match the one feed403 error: its url contains both
    // "league" and "draft-feed". A naive independent check would mark both
    // satisfied; the bipartite matching lets the single error witness only ONE,
    // so the other is reported as never seen and the run fails. This is the
    // anti-rot guarantee holding for overlapping matchers.
    const declFeed = resourceError({ status: 403, url: 'draft-feed', because: 'the feed 403' });
    const declLeague = resourceError({ status: 403, url: 'league', because: 'a different, never-occurring league 403' });
    const r = reconcileConsoleErrors([feed403], [declFeed, declLeague]);
    expect(r.ok).toBe(false);
    expect(r.unmatchedActual).toEqual([]);
    expect(r.unmatchedDeclarations).toHaveLength(1);
    // Two DISTINCT errors witness both.
    const feed403b: CapturedConsoleError = { ...feed403, url: feed403.url.replace('/1/', '/2/') };
    expect(reconcileConsoleErrors([feed403, feed403b], [declFeed, declLeague]).ok).toBe(true);
  });

  base('a status matcher is a bounded token: status 40 does not match "status of 403"', () => {
    const decl40 = resourceError({ status: 40, url: /draft-feed$/, because: 'typo status' });
    const r = reconcileConsoleErrors([feed403], [decl40]);
    // The 403 error is undeclared (40 != 403), and the 40 declaration never fires.
    expect(r.ok).toBe(false);
    expect(r.unmatchedActual).toEqual([feed403]);
    expect(r.unmatchedDeclarations).toEqual([decl40]);
  });

  base('a declaration is witnessed by one of several identical errors (refresh that 401s twice)', () => {
    const refreshA: CapturedConsoleError = {
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
      url: 'http://127.0.0.1:4173/api/auth/refresh',
    };
    const refreshB: CapturedConsoleError = { ...refreshA };
    const decl = resourceError({ status: 401, url: /\/api\/auth\/refresh$/, because: 'anonymous boot refresh' });
    const r = reconcileConsoleErrors([refreshA, refreshB], [decl]);
    expect(r.ok).toBe(true);
    expect(r.matched[0].hits).toHaveLength(2);
  });

  base('appError matches an app console.error exactly and passes', () => {
    const decl = appError({ text: 'BOOM: render failed', because: 'a scenario that intentionally logs this' });
    const r = reconcileConsoleErrors([appBoom], [decl]);
    expect(r.ok).toBe(true);
  });

  base('AC5: no declarations keeps the empty-console contract as the natural zero case', () => {
    // Zero errors, zero declarations: passes.
    expect(reconcileConsoleErrors([], []).ok).toBe(true);
    // Any error with zero declarations: fails, exactly as before #541.
    expect(reconcileConsoleErrors([feed403], []).ok).toBe(false);
    expect(reconcileConsoleErrors([appBoom], []).ok).toBe(false);
  });

  base('resourceError refuses a declaration with no endpoint (a status alone is a blanket ignore)', () => {
    expect(() => resourceError({ status: 403, url: '', because: 'x' })).toThrow(/endpoint/);
    // @ts-expect-error url omitted on purpose
    expect(() => resourceError({ status: 403, because: 'x' })).toThrow(/endpoint/);
  });
});

// --- Layer 2: the real harness fixture over a routed page ----------------

// Serve a blank document at the base origin and answer a couple of api paths
// with chosen statuses, so an XHR (the same transport axios uses in the app)
// produces a real "Failed to load resource" console error whose location URL is
// the endpoint. No app server is needed.
async function routeBlank(page: Page) {
  await page.route('**/*', (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/draft-feed')) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' });
    }
    if (path.includes('/missing')) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"missing"}' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>contract</h1></body></html>' });
  });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
}

function xhrGet(page: Page, url: string) {
  return page.evaluate(
    (u) =>
      new Promise<void>((resolve) => {
        const x = new XMLHttpRequest();
        x.open('GET', u);
        x.onloadend = () => resolve();
        x.send();
      }),
    url
  );
}

// The resource-load console error is delivered asynchronously over CDP, after
// the XHR itself resolves. Wait for the specific console line so reconciliation
// at teardown sees it deterministically, rather than racing it (no fixed sleep).
// The listener is attached before the trigger, so a future event is never missed.
function awaitConsoleError(page: Page, needle: RegExp) {
  return page.waitForEvent('console', {
    predicate: (m) => m.type() === 'error' && needle.test(m.text()),
    timeout: 5000,
  });
}

test.describe('console-error contract: end-to-end over the harness fixture (#541)', () => {
  test('AC1 positive: a declared 403 lets teardown pass', async ({ page, expectConsoleError }) => {
    expectConsoleError.resourceError({
      status: 403,
      url: /\/api\/league\/\d+\/draft-feed$/,
      because: 'contract self-test: an intentional member-feed 403',
    });
    await routeBlank(page);
    const seen = awaitConsoleError(page, /status of 403/);
    await xhrGet(page, '/api/league/1/draft-feed');
    await seen;
    // Nothing to assert in the body: the proof is that the fixture teardown
    // reconciles the declared 403 and does not fail this test.
    await expect(page.getByRole('heading', { name: 'contract' })).toBeVisible();
  });

  // test.fail: the run is GREEN only if teardown actually fails. This proves the
  // wiring, not just the pure reconciler, rejects an undeclared console error
  // (AC2) - with the original message still on the console for diagnosis.
  test('AC2 negative: an undeclared console error fails teardown', async ({ page }) => {
    test.fail();
    await routeBlank(page);
    const seen = awaitConsoleError(page, /status of 404/);
    await xhrGet(page, '/api/missing/thing');
    await seen;
    await expect(page.getByRole('heading', { name: 'contract' })).toBeVisible();
  });

  // The AC4 trap pl-endzone flagged: declare a console error whose text WOULD
  // match an uncaught page error, satisfy the console side, then throw an
  // uncaught exception. test.fail asserts teardown STILL fails - the pageerror
  // channel is separate and never reconciled, so a console declaration cannot
  // discharge it.
  test('AC4 negative: an uncaught page error is not suppressible through a console declaration', async ({ page, expectConsoleError }) => {
    test.fail();
    // This declaration satisfies the console channel, and its text is identical
    // to the uncaught error we are about to throw.
    expectConsoleError.appError({ text: 'BOOM sentinel', because: 'contract self-test: matches the console error, must NOT reach the pageerror' });
    await routeBlank(page);
    await page.evaluate(() => {
      // eslint-disable-next-line no-console
      console.error('BOOM sentinel');
      // An uncaught exception (thrown from a timer so page.evaluate does not
      // catch it) raises a real 'pageerror' event.
      setTimeout(() => {
        throw new Error('BOOM sentinel');
      }, 0);
    });
    await expect(page.getByRole('heading', { name: 'contract' })).toBeVisible();
    // Give the timer a tick to throw before teardown.
    await page.waitForTimeout(50);
  });
});
