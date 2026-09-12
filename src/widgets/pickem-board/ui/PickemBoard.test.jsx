import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import PickemBoard from '../index';

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

const LEAGUE_ID = 1;

const leagueResponse = () => ({
  data: {
    viewerTeamId: 3,
    league: { id: LEAGUE_ID, name: 'MinneApple', current_week: 3 },
    teams: [{ teamId: 3, teamName: 'A' }, { teamId: 7, teamName: 'B' }],
  },
});

const openGame = () => ({
  gameKey: 'NYJ|TEN',
  teams: ['NYJ', 'TEN'],
  kickoffAt: '2026-09-20T17:00:00Z', // a Sunday early game (1pm ET)
  homeTeam: 'TEN',
  awayTeam: 'NYJ',
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  quarter: null,
  timeRemaining: null,
  locked: false,
  winner: null,
  isTie: false,
  pickedCount: 1,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
});

const weekResponse = (overrides = {}) => ({
  data: {
    season: 2026,
    week: 3,
    mode: 'straight',
    games: [openGame()],
    myPicks: [],
    othersPicks: {},
    ...overrides,
  },
});

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
};

test('renders the week stepper and the slate\'s game cards, grouped by kickoff window', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse(),
  });
  render(<PickemBoard leagueId={LEAGUE_ID} />);

  expect(await screen.findByTestId('game-card')).toBeInTheDocument();
  expect(screen.getByTestId('pick-week')).toBeInTheDocument();
  expect(screen.getByTestId('kickoff-window-sunday-early')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Titans/i })).toBeInTheDocument();
});

test('an unreachable week shows a compact, self-contained error', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(leagueResponse());
    return Promise.reject(new Error('boom'));
  });
  render(<PickemBoard leagueId={LEAGUE_ID} />);
  expect(await screen.findByTestId('pickem-board-error')).toBeInTheDocument();
  expect(screen.queryByTestId('game-card')).not.toBeInTheDocument();
});

test('a week with no games renders the empty state, not a blank board', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse({ games: [] }),
  });
  render(<PickemBoard leagueId={LEAGUE_ID} />);
  expect(await screen.findByTestId('pickem-board-empty')).toHaveTextContent('No games scheduled for week 3');
});

test('picking a winner then saving round-trips through the save bar', async () => {
  const user = userEvent.setup();
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse(),
  });
  apiClient.put.mockResolvedValue({ data: { saved: 1 } });
  render(<PickemBoard leagueId={LEAGUE_ID} />);

  await screen.findByTestId('game-card');
  expect(screen.getByTestId('save-bar-save')).toBeDisabled();

  await user.click(screen.getByRole('button', { name: /Titans/i }));
  expect(screen.getByTestId('save-bar-save')).not.toBeDisabled();

  await user.click(screen.getByTestId('save-bar-save'));

  expect(apiClient.put).toHaveBeenCalledWith(
    '/api/pickem/league/1/week/3/picks',
    { picks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: null }] }
  );
});
