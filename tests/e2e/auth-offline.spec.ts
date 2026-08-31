import { expect, test, type Page } from '@playwright/test';
import { json } from './fixtures/jsonRoute';

async function seedSession(page: Page, access = 'old-access-token', refresh = 'old-refresh-token') {
  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('endzone_token', accessToken);
    localStorage.setItem('endzone_refresh', refreshToken);
  }, { accessToken: access, refreshToken: refresh });
}

test.describe('authentication lifecycle', () => {
  test('registration verification moves the profile from pending to active', async ({ page }) => {
    const profile = {
      id: 41,
      username: 'verification-rookie',
      email: 'rookie@example.test',
      account_status: 'pending',
      email_verified: false,
    };
    let registerBody: unknown;
    let verificationBody: unknown;
    let registered = false;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path === '/api/auth/register') {
        registerBody = request.postDataJSON();
        registered = true;
        return json(route, 201, {
          token: 'pending-access-token',
          user: profile,
        });
      }
      if (request.method() === 'POST' && path === '/api/auth/verify-email') {
        verificationBody = request.postDataJSON();
        await new Promise((resolve) => setTimeout(resolve, 150));
        profile.account_status = 'active';
        profile.email_verified = true;
        return json(route, 200, { ok: true });
      }
      if (request.method() === 'GET' && path === '/api/user') {
        return json(route, registered ? 200 : 401, registered ? profile : { error: 'signed out' });
      }
      if (request.method() === 'POST' && path === '/api/auth/refresh') {
        return json(route, 401, { error: 'signed out' });
      }
      if (request.method() === 'GET' && path === '/api/league') return json(route, 200, []);
      if (request.method() === 'GET' && path === '/api/news') return json(route, 200, []);
      if (request.method() === 'GET' && path === '/api/notifications') {
        return json(route, 200, { notifications: [] });
      }
      return json(route, 500, { error: `unexpected mocked request: ${request.method()} ${path}` });
    });

    await page.goto('/#/registration');
    await page.locator('#username').fill(profile.username);
    await page.locator('#email').fill(profile.email);
    await page.locator('#password').fill('InitialPass123!');
    await page.locator('#age-confirmed').check();
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page).toHaveURL(/#\/user$/);
    expect(registerBody).toEqual({
      username: profile.username,
      email: profile.email,
      password: 'InitialPass123!',
    });
    expect(profile.account_status).toBe('pending');

    await page.goto('/#/verify-email?token=verify-fixture-token');
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByText(/email verified/i)).toBeVisible();
    expect(verificationBody).toEqual({ token: 'verify-fixture-token' });

    const refreshedProfile = await page.evaluate(async () => {
      const response = await fetch('/api/user', {
        headers: { Authorization: `Bearer ${localStorage.getItem('endzone_token')}` },
      });
      return response.json();
    });
    expect(refreshedProfile).toMatchObject({ account_status: 'active', email_verified: true });
  });

  test('password reset immediately invalidates the old access and refresh sessions', async ({ page }) => {
    await seedSession(page);
    let sessionValid = true;
    let resetBody: unknown;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const authorization = request.headers().authorization;
      if (request.method() === 'POST' && path === '/api/auth/reset-password') {
        resetBody = request.postDataJSON();
        sessionValid = false;
        return json(route, 200, { ok: true });
      }
      if (request.method() === 'POST' && path === '/api/auth/refresh') {
        return json(route, sessionValid ? 200 : 401, sessionValid
          ? { token: 'rotated-access', refreshToken: 'rotated-refresh' }
          : { error: 'invalid refresh token' });
      }
      if (request.method() === 'GET' && path === '/api/user') {
        if (!sessionValid || authorization !== 'Bearer old-access-token') {
          return json(route, 401, { error: 'invalid token' });
        }
        return json(route, 200, { id: 41, username: 'verification-rookie' });
      }
      return json(route, 200, []);
    });

    await page.goto('/#/reset-password?token=reset-fixture-token');
    await page.locator('#reset-password').fill('ReplacementPass456!');
    await page.locator('#reset-confirm').fill('ReplacementPass456!');
    await page.getByRole('button', { name: 'Reset Password' }).click();
    await expect(page.getByText(/password updated/i)).toBeVisible();
    expect(resetBody).toEqual({ token: 'reset-fixture-token', password: 'ReplacementPass456!' });

    const oldSessionResults = await page.evaluate(async () => {
      const [access, refresh] = await Promise.all([
        fetch('/api/user', { headers: { Authorization: 'Bearer old-access-token' } }),
        fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: 'old-refresh-token' }),
        }),
      ]);
      return { accessStatus: access.status, refreshStatus: refresh.status };
    });
    expect(oldSessionResults).toEqual({ accessStatus: 401, refreshStatus: 401 });
  });
});

