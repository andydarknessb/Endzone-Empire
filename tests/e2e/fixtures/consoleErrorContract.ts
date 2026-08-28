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
  // Bound the status to a whole token, so a typo like status 40 does not match
  // "status of 403" as a substring. The trailing boundary keeps 40 from
  // matching 403 while 403 still matches "status of 403 (Forbidden)".
  const statusText = new RegExp(`status of ${status}\\b`);
  return {
    label: because,
    describe: `resourceError { status: ${status}, url: ${shownUrl} }`,
    // A resource-load error whose text carries this status AND whose location
    // url matches the named endpoint. Both are required, so a 404 on some other
    // endpoint is never discharged by a declaration meant for a 403 here.
    matches: (rec) => isResourceError(rec) && statusText.test(rec.text) && urlMatches(rec.url, url),
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
 * Whether every declaration can be WITNESSED by a DISTINCT captured error, as a
 * maximum bipartite matching (Kuhn's augmenting-path algorithm over the tiny
 * per-test lists). Each captured error is owned by at most one declaration, so
 * one error can never witness two declarations at once. This is what makes the
 * anti-rot guarantee hold even for overlapping declarations (issue #541 AC6/AC3):
 * declare A and B whose matchers overlap, get a single error that matches both,
 * and only one of them is witnessed - the other is reported as never seen.
 * Returns which declaration owns each captured error (or -1), so the caller can
 * name the unwitnessed declarations.
 */
function matchDeclarationsToDistinctErrors(
  captured: CapturedConsoleError[],
  declarations: ConsoleErrorDeclaration[]
): { witnessed: boolean[] } {
  const owner = new Array<number>(captured.length).fill(-1);
  const witnessed = new Array<boolean>(declarations.length).fill(false);

  const augment = (d: number, seen: boolean[]): boolean => {
    for (let i = 0; i < captured.length; i += 1) {
      if (seen[i] || !declarations[d].matches(captured[i])) continue;
      seen[i] = true;
      if (owner[i] === -1 || augment(owner[i], seen)) {
        owner[i] = d;
        return true;
      }
    }
    return false;
  };

  for (let d = 0; d < declarations.length; d += 1) {
    witnessed[d] = augment(d, new Array<boolean>(captured.length).fill(false));
  }
  return { witnessed };
}

/**
 * Reconcile what the browser logged against what the spec declared. Both
 * directions are load-bearing (issue #541):
 *   - an actual console error is UNDECLARED unless some declaration matches it;
 *   - a declaration is UNMATCHED unless a DISTINCT actual error witnesses it,
 *     computed as a bipartite matching so one error cannot discharge two
 *     overlapping declarations (AC6), and a stale declaration cannot ride on an
 *     unrelated error (AC3 anti-rot).
 * A declaration may legitimately be witnessed by one of several identical errors
 * (e.g. a refresh that 401s twice), so a matched declaration still reports every
 * error it matched as its hits.
 */
export function reconcileConsoleErrors(
  captured: CapturedConsoleError[],
  declarations: ConsoleErrorDeclaration[]
): Reconciliation {
  const unmatchedActual = captured.filter((rec) => !declarations.some((d) => d.matches(rec)));
  const { witnessed } = matchDeclarationsToDistinctErrors(captured, declarations);
  const matched = declarations
    .map((declaration, d) => ({ declaration, hits: captured.filter((rec) => declaration.matches(rec)), d }))
    .filter((m) => witnessed[m.d])
    .map(({ declaration, hits }) => ({ declaration, hits }));
  const unmatchedDeclarations = declarations.filter((_, d) => !witnessed[d]);
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
