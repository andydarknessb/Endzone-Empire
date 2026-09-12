import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import TeamSummaryStrip from '../index';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

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

// The widget takes `week`/`viewerTeamId` as props (formal review finding
// ac1-widgets-reach-below-the-island): the page supplies them from its own
// useLeague read rather than this widget calling the hook itself, so no
// /api/league/1 mock is needed here at all.
const renderStrip = (props) => renderWithProviders(<TeamSummaryStrip leagueId={1} week={1} viewerTeamId={3} {...props} />);

test('a loading matchup read shows skeletons and is aria-busy', async () => {
  mockGetByUrl({ [LIST_URL]: new Promise(() => {}) });
  renderStrip({ lineup: lineup([]) });
  await waitFor(() => expect(screen.getByTestId('team-summary-strip')).toHaveAttribute('aria-busy', 'true'));
});

test('a ready matchup shows the score/projected figures, players remaining, and locked count', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [row({ home_expected_final: '95.4', away_expected_final: '88.1', home_players_remaining: 3 })],
    },
  });
  renderStrip({ lineup: lineup([starter({ playerId: 1, locked: true }), starter({ playerId: 2, locked: false })]) });

  expect(await screen.findByTestId('strip-score')).toHaveTextContent('95.4');
  expect(screen.getByTestId('strip-opponent-score')).toHaveTextContent('88.1');
  expect(screen.getByTestId('strip-starters-remaining')).toHaveTextContent('3 to play');
  expect(screen.getByTestId('strip-starters-locked')).toHaveTextContent('1 of 2');
});

test('a bench/IR/spent entry never counts toward locked starters', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [row()] } });
  renderStrip({
    lineup: lineup([
      starter({ playerId: 1, locked: true }),
      { playerId: 2, slot: 'BENCH', locked: true, spent: false },
      { playerId: 3, slot: 'IR', locked: true, spent: false },
      starter({ playerId: 4, locked: true, spent: true }),
    ]),
  });
  expect(await screen.findByTestId('strip-starters-locked')).toHaveTextContent('1 of 1');
});

test('win probability renders once the matchup has started', async () => {
  mockGetByUrl({
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
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

// AC4 (formal review finding ac4-win-probability-gated-on-kickoff): the
// figure must not be gated on the matchup having started - pre-kickoff it
// reads purely off the two projected totals.
test('win probability also renders before kickoff, from the two projected totals alone', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [row({ status: 'scheduled', home_expected_final: '95', away_expected_final: '85' })],
    },
  });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

test('no matchup this week renders the empty state, never an error', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByText('No matchup this week')).toBeInTheDocument();
});

// #1238 AC4: the advice tile.
test('the advice tile shows the gain and swap count when the advice names a suggestion', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }], movePlan: [{ playerId: 1, toSlot: 'RB' }], projectedTotal: 90, optimalTotal: 96.5 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('+6.5 pts · 1 swap');
});

test('the advice tile pluralizes two or more swaps', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }, { slot: 'WR' }], movePlan: [], projectedTotal: 90, optimalTotal: 100 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('2 swaps');
});

test('the advice tile reads "Lineup set" when there is no suggestion', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]), advice: { suggestions: [], movePlan: [] } });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('Lineup set');
});

test('the advice tile also reads "Lineup set" with no advice prop at all (best ball)', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('Lineup set');
});

test('the advice tile renders even when the matchup read errors, never hidden behind it', async () => {
  mockGetByUrl({ [LIST_URL]: Promise.reject(new Error('boom')) });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }], movePlan: [], projectedTotal: 90, optimalTotal: 96.5 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('+6.5 pts · 1 swap');
});
