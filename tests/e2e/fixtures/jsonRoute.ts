// Shared by every mocked `page.route` handler under tests/e2e: fulfills a
// Playwright route with a JSON body, so each spec/harness doesn't redefine
// the same three-line helper.
import type { Route } from '@playwright/test';

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
