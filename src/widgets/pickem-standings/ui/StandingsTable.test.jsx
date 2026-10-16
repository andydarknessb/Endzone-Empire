/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
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

function mockStandings({
  standings, viewerTeamId = null, loading = false, error = null, mode = 'straight',
}) {
  usePickemStandings.mockReturnValue({
    data: loading ? null : { season: 2026, mode, standings, viewerTeamId },
    loading,
    error,
  });
}

// jsdom's getComputedStyle resolves neither which rule wins nor a `var()` value, so a value set
// through `sx` as `var(--ps-*)` is read from the emotion-inserted stylesheet directly.
const allRules = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  const visit = (rules) => {
    Array.from(rules || []).forEach((rule) => {
      if (rule.cssRules) {
        visit(rule.cssRules);
        return;
      }
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      text += `${rule.style.cssText};`;
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => visit(sheet.cssRules));
  return text;
};

afterEach(() => {
  usePickemStandings.mockReset();
});

const heatOf = (rowId) => within(screen.getByTestId(rowId)).getByTestId('pickem-standings-heat');
const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

test('renders from the standings entity only: calls usePickemStandings with the leagueId and no fetch client', () => {
  mockStandings({ standings: [baseRow()], viewerTeamId: 1 });
  render(<StandingsTable leagueId={7} />);
  expect(usePickemStandings).toHaveBeenCalledWith(7, undefined);
});

test('viewer row: Play blue with a pixel arrow and the You tag, one row only, not a cursor', () => {
  mockStandings({
    standings: [baseRow({ teamId: 1, teamName: 'Gridiron Gamblers' }), baseRow({ teamId: 2, teamName: 'Blitz Brothers', rank: 2 })],
    viewerTeamId: 2,
  });
  const { container } = render(<StandingsTable leagueId={7} />);

  const youRow = screen.getByTestId('pickem-standings-you-row');
  expect(within(youRow).getByText('Blitz Brothers')).toBeInTheDocument();
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  expect(within(youRow).getByRole('rowheader')).toContainElement(within(youRow).getByText('Blitz Brothers'));
  expect(youRow.querySelector('svg path[d^="M3 1h2"]')).not.toBeNull();
  expect(screen.getAllByTestId('pickem-standings-you-row')).toHaveLength(1);
  expect(within(youRow).queryByText('Gridiron Gamblers')).not.toBeInTheDocument();
  expect(container.querySelector('.cursor')).toBeNull();
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

test('straight up drops the Correct column and the accuracy bars; the percent stays', () => {
  mockStandings({ standings: [baseRow({ correct: 5, incorrect: 5 })], mode: 'straight' });
  render(<StandingsTable leagueId={7} />);
  expect(headers()).not.toContain('Correct');
  expect(headers()).toEqual(expect.arrayContaining(['Rank', 'Team', 'Points', 'Missed', 'Pending', 'Accuracy']));
  expect(screen.queryByTestId('pickem-standings-accuracy-bar')).not.toBeInTheDocument();
  expect(screen.getByTestId('pickem-standings-accuracy')).toHaveTextContent('50%');
  // Every body row has one cell per header.
  const row = screen.getByTestId('pickem-standings-row-1');
  expect(row.children).toHaveLength(headers().length);
});

test('confidence keeps the Correct column and the accuracy bars', () => {
  mockStandings({ standings: [baseRow({ correct: 5, incorrect: 5 })], mode: 'confidence' });
  render(<StandingsTable leagueId={7} />);
  expect(headers()).toContain('Correct');
  expect(screen.getByTestId('pickem-standings-accuracy-bar')).toBeInTheDocument();
  expect(screen.getByTestId('pickem-standings-row-1').children).toHaveLength(headers().length);
});

test('the heat strip is ONE labelled image per row; its eighteen cells are hidden from the tree', () => {
  mockStandings({
    standings: [baseRow({ teamId: 1, weekly: { 1: 9, 2: 10, 3: 7, 4: 10, 5: 7, 6: 8, 7: 1 } })],
  });
  render(<StandingsTable leagueId={7} />);
  const heat = heatOf('pickem-standings-row-1');
  expect(heat).toHaveAttribute('role', 'img');
  expect(heat).toHaveAccessibleName('Weekly points, weeks 1 to 7: 9, 10, 7, 10, 7, 8, 1; best weeks 2 and 4');
  const cells = within(heat).getAllByTestId('pickem-standings-heat-cell');
  expect(cells).toHaveLength(18);
  cells.forEach((cell) => expect(cell).toHaveAttribute('aria-hidden', 'true'));
  // A tied best week is named and every tied week is ringed.
  expect(cells.filter((cell) => cell.hasAttribute('data-best')).map((cell) => cell.getAttribute('data-week'))).toEqual(['2', '4']);
});

test('a single best week reads "best week N", and a skipped week reads none in the sentence', () => {
  mockStandings({ standings: [baseRow({ teamId: 1, weekly: { 1: 10, 3: 20 } })] });
  render(<StandingsTable leagueId={7} />);
  expect(heatOf('pickem-standings-row-1')).toHaveAccessibleName('Weekly points, weeks 1 to 3: 10, none, 20; best week 3');
});

test('heat cell shading buckets: a played week buckets by its share of the best week, and an unplayed week is distinct', () => {
  mockStandings({ standings: [baseRow({ teamId: 1, weekly: { 1: 25, 2: 50, 3: 75, 4: 100 } })] });
  render(<StandingsTable leagueId={7} />);

  const cells = screen.getAllByTestId('pickem-standings-heat-cell');
  const byWeek = (week) => cells.find((cell) => cell.getAttribute('data-week') === String(week));
  const fillOf = (cell) => within(cell).queryByTestId('pickem-standings-heat-cell-fill');

  expect(['1', '2', '3', '4'].map((week) => byWeek(week).getAttribute('data-bucket'))).toEqual(['h1', 'h2', 'h3', 'h4']);
  expect(byWeek(4)).toHaveAttribute('data-best', 'true');
  expect(byWeek(5)).toHaveAttribute('data-bucket', 'not-played');
  expect(byWeek(5)).not.toHaveAttribute('data-best');
  // Bucket reads by shape as well as tint: a distinct fill height each, none for an unplayed week.
  expect(fillOf(byWeek(1))).toHaveStyle({ height: '25%' });
  expect(fillOf(byWeek(2))).toHaveStyle({ height: '50%' });
  expect(fillOf(byWeek(3))).toHaveStyle({ height: '75%' });
  expect(fillOf(byWeek(4))).toHaveStyle({ height: '100%' });
  expect(fillOf(byWeek(5))).not.toBeInTheDocument();
});

test('a played-but-scored-0 week and a not-played week share one base track; only the fill differs', () => {
  mockStandings({ standings: [baseRow({ teamId: 1, weekly: { 1: 0, 2: 100 } })] });
  render(<StandingsTable leagueId={7} />);
  const cells = screen.getAllByTestId('pickem-standings-heat-cell');
  const byWeek = (week) => cells.find((cell) => cell.getAttribute('data-week') === String(week));
  const fillOf = (cell) => within(cell).queryByTestId('pickem-standings-heat-cell-fill');
  expect(allRules(byWeek(1))).toMatch(/background-color:\s*var\(--ps-field\)/);
  expect(allRules(byWeek(5))).toMatch(/background-color:\s*var\(--ps-field\)/);
  expect(fillOf(byWeek(1))).toBeInTheDocument();
  expect(fillOf(byWeek(5))).not.toBeInTheDocument();
});

test('a one-line legend says how the heat strip is drawn', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByText(/Fill height: that week against the team's own best week/)).toBeInTheDocument();
  expect(screen.getByText(/every tied best week is ringed/)).toBeInTheDocument();
});

test('trend arrows: up, down, flat and null each render their own mark, 16px, with a screen-reader word', () => {
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
  expect(marks.map((el) => el.textContent)).toEqual([
    'Trend: improved', 'Trend: declined', 'Trend: unchanged', 'Trend: not available',
  ]);
  expect(marks[0].querySelector('svg')).toHaveAttribute('width', '16');
  expect(marks[3].querySelector('svg')).toBeNull();
});

test('season switch calls the entity with the season: the entity hook receives the newly picked season', async () => {
  const user = userEvent.setup();
  mockStandings({ standings: [baseRow()], viewerTeamId: 1 });
  render(<StandingsTable leagueId={7} seasons={[2026, 2025]} />);

  expect(usePickemStandings).toHaveBeenLastCalledWith(7, 2026);
  await user.click(screen.getByRole('radio', { name: '2025' }));
  expect(usePickemStandings).toHaveBeenLastCalledWith(7, 2025);
});

test('no season switch renders when fewer than two seasons are offered', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} seasons={[2026]} />);
  expect(screen.queryByTestId('pickem-standings-season-switch')).not.toBeInTheDocument();
});

