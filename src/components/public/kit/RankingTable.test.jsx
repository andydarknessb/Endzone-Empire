import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RankingTable from './RankingTable';

const ROWS = [
  { rank: 1, playerId: 9, name: 'Star Back', position: 'RB', nflTeam: 'KC', photoUrl: null, projectedPoints: 22.4, lastWeekPoints: 18, seasonPoints: 120, trend: 'up', injuryStatus: null },
  { rank: 2, playerId: 12, name: 'Big Wideout', position: 'WR', nflTeam: 'BUF', photoUrl: null, projectedPoints: 19.1, lastWeekPoints: 9, seasonPoints: 95, trend: 'down', injuryStatus: 'Q' },
];

const MIXED_ROWS = [
  { rank: 1, playerId: 'qb-1', name: 'QB One', position: 'QB', nflTeam: 'BUF', projectedPoints: 30, seasonPoints: 70, trend: 'up' },
  { rank: 2, playerId: 'wr-1', name: 'WR One', position: 'WR', nflTeam: 'MIN', projectedPoints: 24.6, seasonPoints: 60, trend: 'up' },
  { rank: 3, playerId: 'rb-1', name: 'RB One', position: 'RB', nflTeam: 'ATL', projectedPoints: 23.8, seasonPoints: 58, trend: 'flat' },
  { rank: 4, playerId: 'wr-2', name: 'WR Two', position: 'WR', nflTeam: 'TB', projectedPoints: 21.6, seasonPoints: 51, trend: 'down' },
  { rank: 5, playerId: 'qb-2', name: 'QB Two', position: 'QB', nflTeam: 'KC', projectedPoints: 20.5, seasonPoints: 65, trend: 'down' },
  { rank: 6, playerId: 'wr-3', name: 'WR Three', position: 'WR', nflTeam: 'NYJ', projectedPoints: 18.1, seasonPoints: 45, trend: 'flat' },
  { rank: 7, playerId: 'rb-2', name: 'RB Two', position: 'RB', nflTeam: 'SF', projectedPoints: 17.4, seasonPoints: 49, trend: 'up' },
  { rank: 8, playerId: 'wr-4', name: 'WR Four', position: 'WR', nflTeam: 'LAR', projectedPoints: 15, seasonPoints: 42, trend: 'down' },
];

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
});

const renderTable = (props) =>
  render(
    <MemoryRouter>
      <RankingTable {...props} />
    </MemoryRouter>
  );

describe('RankingTable states', () => {
  it('renders a loading skeleton', () => {
    renderTable({ rows: [], loading: true });
    expect(screen.getByTestId('loading-rows')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an empty state when there are no rows', () => {
    renderTable({ rows: [], loading: false });
    expect(screen.getByText(/rankings aren't available yet/i)).toBeInTheDocument();
  });

  it('renders an error state with a working retry button', () => {
    const onRetry = jest.fn();
    renderTable({ rows: [], loading: false, error: true, onRetry });
    expect(screen.getByText(/couldn't load the rankings/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders data rows with player profile links', () => {
    renderTable({ rows: ROWS, loading: false });
    expect(screen.getByRole('table')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Star Back' });
    expect(link).toHaveAttribute('href', '/players/9');
    expect(screen.getByText('Big Wideout')).toBeInTheDocument();
    expect(screen.getAllByText(/Tier 1/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Proj: Projected fantasy points:/)).toBeInTheDocument();
  });

  it('hides Last Wk until at least one row contains last-week data', () => {
    renderTable({ rows: ROWS.map((row) => ({ ...row, lastWeekPoints: null })), loading: false });
    expect(screen.queryByText('Last Wk')).not.toBeInTheDocument();
  });

  it('sorts Season and Trend from their column headers', () => {
    renderTable({ rows: ROWS, loading: false });
    fireEvent.click(screen.getByRole('button', { name: /Season/i }));
    let links = screen.getAllByRole('link').filter((link) => ['Star Back', 'Big Wideout'].includes(link.textContent));
    expect(links.map((link) => link.textContent)).toEqual(['Star Back', 'Big Wideout']);

    fireEvent.click(screen.getByRole('button', { name: /^Trend$/i }));
    links = screen.getAllByRole('link').filter((link) => ['Star Back', 'Big Wideout'].includes(link.textContent));
    expect(links.map((link) => link.textContent)).toEqual(['Star Back', 'Big Wideout']);
    fireEvent.click(screen.getByRole('button', { name: /^Trend$/i }));
    links = screen.getAllByRole('link').filter((link) => ['Star Back', 'Big Wideout'].includes(link.textContent));
    expect(links.map((link) => link.textContent)).toEqual(['Big Wideout', 'Star Back']);
  });

  it('renders mixed overall rankings as contiguous position tiers without repeated labels', () => {
    renderTable({ rows: MIXED_ROWS, loading: false });
    const players = screen.getAllByRole('link').map((link) => link.textContent);
    expect(players).toEqual([
      'QB One', 'QB Two',
      'RB One', 'RB Two',
      'WR One', 'WR Two', 'WR Three', 'WR Four',
    ]);

    const tierLabels = screen.getAllByText(/^(QB|RB|WR).*Tier \d+$/).map((node) => node.textContent);
    expect(tierLabels).toEqual([...new Set(tierLabels)]);
    expect(tierLabels.filter((label) => label.startsWith('WR')).length).toBeGreaterThan(1);
  });

  it('hides tier bands during a custom metric sort', () => {
    renderTable({ rows: MIXED_ROWS, loading: false });
    fireEvent.click(screen.getByRole('button', { name: /Season/i }));
    expect(screen.queryByText(/^(QB|RB|WR).*Tier \d+$/)).not.toBeInTheDocument();
  });

  it('uses stacked ranking cards instead of a table below md', () => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }));
    renderTable({ rows: ROWS, loading: false });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'NFL player rankings' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText('Projected')).toHaveLength(2);
    expect(screen.getAllByLabelText(/Projected: Projected fantasy points:/)).toHaveLength(2);
  });
});