test('offline lineup edit is blocked, persisted, and replayed immediately on reconnect', async ({
  page,
  context,
}) => {
  await seedSession(page, 'lineup-access-token', 'lineup-refresh-token');
  await page.addInitScript(() => {
    const attempts: Array<{ method: string; url: string; body: unknown }> = [];
    (window as any).__lineupSubmissionAttempts = attempts;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, ...rest: any[]) {
      (this as any).__requestMethod = method.toUpperCase();
      (this as any).__requestUrl = String(url);
      return originalOpen.call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
      if ((this as any).__requestMethod === 'PUT' && (this as any).__requestUrl.includes('/api/team/lineup')) {
        attempts.push({ method: 'PUT', url: (this as any).__requestUrl, body: body ? JSON.parse(String(body)) : null });
      }
      return originalSend.call(this, body);
    };
  });
  const lineup = {
    leagueId: 7,
    teamId: 70,
    season: 2026,
    week: 8,
    currentWeek: 8,
    rosterSlots: [{ key: 'WR', count: 1, eligiblePositions: ['WR'] }],
    benchSlots: 1,
    irSlots: 0,
    entries: [{
      id: 501,
      name: 'Amon-Ra St. Brown',
      position: 'WR',
      nfl_team: 'DET',
      slot: 'BENCH',
      locked: false,
      onBye: false,
    }],
  };
  const lineupWrites: Array<{ receivedAt: number; body: any }> = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/user') {
      return json(route, 200, { id: 41, username: 'lineup-manager' });
    }
    if (request.method() === 'GET' && url.pathname === '/api/league') {
      return json(route, 200, [{
        id: 7,
        name: 'Offline League',
        best_ball: false,
        draft_status: 'complete',
        my_team_id: 70,
        my_team_name: 'Offline Team',
      }]);
    }
    if (request.method() === 'GET' && url.pathname === '/api/league/7') {
      return json(route, 200, { league: { id: 7, name: 'Offline League', best_ball: false } });
    }
    if (request.method() === 'GET' && url.pathname === '/api/team/roster') {
      return json(route, 200, [{
        id: 501,
        name: 'Amon-Ra St. Brown',
        position: 'WR',
        nfl_team: 'DET',
        lineup_slot: 'BENCH',
      }]);
    }
    if (request.method() === 'GET' && url.pathname === '/api/scoring/league/7/standings') {
      return json(route, 200, { standings: [] });
    }
    if (request.method() === 'GET' && url.pathname === '/api/team/lineup') return json(route, 200, lineup);
    if (request.method() === 'GET' && url.pathname === '/api/team/lineup/advice') {
      return json(route, 200, { projectedTotal: 0, optimalTotal: 0, suggestions: [] });
    }
    if (request.method() === 'GET' && url.pathname === '/api/team/hindsight') {
      return json(route, 200, { totalPointsLeftOnBench: 0 });
    }
    if (request.method() === 'PUT' && url.pathname === '/api/team/lineup') {
      lineupWrites.push({ receivedAt: Date.now(), body: request.postDataJSON() });
      return json(route, 200, { updated: 1 });
    }
    return json(route, 500, { error: `unexpected mocked request: ${request.method()} ${url.pathname}` });
  });

  await page.goto('/#/team?leagueId=7');
  await expect(page.getByTestId('slot-row-BENCH-501')).toBeVisible();
  await page.getByTestId('slot-row-BENCH-501').click();

  const disconnectedAt = Date.now();
  await context.setOffline(true);
  await expect(page.getByText(/you're offline/i)).toBeVisible({ timeout: 1000 });
  expect(Date.now() - disconnectedAt).toBeLessThan(1000);

  await page.getByTestId('slot-row-WR-0').click();
  await page.waitForTimeout(250);
  expect(lineupWrites).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__lineupSubmissionAttempts)).toHaveLength(0);

  const queuedIntents = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key, value]) => /offline|outbox|pending/i.test(key) && value.includes('/api/team/lineup'))
      .map(([key, value]) => ({ key, value: JSON.parse(value) }))
  );
  expect(queuedIntents).toHaveLength(1);
  expect(JSON.stringify(queuedIntents[0].value)).toContain('501');

  const restoredAt = Date.now();
  await context.setOffline(false);
  await expect.poll(() => lineupWrites.length, { timeout: 1000 }).toBe(1);
  expect(await page.evaluate(() => (window as any).__lineupSubmissionAttempts)).toHaveLength(1);
  expect(lineupWrites[0].receivedAt - restoredAt).toBeLessThan(1000);
  expect(lineupWrites[0].body).toMatchObject({
    leagueId: 7,
    week: 8,
    moves: [{ playerId: 501, slot: 'WR' }],
  });
  expect(await page.evaluate(() => localStorage.getItem('pending_lineup_mutations'))).toBeNull();
  await expect(page.getByText(/you're offline/i)).toBeHidden();
  await expect(page.getByText('Lineup saved')).toBeVisible();
  await expect(page.getByTestId('slot-row-WR-0')).toContainText('Amon-Ra St. Brown');
});