test('the table scrolls inside its own box with the first column sticky, rather than the page', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  const scroll = screen.getByTestId('pickem-standings-scroll');
  expect(allRules(scroll)).toMatch(/overflow-x:\s*auto/);
  expect(allRules(scroll)).toMatch(/position:\s*relative/);
  expect(allRules(screen.getByTestId('pickem-standings-rank').closest('td'))).toMatch(/position:\s*sticky/);
});

test('a failed read shows the error with a Retry and no table, and no team count', () => {
  mockStandings({ standings: [], error: new Error('boom') });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings-error')).toHaveTextContent('We could not load the standings right now.');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByTestId('pickem-standings-scroll')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pickem-standings-count')).not.toBeInTheDocument();
});

test('a loading read states no team count yet and shows skeleton rows', () => {
  mockStandings({ standings: [], loading: true });
  render(<StandingsTable leagueId={7} />);
  expect(screen.queryByTestId('pickem-standings-count')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('pickem-standings-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('pickem-standings-error')).not.toBeInTheDocument();
  expect(screen.getByTestId('pickem-standings')).toHaveAttribute('aria-busy', 'true');
});

test('a ready read states the team count and clears aria-busy', () => {
  mockStandings({ standings: [baseRow(), baseRow({ teamId: 2, teamName: 'Blitz Brothers', rank: 2 })] });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings-count')).toHaveTextContent('2 teams');
  expect(screen.getByTestId('pickem-standings')).toHaveAttribute('aria-busy', 'false');
});

test('the frame heading is Standings by default and the title prop renames it', () => {
  mockStandings({ standings: [baseRow()] });
  const { rerender } = render(<StandingsTable leagueId={7} />);
  expect(screen.getByRole('heading', { level: 2, name: 'Standings' })).toBeInTheDocument();

  rerender(<StandingsTable leagueId={7} title="Pick'em Standings" />);
  expect(screen.getByRole('heading', { name: "Pick'em Standings" })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Standings' })).not.toBeInTheDocument();
});

test('the scroll container is a keyboard-reachable, labelled scrollport', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  const scroller = screen.getByTestId('pickem-standings-scroll');
  expect(scroller).toHaveAttribute('tabindex', '0');
  expect(scroller).toHaveAccessibleName('Standings table, scrollable');
});

test('the viewer strip names rank, gap to the leader, accuracy and best weeks', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Leader', rank: 1, points: 58, weekly: { 1: 5 } }),
      baseRow({ teamId: 2, teamName: 'Me', rank: 2, points: 52, correct: 5, incorrect: 5, weekly: { 1: 9, 2: 10, 3: 10 } }),
    ],
    viewerTeamId: 2,
  });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings-behind-leader')).toHaveTextContent('6 pts');
  expect(screen.getByTestId('pickem-standings-your-accuracy')).toHaveTextContent('50%');
  expect(screen.getByTestId('pickem-standings-best-week')).toHaveTextContent('Best weeksWk 2 and 3');
});

test('house style: no em-dash anywhere in the rendered frame', () => {
  mockStandings({ standings: [baseRow({ teamId: 1 }), baseRow({ teamId: 2, rank: 2 })], viewerTeamId: 1 });
  const { container } = render(<StandingsTable leagueId={7} />);
  expect(container).not.toHaveTextContent('\u2014');
});

test('paints no dash token and uses no opacity', () => {
  mockStandings({ standings: [baseRow({ teamId: 1 })], viewerTeamId: 1 });
  const { container } = render(<StandingsTable leagueId={7} />);
  const html = container.innerHTML;
  expect(html).not.toMatch(/dash-/);
  expect(html).not.toMatch(/opacity/);
});
