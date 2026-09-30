import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TrophyCase from './TrophyCase';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const trophies = [
  {
    id: 1,
    type: 'weekly_high',
    label: 'Weekly High Score',
    week: 4,
    season: 2026,
    team_id: 10,
    team_name: 'Sunday Ballers',
    data: {},
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 2,
    type: 'champion',
    label: 'League Champion',
    week: null,
    season: 2025,
    team_id: 11,
    team_name: "Alice's Team",
    data: {},
    awarded_at: '2025-12-30T00:00:00.000Z',
  },
  {
    id: 3,
    type: 'closest_game',
    label: 'Closest Game',
    week: 4,
    season: 2026,
    team_id: 12,
    team_name: 'Cardiac Comebacks',
    data: { margin: 0.01 },
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
];

test('renders trophies with team names, defaulting to the current (latest) season', async () => {
  apiClient.get.mockResolvedValue({ data: trophies });

  renderWithProviders(<TrophyCase leagueId={1} />);

  expect(await screen.findByTestId('trophy-case')).toBeInTheDocument();
  // The per-team tally repeats names and labels, so read the chips by id.
  expect(screen.getByTestId('trophy-1')).toHaveTextContent('Weekly High Score');
  expect(screen.getByTestId('trophy-1')).toHaveTextContent('Sunday Ballers');
  expect(screen.getByTestId('trophy-3')).toHaveTextContent('Closest Game');
  expect(screen.getByTestId('trophy-3')).toHaveTextContent('Cardiac Comebacks');
  // 2025's champion trophy should not show by default since 2026 is the latest season
  expect(screen.queryByText(/League Champion/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('trophy-2')).not.toBeInTheDocument();
});

// This card and RecapCard were the route's two literal h6s (ADR 0021: the
// outline read h1, h6, h2, h2, h6). Asserted here rather than from the page
// test, which mocks this component as a bare div.
test('renders its heading at level 2', async () => {
  apiClient.get.mockResolvedValue({ data: trophies });

  renderWithProviders(<TrophyCase leagueId={1} />);

  const card = await screen.findByTestId('trophy-case');
  const heading = screen.getByRole('heading', { level: 2, name: 'Trophy Case' });
  expect(screen.queryByRole('heading', { level: 6 })).not.toBeInTheDocument();
  expect(card).toHaveAttribute('aria-labelledby', heading.id);
});

// No emoji in product UI: every trophy carries a decorative stroke glyph, and
// a type the client does not know still gets the medal fallback.
test('marks each trophy with a decorative stroke icon, no emoji', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      ...trophies,
      { ...trophies[0], id: 4, type: 'invented_by_the_server', label: 'Mystery Cup' },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  const card = await screen.findByTestId('trophy-case');

  expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design, so no Testing Library query can reach them
  const iconOf = (testId) => screen.getByTestId(testId).querySelector('svg[data-icon]');
  expect(iconOf('trophy-1')).toHaveAttribute('data-icon', 'flame');
  expect(iconOf('trophy-3')).toHaveAttribute('data-icon', 'compress');
  expect(iconOf('trophy-4')).toHaveAttribute('data-icon', 'medal');
  // eslint-disable-next-line testing-library/no-node-access -- same
  card.querySelectorAll('svg[data-icon]').forEach((icon) => {
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

// #1854: the two lineup trophies are weekly, so each reads "team · Week N", and
// each has its own glyph rather than the medal fallback.
test('shows Perfect Lineup and Captain Hindsight as chips with team and week', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { ...trophies[0], id: 5, type: 'perfect_lineup', label: 'Perfect Lineup', week: 6, team_name: 'Sunday Ballers', data: { points: 98 } },
      { ...trophies[0], id: 6, type: 'captain_hindsight', label: 'Captain Hindsight', week: 7, team_name: 'Cardiac Comebacks', data: { margin: 4 } },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  await screen.findByTestId('trophy-case');

  expect(screen.getByTestId('trophy-5')).toHaveTextContent('Perfect Lineup');
  expect(screen.getByTestId('trophy-5')).toHaveTextContent('Sunday Ballers · Week 6');
  expect(screen.getByTestId('trophy-6')).toHaveTextContent('Captain Hindsight');
  expect(screen.getByTestId('trophy-6')).toHaveTextContent('Cardiac Comebacks · Week 7');
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design
  const iconOf = (testId) => screen.getByTestId(testId).querySelector('svg[data-icon]');
  expect(iconOf('trophy-5')).toHaveAttribute('data-icon', 'target');
  expect(iconOf('trophy-6')).toHaveAttribute('data-icon', 'rebound');
});

test('renders nothing while loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(<TrophyCase leagueId={1} />);
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('hides itself when there are no trophies', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<TrophyCase leagueId={1} teams={[{ id: 10, name: 'Sunday Ballers' }]} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
  // An empty league shows no tally of zeros either.
  expect(screen.queryByTestId('trophy-tally')).not.toBeInTheDocument();
});

// #1855: per-team tally above the chip list, for the selected season.
describe('per-team tally', () => {
  const t = (id, type, label, teamId, teamName, season = 2026, week = 4) => ({
    id, type, label, week, season, team_id: teamId, team_name: teamName, data: {}, awarded_at: '2026-07-01T00:00:00.000Z',
  });
  const season2026 = [
    t(1, 'weekly_high', 'Weekly High Score', 10, 'Sunday Ballers'),
    t(2, 'weekly_high', 'Weekly High Score', 10, 'Sunday Ballers', 2026, 5),
    t(3, 'closest_game', 'Closest Game', 12, 'Cardiac Comebacks'),
    t(4, 'closest_game', 'Closest Game', 10, 'Sunday Ballers'),
    t(5, 'perfect_lineup', 'Perfect Lineup', 12, 'Cardiac Comebacks'),
    t(6, 'champion', 'League Champion', 11, "Alice's Team", 2025, null),
  ];
  const teams = [
    { id: 10, name: 'Sunday Ballers', avatar_url: null },
    { id: 11, name: "Alice's Team", avatar_url: null },
    { id: 12, name: 'Cardiac Comebacks', avatar_url: null },
    { id: 13, name: 'Zero Hour', avatar_url: null },
    { id: 14, name: 'Aardvarks', avatar_url: null },
  ];
  const rowOrder = () =>
    screen.getAllByTestId(/^tally-team-/).map((row) => row.getAttribute('data-testid'));

  test('one row per team, ordered by total then name, zero teams included', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    // Sunday Ballers 3, Cardiac Comebacks 2, then the zero teams by name.
    expect(rowOrder()).toEqual([
      'tally-team-10',
      'tally-team-12',
      'tally-team-14',
      'tally-team-11',
      'tally-team-13',
    ]);
    const ballers = screen.getByTestId('tally-team-10');
    expect(ballers).toHaveTextContent('Sunday Ballers');
    expect(ballers).toHaveTextContent('Weekly High Score 2');
    expect(ballers).toHaveTextContent('Closest Game 1');
    expect(ballers).toHaveTextContent('Perfect Lineup 0');
    expect(ballers).toHaveTextContent('Total 3');
    expect(screen.getByTestId('tally-team-12')).toHaveTextContent('Perfect Lineup 1');
    expect(screen.getByTestId('tally-team-13')).toHaveTextContent('Total 0');
    // The 2025 champion trophy is not a 2026 type.
    expect(screen.getByTestId('trophy-tally')).not.toHaveTextContent('League Champion');
  });

  test('follows the season dropdown without another request', async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    await user.click(screen.getByRole('combobox', { name: 'Season' }));
    await user.click(await screen.findByRole('option', { name: '2025' }));

    expect(rowOrder()[0]).toBe('tally-team-11');
    expect(screen.getByTestId('tally-team-11')).toHaveTextContent('League Champion 1');
    expect(screen.getByTestId('tally-team-11')).toHaveTextContent('Total 1');
    expect(screen.getByTestId('trophy-tally')).not.toHaveTextContent('Weekly High Score');
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  test('a type the client has never heard of shows under its server label', async () => {
    apiClient.get.mockResolvedValue({
      data: [...season2026, t(7, 'invented_by_the_server', 'Mystery Cup', 13, 'Zero Hour')],
    });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('tally-team-13')).toHaveTextContent('Mystery Cup 1');
    expect(screen.getByTestId('tally-team-10')).toHaveTextContent('Mystery Cup 0');
  });

  test('without a teams list, teams come from the trophies', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(rowOrder()).toEqual(['tally-team-10', 'tally-team-12']);
  });

  test('is a named list with one item per team', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    const list = screen.getByRole('list', { name: 'Trophies by team' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  test('wraps on a phone: nothing forces a horizontal scroll', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('trophy-tally')).toHaveStyle({ minWidth: '0' });
    expect(screen.getByTestId('tally-team-10')).toHaveStyle({ flexWrap: 'wrap' });
  });
});

test('hides itself on a fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});
