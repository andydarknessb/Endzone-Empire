// Shared by the anonymous-visit specs: nothing is signed in, so the refresh cookie is absent and the API answers "no session" without a body.
import type { Page } from '@playwright/test';
import { json } from './jsonRoute';

export async function mockAnonymousApi(page: Page) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/api/auth/refresh') {
      return route.fulfill({ status: 204 });
    }
    if (request.method() === 'GET' && path === '/api/public/rankings') {
      return json(route, 200, {
        rankings: [
          { playerId: 101, rank: 1, name: 'Josh Allen', projectedPoints: 24.8 },
          { playerId: 102, rank: 2, name: 'Christian McCaffrey', projectedPoints: 22.1 },
          { playerId: 103, rank: 3, name: 'Justin Jefferson', projectedPoints: 20.4 },
        ],
      });
    }
    if (request.method() === 'GET' && path === '/api/public/recaps') {
      return json(route, 200, {
        recaps: [
          {
            gameId: '20260112_KC@BUF',
            awayTeam: 'KC',
            awayScore: 27,
            homeScore: 24,
            homeTeam: 'BUF',
            week: 5,
            hook: 'Mahomes answers late to steal one in Buffalo.',
          },
        ],
      });
    }
    return json(route, 404, { error: 'not found' });
  });
}
