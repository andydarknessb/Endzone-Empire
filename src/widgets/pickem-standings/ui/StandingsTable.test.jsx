import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePickemStandings } from '../../../entities/pickem-standings';
import StandingsTable from './StandingsTable';

// Only the entity's network hook is mocked - standingsModel, accuracy,
// bestWeek and trend stay real (pure functions), so the widget's own
// derivation is exercised through them exactly as it runs in production.
jest.mock('../../../entities/pickem-standings', () => ({
  ...jest.requireActual('../../../entities/pickem-standings'),
  usePickemStandings: jest.fn(),
}));

const baseRow = (overrides = {}) => ({
  teamId: 1,
  teamName: 'Gridiron Gamblers',
  avatarUrl: null,
  avatarStaticUrl: null,
  rank: 1,
  previousRank: 1,
  points: 100,
  correct: 10,
  incorrect: 2,
  pushes: 0,
  pending: 1,
  made: 13,
  weekly: { 1: 10 },
  ...overrides,
});

function mockStandings({ standings, viewerTeamId = null, loading = false, error = null }) {
  usePickemStandings.mockReturnValue({
    data: loading ? null : { season: 2026, mode: 'straight', standings, viewerTeamId },
    loading,
    error,
  });
}

afterEach(() => {
  usePickemStandings.mockReset();
});

test('renders from the standings entity only: calls usePickemStandings with the leagueId and no fetch client', () => {
  mockStandings({ standings: [baseRow()], viewerTeamId: 1 });
  render(<StandingsTable leagueId={7} />);
  expect(usePickemStandings).toHaveBeenCalledWith(7, undefined);
});

test('viewer row highlight: the row whose teamId matches viewerTeamId is marked and carries the You pill', () => {
  mockStandings({
    standings: [baseRow({ teamId: 1, teamName: 'Gridiron Gamblers' }), baseRow({ teamId: 2, teamName: 'Blitz Brothers', rank: 2 })],
    viewerTeamId: 2,
  });
  render(<StandingsTable leagueId={7} />);

  const youRow = screen.getByTestId('pickem-standings-you-row');
  expect(within(youRow).getByText('Blitz Brothers')).toBeInTheDocument();
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  // Only one row is marked.
  expect(screen.getAllByTestId('pickem-standings-you-row')).toHaveLength(1);
  expect(within(youRow).queryByText('Gridiron Gamblers')).not.toBeInTheDocument();
});

test('tie ranks share a number: two rows tied at rank 1 both render "T-1"', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Gridiron Gamblers', rank: 1 }),
      baseRow({ teamId: 2, teamName: 'Blitz Brothers', rank: 1 }),
      baseRow({ teamId: 3, teamName: 'Hail Mary Heroes', rank: 3 }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const ranks = screen.getAllByTestId('pickem-standings-rank').map((el) => el.textContent);
  expect(ranks.filter((text) => text === 'T-1')).toHaveLength(2);
  expect(ranks).toContain('3');
});

test('heat cell shading buckets: a played week buckets by its share of the best week, and an unplayed week is distinct', () => {
  mockStandings({
    standings: [
      baseRow({
        teamId: 1,
        // Best week is week 4 at 100 pts. Weeks 1-3 land one on each other
        // bucket boundary; week 5 is never picked at all.
        weekly: { 1: 25, 2: 50, 3: 75, 4: 100 },
      }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const cells = screen.getAllByTestId('pickem-standings-heat-cell');
  const byWeek = (week) => cells.find((cell) => cell.getAttribute('data-week') === String(week));

  expect(byWeek(1)).toHaveAttribute('data-bucket', 'h1');
  expect(byWeek(2)).toHaveAttribute('data-bucket', 'h2');
  expect(byWeek(3)).toHaveAttribute('data-bucket', 'h3');
  expect(byWeek(4)).toHaveAttribute('data-bucket', 'h4');
  expect(byWeek(4)).toHaveAttribute('data-best', 'true');
  // Week 5 was never picked: not-played, distinct from a bucketed zero week.
  expect(byWeek(5)).toHaveAttribute('data-bucket', 'not-played');
  expect(byWeek(5)).not.toHaveAttribute('data-best');
});

test('trend arrows: up, down, flat and null each render their own mark', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Up Team', rank: 1, previousRank: 3 }),
      baseRow({ teamId: 2, teamName: 'Down Team', rank: 2, previousRank: 1 }),
      baseRow({ teamId: 3, teamName: 'Flat Team', rank: 3, previousRank: 3 }),
      baseRow({ teamId: 4, teamName: 'New Team', rank: 4, previousRank: null }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const marks = screen.getAllByTestId('pickem-standings-trend');
  expect(marks.map((el) => el.getAttribute('data-trend'))).toEqual(['up', 'down', 'flat', null]);
});

test('season switch calls the entity with the season: the entity hook receives the newly picked season', async () => {
  const user = userEvent.setup();
  mockStandings({ standings: [baseRow()], viewerTeamId: 1 });
  render(<StandingsTable leagueId={7} seasons={[2026, 2025]} />);

  // Default season is the first option.
  expect(usePickemStandings).toHaveBeenLastCalledWith(7, 2026);

  await user.click(screen.getByRole('radio', { name: '2025' }));
  expect(usePickemStandings).toHaveBeenLastCalledWith(7, 2025);
});

test('no season switch renders when fewer than two seasons are offered', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} seasons={[2026]} />);
  expect(screen.queryByTestId('pickem-standings-season-switch')).not.toBeInTheDocument();
});

test('the table scrolls horizontally inside its own card rather than the page', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings-scroll')).toHaveStyle({ overflowX: 'auto' });
});

test('a failed read shows a compact error and no table', () => {
  mockStandings({ standings: [], error: new Error('boom') });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings-error')).toBeInTheDocument();
  expect(screen.queryByTestId('pickem-standings-scroll')).not.toBeInTheDocument();
});

test('a loading read shows skeleton rows, not the you-row or an error', () => {
  mockStandings({ standings: [], loading: true });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getAllByTestId('pickem-standings-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('pickem-standings-error')).not.toBeInTheDocument();
});

test('house style: no em-dash anywhere in the rendered card', () => {
  mockStandings({
    standings: [baseRow({ teamId: 1 }), baseRow({ teamId: 2, rank: 2 })],
    viewerTeamId: 1,
  });
  const { container } = render(<StandingsTable leagueId={7} />);
  expect(container.textContent).not.toContain('—');
});
