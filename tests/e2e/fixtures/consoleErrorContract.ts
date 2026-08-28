// The Draft browser fixture's expected-console-error contract (issue #541).
//
// The shared Draft harness records every browser console error and, before
// this, asserted the list was empty at teardown. Chromium logs an intentional
// HTTP failure (a 401, 403, 404, 409, 5xx the app drives on purpose) as a
// "Failed to load resource" console error, so EVERY legitimate error path was
// unprovable in a browser by construction: the very paths where behaviour
// matters most and hand-testing helps least.
//
// This module is the pure core that lets a spec declare a narrow, exact
// expectation instead. It has no Playwright import and no page: it is a
// function of two plain lists (what the browser logged, what the spec
// declared) so it can be unit-tested directly, and the harness teardown is a
// thin caller over it.
//
// THE CONTRACT IS BIDIRECTIONAL, and both directions are load-bearing:
//   - every actual console error must match a declaration, or teardown fails
//     (an undeclared error is still a real error);
//   - every declaration must match an actual console error, or teardown fails
//     (a declaration that never fires is how a guard rots into a permanent
//     silencer: the day a real regression brings that error back, it is
//     pre-approved and invisible).
//
// EXPLICIT, NOT BROAD. A declaration of `/Failed to load resource/` would
// satisfy "the spec declared something" while matching every failed resource in
// the run - an unintended 404, a broken asset, a CDN timeout. That is the
// global resource-ignore this mechanism exists to replace, smuggled back in per
// test. Two structural rules prevent it, so specificity is not left to
// discipline:
//   1. `resourceError` requires BOTH an HTTP status and a url that names the
//      endpoint. It can only ever match one endpoint failing with one status,
//      never "any failed resource".
//   2. `appError` matches ONLY app-emitted console errors (never a
//      "Failed to load resource" line), so a text pattern can never be used to
//      swallow a resource-load failure.

/** One console error the browser logged, as the harness captured it. */
export type CapturedConsoleError = {
  /** The console message text, exactly as the browser logged it. */
  text: string;
  /**
   * The resource URL for a failed-load error (Chromium puts it on the console
   * message location, not in the text); the empty string for an app-emitted
   * `console.error`.
   */
  url: string;
};

/** The Chromium prefix for a failed resource load (a 4xx/5xx or a network drop). */
export const RESOURCE_ERROR_PREFIX = 'Failed to load resource';

/** Whether a captured console error is a failed resource load rather than an app error. */
export function isResourceError(rec: CapturedConsoleError): boolean {
  return rec.text.startsWith(RESOURCE_ERROR_PREFIX);
}

/**
 * A single expected-console-error declaration. `matches` decides whether a
 * captured error is an instance of what was declared; `describe` and `label`
 * exist only so a declaration that never fires can be named back to its author
 * in the teardown failure output (issue #541 AC3).
 */
export type ConsoleErrorDeclaration = {
  /** The `because` the author gave: why this error is expected. Shown verbatim. */
  label: string;
  /** How the declaration was written (status + endpoint, or text), for the report. */
  describe: string;
  /** True when this captured error is an instance of what was declared. */
  matches: (rec: CapturedConsoleError) => boolean;
};

function urlMatches(url: string, pattern: string | RegExp): boolean {
  return typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);
}

/**
 * Declare an expected console error for an intentional HTTP failure. This is
 * the paved path a spec uses to prove a 401/403/404/409/5xx behaviour in the
 * browser. It requires BOTH:
 *   - `status`: the exact HTTP status the browser will report, and
 *   - `url`: a substring or RegExp that names the endpoint,
 * so it can only match that endpoint failing with that status. A broad match
 * (every failed resource) is not expressible through it - that is the point.
 * `because` is required and rides into the failure output if the declaration
 * never fires.
 */
export function resourceError(spec: { status: number; url: string | RegExp; because: string }): ConsoleErrorDeclaration {
  const { status, url, because } = spec;
  if (!Number.isInteger(status)) {
    throw new Error('resourceError({ status }) must be an integer HTTP status, e.g. 403');
  }
  if (url == null || url === '') {
    throw new Error('resourceError({ url }) must name the endpoint (a string fragment or RegExp); a status alone is a blanket ignore');
  }
  if (!because) {
    throw new Error('resourceError({ because }) must say why this error is expected');
  }
  const shownUrl = url instanceof RegExp ? String(url) : JSON.stringify(url);
  return {
    label: because,
    describe: `resourceError { status: ${status}, url: ${shownUrl} }`,
    // A resource-load error whose text carries this status AND whose location
    // url matches the named endpoint. Both are required, so a 404 on some other
    // endpoint is never discharged by a declaration meant for a 403 here.
    matches: (rec) => isResourceError(rec) && rec.text.includes(`status of ${status}`) && urlMatches(rec.url, url),
  };
}

