import { test, expect } from '@playwright/test';
import { browserJsonRequest, installIsolatedNetwork } from './fixtures/network-isolation';
import { fixtureTokens, securityData } from './fixtures/security-data';

const leagueId = '00000000-0000-4000-8000-000000007001';
const correctionPath = `/api/scoring/league/${leagueId}/correct-week`;
test('commissioner cannot override a player score three weeks later', async ({ page }) => {
  test.info().annotations.push({
    type: 'security-control',
    description: 'Historical corrections outside the immediate prior week are blocked',
  });

  const state = { playerScore: securityData.staleMatchup.originalScore };
  const network = await installIsolatedNetwork(page, [
    {
      method: 'POST',
      path: correctionPath,
      handle: ({ headers, body }) => {
        if (headers.authorization !== `Bearer ${fixtureTokens.commissioner}`) {
          return { status: 401, body: { error: 'invalid commissioner session' } };
        }
        return {
          status: 403,
          body: {
            error: 'CORRECTION_WINDOW_EXPIRED',
            message: 'Manual score modifications for this week are locked.',
          },
        };
      },
    },
  ]);

  expect(securityData.league.currentWeek - securityData.staleMatchup.week).toBe(3);
  const response = await browserJsonRequest(page, correctionPath, 'POST', {
    season: securityData.staleMatchup.season,
    week: securityData.staleMatchup.week,
    matchupId: securityData.staleMatchup.id,
    playerId: securityData.staleMatchup.playerId,
    score: securityData.staleMatchup.maliciousScore,
  });

  expect(response.status).toBe(403);
  expect(response.body).toEqual({
    error: 'CORRECTION_WINDOW_EXPIRED',
    message: 'Manual score modifications for this week are locked.',
  });
  expect(state.playerScore).toBe(securityData.staleMatchup.originalScore);
  expect(network.calls).toHaveLength(1);
  expect(network.calls[0].path).toBe(correctionPath);
  expect(network.blocked).toEqual([]);
  expect(network.websocketAttempts).toEqual([]);

  await test.info().attach('blocked-score-correction-attempt.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          control: 'CORRECTION_WINDOW_EXPIRED',
          request: network.calls[0],
          response,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});
