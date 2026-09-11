import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import TeamSummaryStrip from '../index';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
};

const TEAMS = [
  { teamId: 3, id: 3, teamName: 'MyTeam', avatar_url: null, avatar_static_url: null },
  { teamId: 7, id: 7, teamName: 'Rival', avatar_url: null, avatar_static_url: null },
];

const leagueResponse = (league = {}) => ({
  data: { viewerTeamId: 3, league: { id: 1, name: 'League', current_week: 1, ...league }, teams: TEAMS },
});

const row = (over = {}) => ({
  id: 55,
  week: 1,
  season: 2026,
  final: false,
  status: null,
  home_team_id: 3,
  away_team_id: 7,
  home_score: '0.0',
  away_score: '0.0',
  home_expected_final: null,
  away_expected_final: null,
  home_players_remaining: null,
  away_players_remaining: null,
  ...over,
});

const LIST_URL = '/api/league/1/matchups?week=1';

const lineup = (entries) => ({ entries });
const starter = (over = {}) => ({ playerId: 1, slot: 'QB', spent: false, locked: false, ...over });

test('a loading matchup read shows skeletons and is aria-busy', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), [LIST_URL]: new Promise(() => {}) });
  renderWithProviders(<TeamSummaryStrip leagueId={1} lineup={lineup([])} />);
  await waitFor(() => expect(screen.getByTestId('team-summary-strip')).toHaveAttribute('aria-busy', 'true'));
});

test('a ready matchup shows the score/projected figures, players remaining, and locked count', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    [LIST_URL]: {
      data: [row({ home_expected_final: '95.4', away_expected_final: '88.1', home_players_remaining: 3 })],
    },
  });
  renderWithProviders(
    <TeamSummaryStrip
      leagueId={1}
      lineup={lineup([starter({ playerId: 1, locked: true }), starter({ playerId: 2, locked: false })])}
    />
  );

  expect(await screen.findByTestId('strip-score')).toHaveTextContent('95.4');
  expect(screen.getByTestId('strip-opponent-score')).toHaveTextContent('88.1');
  expect(screen.getByTestId('strip-starters-remaining')).toHaveTextContent('3 to play');
  expect(screen.getByTestId('strip-starters-locked')).toHaveTextContent('1 of 2');
});

test('a bench/IR/spent entry never counts toward locked starters', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), [LIST_URL]: { data: [row()] } });
  renderWithProviders(
    <TeamSummaryStrip
      leagueId={1}
      lineup={lineup([
        starter({ playerId: 1, locked: true }),
        { playerId: 2, slot: 'BENCH', locked: true, spent: false },
        { playerId: 3, slot: 'IR', locked: true, spent: false },
        starter({ playerId: 4, locked: true, spent: true }),
      ])}
    />
  );
  expect(await screen.findByTestId('strip-starters-locked')).toHaveTextContent('1 of 1');
});

test('win probability renders once the matchup has started', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    [LIST_URL]: {
      data: [
        row({
          status: 'live',
          home_score: '20', away_score: '10',
          home_expected_final: '95', away_expected_final: '85',
        }),
      ],
    },
  });
  renderWithProviders(<TeamSummaryStrip leagueId={1} lineup={lineup([])} />);
  expect(await screen.findByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

test('no matchup this week renders the empty state, never an error', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), [LIST_URL]: { data: [] } });
  renderWithProviders(<TeamSummaryStrip leagueId={1} lineup={lineup([])} />);
  expect(await screen.findByText('No matchup this week')).toBeInTheDocument();
});
