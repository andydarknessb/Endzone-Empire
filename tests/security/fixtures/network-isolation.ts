import type { Page, Request } from '@playwright/test';
import { appOrigin, fixtureTokens } from './security-data';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type MockEndpoint = {
  method: string;
  path: string | RegExp;
  handle: (request: RecordedRequest) =>
    | { status: number; body: JsonValue }
    | Promise<{ status: number; body: JsonValue }>;
};

function requestBody(request: Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}

function pathMatches(expected: string | RegExp, actual: string): boolean {
  return typeof expected === 'string' ? expected === actual : expected.test(actual);
}

export async function installIsolatedNetwork(page: Page, endpoints: MockEndpoint[] = []) {
  const calls: RecordedRequest[] = [];
  const blocked: RecordedRequest[] = [];
  const websocketAttempts: string[] = [];

  await page.routeWebSocket('**/*', (socket) => {
    websocketAttempts.push(socket.url());
    socket.close({ code: 1008, reason: 'Security suite blocks all WebSocket traffic' });
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const recorded: RecordedRequest = {
      method: request.method().toUpperCase(),
      path: `${url.pathname}${url.search}`,
      headers: request.headers(),
      body: requestBody(request),
    };

    if (request.resourceType() === 'document' && url.origin === appOrigin && url.pathname === '/') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><main id="security-fixture"></main></body></html>',
      });
      return;
    }

    const endpoint = endpoints.find(
      (candidate) =>
        candidate.method.toUpperCase() === recorded.method &&
        pathMatches(candidate.path, url.pathname)
    );
    if (url.origin === appOrigin && endpoint) {
      calls.push(recorded);
      const response = await endpoint.handle(recorded);
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
      return;
    }

    blocked.push(recorded);
    await route.abort('blockedbyclient');
  });

  await page.goto(appOrigin);
  return { calls, blocked, websocketAttempts };
}

export async function browserJsonRequest(
  page: Page,
  path: string,
  method: string,
  payload: Record<string, unknown>
) {
  const role = await page.evaluate(() => window.localStorage.getItem('endzone_security_role'));
  const token =
    role === 'commissioner' || role === 'manager'
      ? fixtureTokens[role]
      : null;
  return page.evaluate(
    async ({ requestPath, requestMethod, requestPayload, accessToken }) => {
      const response = await window.fetch(requestPath, {
        method: requestMethod,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(requestPayload),
      });
      return { status: response.status, body: await response.json() };
    },
    {
      requestPath: path,
      requestMethod: method,
      requestPayload: payload,
      accessToken: token,
    }
  );
}
