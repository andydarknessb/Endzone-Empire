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
