import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import { clearLeagueCache } from '../../hooks/useLeague';
import { clearPickemSettingsCache } from '../../entities/pickem-game';
import { clearPickemStandingsCache } from '../../entities/pickem-standings';
import apiClient from '../../api/apiClient';
import PickemPage from './PickemPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

/**
 * Page-composition tests for `pages/pickem` (#1267, ADR 0038). Every branch
 * of the board and standings themselves already has dedicated coverage
 * (widgets/pickem-board and widgets/pickem-standings' own suites, moved and
 * expanded from LeaguePickem.jsx's own by #1265/#1266); this suite proves
 * the page composes them correctly - the disabled/PICKEM_DISABLED state, the
 * commissioner settings widget, the section switch, and the unsaved-picks
 * guard on both a week change and a section switch (ADR 0038's page slice,
 * AC3) - a representative end-to-end check rather than a re-test of a unit
 * already covered elsewhere (`pages/lineup`'s own precedent).
 */
const LEAGUE_ID = 7;
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

const league = (overrides = {}) => ({
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  current_season: 2026,
  current_week: 3,
  ...overrides,
});

const openGame = (overrides = {}) => ({
  gameKey: 'NYJ|TEN',
  teams: ['NYJ', 'TEN'],
  kickoffAt: hoursFromNow(48),
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
  pickedCount: 0,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
  ...overrides,
});

const weekResponse = (week, overrides = {}) => ({
  season: 2026,
  week,
  mode: 'straight',
  games: [openGame()],
  myPicks: [],
  othersPicks: {},
  ...overrides,
});

const standingsResponse = (overrides = {}) => ({
  season: 2026,
  mode: 'straight',
  standings: [],
  ...overrides,
});

const mockRequests = ({
  settings = { enabled: true, mode: 'straight', isCommissioner: false },
  leagueOverrides = {},
  weeks = { 3: weekResponse(3) },
} = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/settings`)) {
      return Promise.resolve({ data: settings });
    }
    const weekMatch = url.match(new RegExp(`/api/pickem/league/${LEAGUE_ID}/week/(\\d+)$`));
    if (weekMatch) {
      const week = Number(weekMatch[1]);
      return Object.prototype.hasOwnProperty.call(weeks, week)
        ? Promise.resolve({ data: weeks[week] })
        : Promise.reject(new Error(`unexpected week GET ${url}`));
    }
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/standings`)) {
      return Promise.resolve({ data: standingsResponse() });
    }
    if (url === `/api/league/${LEAGUE_ID}`) {
      return Promise.resolve({ data: { league: league(leagueOverrides), teams: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
};

const renderPage = () =>
  renderWithProviders(<PickemPage />, {
    route: `/league/${LEAGUE_ID}/pickem`,
    path: '/league/:leagueId/pickem',
  });

beforeEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
  clearPickemSettingsCache();
  clearPickemStandingsCache();
});

test('the breadcrumb, h1 and no skipped heading level render for every state', async () => {
  mockRequests();
  renderPage();

  expect(screen.getByRole('heading', { level: 1, name: "Pick'em" })).toBeInTheDocument();
  await screen.findByRole('button', { name: /Jets/i });
  expect(screen.getByTestId('pickem-breadcrumb')).toHaveTextContent('Sunday Ballers');

  // axe's heading-order rule: a heading's level never jumps past the
  // highest level seen so far by more than one (h1 -> h2 -> h3 is fine;
  // h1 -> h3 with no h2 between is not).
  const levels = screen.getAllByRole('heading').map((el) => Number(el.tagName.slice(1)));
  expect(levels[0]).toBe(1);
  let highestSoFar = 1;
  for (const level of levels) {
    expect(level).toBeLessThanOrEqual(highestSoFar + 1);
    highestSoFar = Math.max(highestSoFar, level);
  }
});

test('a member sees an explanation when the commissioner has not enabled Pick\'em, and no week is fetched', async () => {
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: false } });
  renderPage();

  expect(await screen.findByTestId('pickem-disabled')).toHaveTextContent(/hasn't enabled Pick'em/i);
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining(`/week/`));
});

