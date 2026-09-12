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

// jsdom's getComputedStyle resolves neither which rule wins nor a `var()`
// value (widgets/standings-table/ui/StandingsTable.test.jsx's own
// `rulesUnder`, the same pattern here), so a colour set through `sx` as
// `var(--dash-*)` is read from the emotion-inserted stylesheet directly
// rather than through computed style.
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

test('heat cell bucket is also visible without colour (#1298, WCAG 1.4.1): each bucket fills a distinct height, and the border/outline are never faded', () => {
  mockStandings({
    standings: [
      baseRow({
        teamId: 1,
        // Same shape as the bucket-boundary test above, so week 4 is both
        // h4 and the best week.
        weekly: { 1: 25, 2: 50, 3: 75, 4: 100 },
      }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const cells = screen.getAllByTestId('pickem-standings-heat-cell');
  const byWeek = (week) => cells.find((cell) => cell.getAttribute('data-week') === String(week));

  const fillOf = (cell) => within(cell).queryByTestId('pickem-standings-heat-cell-fill');

  expect(fillOf(byWeek(1))).toHaveStyle({ height: '25%' });
  expect(fillOf(byWeek(2))).toHaveStyle({ height: '50%' });
  expect(fillOf(byWeek(3))).toHaveStyle({ height: '75%' });
  expect(fillOf(byWeek(4))).toHaveStyle({ height: '100%' });
  // Week 5 is not-played: no inner fill at all, not a fill at some height.
  expect(fillOf(byWeek(5))).not.toBeInTheDocument();

  // The best-week outline and every cell's hairline border used to sit
  // under the same sub-1 opacity as the bucket tint; that opacity now lives
  // only on the inner fill, so the cell itself is never faded.
  expect(byWeek(1)).toHaveStyle({ opacity: '1' });
  expect(byWeek(4)).toHaveStyle({ opacity: '1' });
  expect(fillOf(byWeek(1))).toHaveStyle({ opacity: '0.75' });
});

test('heat cell track: a played-but-scored-0 week (h1) and a not-played week share the same base track, distinguished by the presence of a fill (#1298 risk review)', () => {
  mockStandings({
    standings: [
      // Best week is week 2 at 100 pts, so week 1's 0 points buckets h1
      // (heatBuckets.js) rather than landing outside the strip entirely.
      baseRow({ teamId: 1, weekly: { 1: 0, 2: 100 } }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const cells = screen.getAllByTestId('pickem-standings-heat-cell');
  const byWeek = (week) => cells.find((cell) => cell.getAttribute('data-week') === String(week));
  const fillOf = (cell) => within(cell).queryByTestId('pickem-standings-heat-cell-fill');

  const scoredZero = byWeek(1);
  const notPlayed = byWeek(5);
  expect(scoredZero).toHaveAttribute('data-bucket', 'h1');
  expect(notPlayed).toHaveAttribute('data-bucket', 'not-played');

  // Same neutral track on both, so the ONLY visible difference is the fill.
  // The cell's background comes from `sx` (an emotion class), not an inline
  // style, and jsdom's getComputedStyle resolves neither the winning rule
  // nor a `var()` value, so `toHaveStyle`/`.style` reads empty on both and a
  // comparison between them would pass no matter what the two cells actually
  // render (risk review: caught exactly that on this line). Reading the
  // emotion-inserted rule directly, and pinning it to the real expected
  // token rather than to each other, is what actually catches a regression
  // back to a transparent bucketed cell.
  expect(allRules(scoredZero)).toMatch(/background-color:\s*var\(--dash-surface3\)/);
  expect(allRules(notPlayed)).toMatch(/background-color:\s*var\(--dash-surface3\)/);
  expect(fillOf(scoredZero)).toBeInTheDocument();
  expect(fillOf(notPlayed)).not.toBeInTheDocument();
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

test('a loading read shows skeleton rows, not the you-row or an error, and reports aria-busy on the owning card', () => {
  mockStandings({ standings: [], loading: true });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getAllByTestId('pickem-standings-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('pickem-standings-error')).not.toBeInTheDocument();
  expect(screen.getByTestId('pickem-standings')).toHaveAttribute('aria-busy', 'true');
});

test('a ready read clears aria-busy on the owning card', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  expect(screen.getByTestId('pickem-standings')).toHaveAttribute('aria-busy', 'false');
});

test('the scroll container is a keyboard-reachable, labelled scrollport (risk review: no cell content is itself focusable)', () => {
  mockStandings({ standings: [baseRow()] });
  render(<StandingsTable leagueId={7} />);
  const scroller = screen.getByTestId('pickem-standings-scroll');
  expect(scroller).toHaveAttribute('tabindex', '0');
  expect(scroller).toHaveAccessibleName('Standings table, scrollable');
});

test('heat strip labels: a week at or before the current week with no points is "no picks made"; a week after it is "not played yet" (risk review)', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Skips Weeks', weekly: { 1: 10, 3: 20 } }),
      baseRow({ teamId: 2, teamName: 'Every Week', rank: 2, weekly: { 1: 5, 2: 8, 3: 12 } }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  // currentWeek is 3 (the highest week any row carries).
  const skipsRow = screen.getByTestId('pickem-standings-row-1');
  const cellsInRow = within(skipsRow).getAllByTestId('pickem-standings-heat-cell');
  const week2 = cellsInRow.find((cell) => cell.getAttribute('data-week') === '2');
  const week5 = cellsInRow.find((cell) => cell.getAttribute('data-week') === '5');
  expect(week2).toHaveAttribute('aria-label', 'Week 2: no picks made');
  expect(week5).toHaveAttribute('aria-label', 'Week 5: not played yet');
});

test('trend: a flat mark shows a visible glyph, but "no previous rank" renders nothing visible (risk review: the two must not look identical)', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Flat Team', rank: 1, previousRank: 1 }),
      baseRow({ teamId: 2, teamName: 'New Team', rank: 2, previousRank: null }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const marks = screen.getAllByTestId('pickem-standings-trend');
  const [flatMark, nullMark] = marks;
  // The visible flat glyph is the en dash character; the null case renders
  // no visible mark at all (its hidden "not available" text carries none).
  expect(flatMark).toHaveTextContent('–');
  expect(nullMark).not.toHaveTextContent('–');
});

test('accuracy bar: a decided team hides the redundant bar label (the visible percent text already carries it); an undecided team labels the bar itself', () => {
  mockStandings({
    standings: [
      baseRow({ teamId: 1, teamName: 'Decided', correct: 5, incorrect: 0 }),
      baseRow({ teamId: 2, teamName: 'Undecided', rank: 2, correct: 0, incorrect: 0 }),
    ],
  });
  render(<StandingsTable leagueId={7} />);

  const bars = screen.getAllByTestId('pickem-standings-accuracy-bar');
  expect(bars[0]).toHaveAttribute('aria-hidden', 'true');
  expect(bars[0]).not.toHaveAttribute('role');
  expect(bars[1]).toHaveAttribute('role', 'img');
  expect(bars[1]).toHaveAccessibleName('No decided picks yet');
});

test('house style: no em-dash anywhere in the rendered card', () => {
  mockStandings({
    standings: [baseRow({ teamId: 1 }), baseRow({ teamId: 2, rank: 2 })],
    viewerTeamId: 1,
  });
  const { container } = render(<StandingsTable leagueId={7} />);
  // U+2014 as an escape, so this file never carries the character itself.
  expect(container).not.toHaveTextContent('\u2014');
});
