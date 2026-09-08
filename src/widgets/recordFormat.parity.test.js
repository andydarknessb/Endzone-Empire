import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../test-utils/renderWithProviders';
import apiClient from '../api/apiClient';
import { setResource, invalidate } from '../lib/resourceCache';
import { recordsByTeamId } from '../entities/standings';
import StandingsTable from './standings-table';
import TeamLineup from '../components/LineupScreen/TeamLineup';

/**
 * Cross-surface parity for the Record string (#958, amending #942's AC3). A
 * tie-less Team must read the same two-part record everywhere it appears: the
 * standings table, the matchup card's lookup, and the Lineup screen's summary
 * line. #958 exists because useStandingsTable.js and TeamLineup.jsx printed a
 * third, always-zero tie part that the other sites never did; this pins all
 * three to the same conditional rule so the three cannot drift apart again.
 *
 * Since #959 the standings entity owns the one derivation, so this file is no
 * longer guarding three widget formatters against each other: two of the three
 * surfaces below now read the entity, and what is still worth pinning is the
 * THIRD, TeamLineup.jsx, which is a legacy `src/components` screen with its own
 * inline formatter and is out of #959's scope (three widgets). It is the one
 * surface that can still drift, and this is what would catch it.
 *
 * jest.mock below intercepts by resolved module (src/api/apiClient.js), so it
 * covers every import of it regardless of the relative path each component
 * under test uses to reach it.
 */
jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// The one Team row every surface below renders from: 3 wins, 1 loss, no ties.
const TEAM_ID = 501;
const ROW = { teamId: TEAM_ID, wins: 3, losses: 1, ties: 0 };

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('a tie-less Team renders the same record string on the standings table, the matchup card lookup and the Lineup screen', async () => {
  // --- the matchup card's lookup: a pure function, no rendering needed -----
  const matchupCardRecord = recordsByTeamId([ROW]).get(TEAM_ID);
  expect(matchupCardRecord).toBe('3-1');

  // --- the standings table -------------------------------------------------
  setResource(['league', 1], {
    league: { id: 1, draft_status: 'complete', season_status: 'regular', current_week: 6 },
    teams: [{ teamId: TEAM_ID, id: TEAM_ID, teamName: 'Parity Squad', avatar_url: null, avatar_static_url: null }],
    viewerTeamId: TEAM_ID,
  });
  apiClient.get.mockImplementation((url) => {
    if (String(url).startsWith('/api/scoring/league/1/standings')) {
      return Promise.resolve({
        data: {
          league: { current_week: 6 },
          standings: [{ ...ROW, name: 'RAW', pf: 100, pa: 90, rank: 1, streak: 'W3', winPct: 0.75 }],
        },
      });
    }
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });

  const { unmount: unmountStandings } = renderWithProviders(<StandingsTable leagueId={1} />);
  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Parity Squad');
  const standingsTableRecord = within(card).getByText(matchupCardRecord).textContent;
  unmountStandings();

  // --- the Lineup screen's Team summary line --------------------------------
  jest.clearAllMocks();
  const league = {
    id: 1,
    name: 'Parity League',
    draft_status: 'complete',
    waiver_type: 'priority',
    my_team_id: TEAM_ID,
    my_team_name: 'Parity Squad',
    my_team_waiver_priority: 3,
    my_team_faab_remaining: 100,
    best_ball: false,
  };
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [league] });
    if (url === `/api/team/roster?leagueId=${league.id}`) return Promise.resolve({ data: [] });
    if (String(url).includes('/standings')) {
      return Promise.resolve({ data: { standings: [{ ...ROW, rank: 1 }] } });
    }
    return Promise.resolve({ data: {} });
  });

  renderWithProviders(<TeamLineup />);
  const summaryLine = await screen.findByText((content) => content.startsWith('Record:'));
  const lineupRecord = summaryLine.textContent.match(/^Record: (\S+)/)[1];

  // The same Team row, expressed with the same wins/losses/ties, renders the
  // identical string on every surface: two parts, no printed zero tie.
  expect(standingsTableRecord).toBe(matchupCardRecord);
  expect(lineupRecord).toBe(matchupCardRecord);
  expect(lineupRecord).toBe('3-1');
  expect(lineupRecord).not.toBe('3-1-0');
});
