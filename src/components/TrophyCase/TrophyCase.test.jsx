import React from 'react';
import { screen, waitFor } from '@testing-library/react';
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
  expect(screen.getByText(/Weekly High Score/)).toBeInTheDocument();
  expect(screen.getByText(/Sunday Ballers/)).toBeInTheDocument();
  expect(screen.getByText(/Closest Game/)).toBeInTheDocument();
  expect(screen.getByText(/Cardiac Comebacks/)).toBeInTheDocument();
  // 2025's champion trophy should not show by default since 2026 is the latest season
  expect(screen.queryByText(/League Champion/)).not.toBeInTheDocument();
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
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('hides itself on a fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});