test('a commissioner sees the settings widget instead of the disabled notice, and can turn it on', async () => {
  const user = userEvent.setup();
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: true } });
  apiClient.put.mockResolvedValue({ data: { enabled: true, mode: 'straight', isCommissioner: true } });
  renderPage();

  const toggle = await screen.findByRole('checkbox', { name: /Enable Pick'em for this league/i });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(`/api/pickem/league/${LEAGUE_ID}/settings`, { enabled: true })
  );
  // Write-through: the board mounts off the saved row with no follow-up GET.
  expect(await screen.findByRole('button', { name: /Jets/i })).toBeInTheDocument();
});

test('an enabled league renders the board for a member, with no settings widget', async () => {
  mockRequests();
  renderPage();

  expect(await screen.findByRole('button', { name: /Jets/i })).toBeInTheDocument();
  expect(screen.queryByTestId('pickem-settings')).not.toBeInTheDocument();
});

test('a commissioner of an enabled league sees the settings widget above the board', async () => {
  mockRequests({ settings: { enabled: true, mode: 'straight', isCommissioner: true } });
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Commissioner settings' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Jets/i })).toBeInTheDocument();
});

test('PICKEM_DISABLED: the settings widget still gates the board behind the switch', async () => {
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: true } });
  renderPage();

  await screen.findByRole('checkbox', { name: /Enable Pick'em for this league/i });
  expect(screen.queryByRole('button', { name: /Jets/i })).not.toBeInTheDocument();
});

test('the section switch moves between the board and the standings, keyed in the URL', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await screen.findByRole('button', { name: /Jets/i });
  await user.click(screen.getByRole('radio', { name: 'Standings' }));

  expect(await screen.findByTestId('pickem-standings')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Jets/i })).not.toBeInTheDocument();
});

test('switching weeks with unsaved picks asks before discarding them', async () => {
  const user = userEvent.setup();
  mockRequests({ weeks: { 3: weekResponse(3), 4: weekResponse(4) } });
  renderPage();

  await user.click(await screen.findByRole('button', { name: /Jets/i }));
  await user.click(screen.getByRole('button', { name: 'Next week' }));

  const dialog = await screen.findByRole('dialog', { name: /Discard unsaved picks/i });
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(await screen.findByRole('button', { name: /Jets/i })).toHaveAttribute('aria-pressed', 'true');

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  const dialog2 = await screen.findByRole('dialog', { name: /Discard unsaved picks/i });
  await user.click(within(dialog2).getByRole('button', { name: 'Discard picks' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(`/api/pickem/league/${LEAGUE_ID}/week/4`)
  );
});

test('switching to Standings with unsaved picks asks before discarding them too', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await user.click(await screen.findByRole('button', { name: /Jets/i }));
  await user.click(screen.getByRole('radio', { name: 'Standings' }));

  const dialog = await screen.findByRole('dialog', { name: /Discard unsaved picks/i });
  await user.click(within(dialog).getByRole('button', { name: 'Discard picks' }));

  expect(await screen.findByTestId('pickem-standings')).toBeInTheDocument();
});

test('saving picks invalidates the cached standings so the Standings tab reflects them', async () => {
  const user = userEvent.setup();
  mockRequests();
  apiClient.put.mockImplementation(async () => {
    mockRequests({ weeks: { 3: weekResponse(3, { myPicks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: null }] }) } });
    return { data: { saved: 1, myPicks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: null }] } };
  });
  renderPage();

  await screen.findByRole('button', { name: /Jets/i });
  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  const standingsCallsBefore = apiClient.get.mock.calls.filter(([u]) => u.includes('/standings')).length;

  await user.click(screen.getByRole('radio', { name: 'Picks' }));
  await user.click(await screen.findByRole('button', { name: /Titans/i }));
  await user.click(screen.getByTestId('save-bar-save'));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());

  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  await waitFor(() => {
    const standingsCallsAfter = apiClient.get.mock.calls.filter(([u]) => u.includes('/standings')).length;
    expect(standingsCallsAfter).toBeGreaterThan(standingsCallsBefore);
  });
});