/**
 * Declare an expected app-emitted `console.error` (never a resource load).
 * `text` is matched exactly when a string, or by `.test` when a RegExp. This
 * declaration deliberately never matches a "Failed to load resource" line, so
 * a text pattern can never be used to broadly suppress resource errors - the
 * one anti-pattern this whole contract exists to keep out.
 */
export function appError(spec: { text: string | RegExp; because: string }): ConsoleErrorDeclaration {
  const { text, because } = spec;
  if (text == null || text === '') {
    throw new Error('appError({ text }) must be a non-empty string or a RegExp');
  }
  if (!because) {
    throw new Error('appError({ because }) must say why this error is expected');
  }
  const shown = text instanceof RegExp ? String(text) : JSON.stringify(text);
  return {
    label: because,
    describe: `appError { text: ${shown} }`,
    matches: (rec) => !isResourceError(rec) && (typeof text === 'string' ? rec.text === text : text.test(rec.text)),
  };
}

export type Reconciliation = {
  /** True only when nothing is undeclared AND every declaration fired. */
  ok: boolean;
  /** Declarations that matched at least one captured error, with their hits. */
  matched: Array<{ declaration: ConsoleErrorDeclaration; hits: CapturedConsoleError[] }>;
  /** Captured console errors that matched no declaration (still fatal). */
  unmatchedActual: CapturedConsoleError[];
  /** Declarations that matched no captured error (stale/rotting; fatal). */
  unmatchedDeclarations: ConsoleErrorDeclaration[];
};

/**
 * Reconcile what the browser logged against what the spec declared. The two
 * directions are computed INDEPENDENTLY on purpose, which is exactly what stops
 * declarations from cross-matching (issue #541 AC6): if a spec declares A and B
 * and two A-shaped errors occur, both actuals match A (nothing undeclared), but
 * declaration B still matched nothing, so `ok` is false. One noisy error can
 * never silently discharge a different declaration.
 */
export function reconcileConsoleErrors(
  captured: CapturedConsoleError[],
  declarations: ConsoleErrorDeclaration[]
): Reconciliation {
  const unmatchedActual = captured.filter((rec) => !declarations.some((d) => d.matches(rec)));
  const withHits = declarations.map((declaration) => ({
    declaration,
    hits: captured.filter((rec) => declaration.matches(rec)),
  }));
  const matched = withHits.filter((m) => m.hits.length > 0);
  const unmatchedDeclarations = withHits.filter((m) => m.hits.length === 0).map((m) => m.declaration);
  const ok = unmatchedActual.length === 0 && unmatchedDeclarations.length === 0;
  return { ok, matched, unmatchedActual, unmatchedDeclarations };
}

/**
 * The teardown failure message. It distinguishes the three cases Cory's spec
 * names - matched, unmatched-actual, unmatched-declaration - and prints the RAW
 * message text for every unmatched actual (issue #541 AC2): the person reading
 * this is debugging at a distance with no browser open, and a count is useless
 * to them; the original text is the whole value.
 */
export function formatReconciliation(r: Reconciliation): string {
  const lines: string[] = ['Draft browser console-error contract failed at teardown.'];

  if (r.unmatchedActual.length > 0) {
    lines.push('');
    lines.push(`UNDECLARED console errors (${r.unmatchedActual.length}) - every console error must match a declaration or be fixed:`);
    for (const rec of r.unmatchedActual) {
      lines.push(`  - ${rec.text}${rec.url ? `  [${rec.url}]` : ''}`);
    }
    lines.push('  For an intentional HTTP failure declare it with');
    lines.push('    expectConsoleError.resourceError({ status, url, because })');
    lines.push('  naming the status AND the endpoint (never a bare pattern). Otherwise the app error is real - fix it.');
  }

  if (r.unmatchedDeclarations.length > 0) {
    lines.push('');
    lines.push(`DECLARED but never seen (${r.unmatchedDeclarations.length}) - the expected error did not occur, so this declaration is stale or wrong:`);
    for (const d of r.unmatchedDeclarations) {
      lines.push(`  - ${d.describe}  (because: ${d.label})`);
    }
    lines.push('  A declaration that never matches is how this guard rots into a silencer. Remove it, or fix the');
    lines.push('  scenario so the expected error actually occurs.');
  }

  if (r.matched.length > 0) {
    lines.push('');
    lines.push(`(matched and allowed: ${r.matched.length} declaration(s) - ${r.matched.reduce((n, m) => n + m.hits.length, 0)} console error(s))`);
  }

  return lines.join('\n');
}
