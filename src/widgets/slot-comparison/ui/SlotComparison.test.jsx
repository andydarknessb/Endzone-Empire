/* eslint-disable testing-library/no-node-access -- reads emotion rules, the position tag and the checked segment glyph, none of which has a role or a name */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlotComparison } from '..';

// A Matchup detail starter row as the Matchup page model pairs it (the wire
// shape of GET /api/league/:id/matchups/:matchupId, #892 fields included).
const starter = (over = {}) => ({
  id: 1,
  name: 'J. Goff',
  position: 'QB',
  nfl_team: 'DET',
  opponent: 'CHI',
  injury_status: null,
  points: 18.6,
  projected: 19.2,
  availability: { available: true, reason: null },
  game_state: 'final',
  game_clock: null,
  photo_url: null,
  stats: { passingYards: 289, passingTDs: 2, interceptions: 1 },
  ...over,
});

// Four paired rows in the league's order: a final QB pair, a live RB pair, a
// WR pair with a scheduled starter against one on IR who still carries a stale
// projection, and a TE with an empty away side.
const rows = [
  {
    slot: 'QB',
    first: starter(),
    second: starter({
      id: 2, name: 'J. Allen', nfl_team: 'BUF', opponent: 'MIA', points: 24.1, projected: 22.5,
    }),
  },
  {
    slot: 'RB',
    first: starter({
      id: 3, name: 'A. Jones', position: 'RB', nfl_team: 'GB', opponent: 'TB', points: 14.3, projected: 13.8, game_state: 'in_progress', game_clock: 'Q3 6:42', stats: { rushingYards: 71, rushingTDs: 1, receptions: 3, receivingYards: 22 },
    }),
    second: starter({
      id: 4, name: 'S. Barkley', position: 'RB', nfl_team: 'PHI', opponent: 'NO', points: 4.8, projected: 16.4, game_state: 'in_progress', game_clock: 'Q3 11:20', injury_status: 'Q',
    }),
  },
  {
    slot: 'WR',
    first: starter({
      id: 5, name: 'D. Adams', position: 'WR', nfl_team: 'NYJ', opponent: 'CIN', points: 0, projected: 14.2, game_state: 'scheduled', stats: null,
    }),
    second: starter({
      id: 6, name: 'N. Collins', position: 'WR', nfl_team: 'HOU', opponent: 'LAR', points: 0, projected: 13.1, availability: { available: false, reason: 'ir' }, game_state: 'scheduled', stats: null,
    }),
  },
  {
    slot: 'TE',
    first: starter({
      id: 7, name: 'T. Kelce', position: 'TE', nfl_team: 'KC', opponent: 'LAC', points: 9.7, projected: 11.0, game_state: 'in_progress', game_clock: 'Q2 1:05',
    }),
    second: null,
  },
];

// The page hands the board's sides and the rows in the viewer-first order: first is the left column.
const homeSide = (isViewer) => ({ name: 'Duluth Dockworkers', origin: 'home', isViewer });
const awaySide = (isViewer) => ({ name: 'Fargo Frostbite', origin: 'away', isViewer });

const baseProps = {
  rows,
  first: homeSide(false),
  second: awaySide(false),
  expectedFinal: { first: 110.5, second: 123.9 },
  scoreLabels: { first: '99.9', second: '88.8' },
  status: 'live',
  onOpenPlayer: jest.fn(),
  expandedId: null,
  onToggle: jest.fn(),
};

// The away Team is the viewer: the board puts it first, so the rows, figures and sides arrive swapped.
const awayViewerProps = {
  ...baseProps,
  rows: rows.map((r) => ({ slot: r.slot, first: r.second, second: r.first })),
  first: awaySide(true),
  second: homeSide(false),
  expectedFinal: { first: 123.9, second: 110.5 },
  scoreLabels: { first: '88.8', second: '99.9' },
};

const rowAt = (i) => screen.getAllByTestId('slot-row')[i];
const cell = (i, side) => within(rowAt(i)).getByTestId(`slot-cell-${side}`);

// The widget reads the theme's `md` breakpoint (a max-width) through useMediaQuery: `phone` answers it.
// Set fresh every test because the jest preset runs with `resetMocks: true`.
let phone;

beforeEach(() => {
  baseProps.onOpenPlayer.mockClear();
  baseProps.onToggle.mockClear();
  phone = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query) ? phone : false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

test('is the Starters frame: an h2 that labels it, the slot count, both Team names, the Pts / proj label and the legend words', () => {
  render(<SlotComparison {...baseProps} />);

  expect(screen.getByRole('region', { name: 'Starters' })).toBe(screen.getByTestId('slot-comparison'));
  expect(screen.getByRole('heading', { level: 2, name: 'Starters' })).toBeInTheDocument();
  expect(screen.getByText('4 slots')).toBeInTheDocument();
  expect(screen.getByText('Duluth Dockworkers')).toBeInTheDocument();
  expect(screen.getByText('Fargo Frostbite')).toBeInTheDocument();
  expect(screen.getAllByText('Pts / proj')).toHaveLength(2);
  expect(within(screen.getByTestId('slot-legend')).getByText('In progress')).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-legend')).getByText('Final')).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-legend')).getByText('Yet to play')).toBeInTheDocument();
  // The rows render as given, never re-sorted.
  expect(screen.getAllByTestId('slot-row').map((row) => row.querySelector('[data-position]').textContent)).toEqual(['QB', 'RB', 'WR', 'TE']);
});

test('the viewer side wears the You tag', () => {
  const { rerender } = render(<SlotComparison {...awayViewerProps} />);
  expect(screen.getAllByText('You')).toHaveLength(1);
  // The tag sits under the name, in the same column box, so it never takes name width (#2363).
  const name = screen.getByText('Fargo Frostbite');
  expect(name.nextElementSibling).toHaveTextContent('You');
  expect(name.parentElement).toHaveTextContent('You');
  rerender(<SlotComparison {...baseProps} />);
  expect(screen.queryByText('You')).not.toBeInTheDocument();
});

test('each header name keeps its full text and carries it as a title', () => {
  render(<SlotComparison {...baseProps} />);
  const names = screen.getAllByTestId('slot-team-name');
  expect(names.map((n) => n.getAttribute('title'))).toEqual(['Duluth Dockworkers', 'Fargo Frostbite']);
  expect(names.map((n) => n.textContent)).toEqual(['Duluth Dockworkers', 'Fargo Frostbite']);
});

test.each([
  [0, 'home', 'final', 'Final'],
  [1, 'home', 'live', 'In progress'],
  [2, 'home', 'scheduled', 'Yet to play'],
])('row %s %s: the state is a shape with its words, never colour alone (%s)', (i, side, kind, words) => {
  render(<SlotComparison {...baseProps} />);
  const c = cell(i, side);

  expect(within(c).getByTestId(`state-${kind}`)).toHaveAttribute('aria-hidden', 'true');
  expect(within(c).getByText(words)).toBeInTheDocument();
  expect(within(c).getAllByTestId(/^state-/)).toHaveLength(1);
});

test('the three marks differ in shape and colour: a blinking red square, a checker in ink, an empty dim outline', () => {
  render(<SlotComparison {...baseProps} />);
  const live = within(cell(1, 'home')).getByTestId('state-live');
  const final = within(cell(0, 'home')).getByTestId('state-final');
  const sched = within(cell(2, 'home')).getByTestId('state-scheduled');

  expect(live).toHaveClass('live-light');
  expect(final.tagName.toLowerCase()).toBe('svg');
  expect(final.querySelectorAll('rect')).toHaveLength(5);
  expect(final).toHaveAttribute('shape-rendering', 'crispEdges');
  expect(sched.querySelector('*')).toBeNull();
  // The legend's red sample holds still.
  expect(within(screen.getByTestId('slot-legend')).getByTestId('state-live')).not.toHaveClass('live-light');
});

test('a starter with a team and no opponent on bye reads "Bye" on the game line from the server verdict, once', () => {
  const byeRows = [{
    slot: 'K',
    first: starter({ id: 8, nfl_team: 'DET', opponent: null, game_state: 'final', points: 0, stats: null, availability: { available: false, reason: 'bye' } }),
    second: starter({ id: 9, nfl_team: 'BUF', opponent: null, game_state: 'scheduled', points: 0, stats: null, availability: { available: false, reason: 'bye' } }),
  }];
  render(<SlotComparison {...baseProps} rows={byeRows} />);
  expect(within(cell(0, 'home')).getByTestId('slot-line2')).toHaveTextContent('DET · Bye');
  expect(within(cell(0, 'away')).getByTestId('slot-line2')).toHaveTextContent('BUF');
  expect(within(cell(0, 'away')).getByTestId('slot-points')).toHaveTextContent('on bye');
  expect(within(cell(0, 'away')).getByTestId('slot-line2')).not.toHaveTextContent('Bye');
});

test('line two is the product text: "NFL vs OPP", with the live clock on an in-progress game only', () => {
  render(<SlotComparison {...baseProps} />);

  expect(within(cell(0, 'home')).getByTestId('slot-line2')).toHaveTextContent('DET vs CHI');
  expect(within(cell(0, 'home')).getByTestId('slot-line2')).not.toHaveTextContent(/Q\d/);
  expect(within(cell(1, 'home')).getByTestId('slot-line2')).toHaveTextContent('GB vs TB · Q3 6:42');
  expect(within(cell(2, 'home')).getByTestId('slot-line2')).toHaveTextContent('NYJ vs CIN');
});

test('the figure is points once started and "proj x" while the game has not; an Unavailable starter shows his reason in place of the projection', () => {
  render(<SlotComparison {...baseProps} />);

  expect(within(cell(0, 'home')).getByTestId('slot-points')).toHaveTextContent('18.6 pts');
  expect(within(cell(1, 'home')).getByTestId('slot-points')).toHaveTextContent('14.3 pts');
  expect(within(cell(2, 'home')).getByTestId('slot-points')).toHaveTextContent('proj 14.2');
  expect(within(cell(2, 'away')).getByTestId('unavailable-reason')).toHaveTextContent('on IR');
  expect(within(cell(2, 'away')).getByTestId('slot-points')).not.toHaveTextContent('13.1');
});

test('an Unavailable starter with no reason reads the one fallback word, "unavailable"', () => {
  const odd = [{ slot: 'QB', first: starter({ game_state: 'scheduled', availability: { available: false, reason: null } }), second: null }];
  render(<SlotComparison {...baseProps} rows={odd} />);
  expect(within(cell(0, 'home')).getByTestId('unavailable-reason')).toHaveTextContent('unavailable');
});

test('a flagged starter carries his injury designation; a healthy one carries none', () => {
  render(<SlotComparison {...baseProps} />);
  const tag = within(cell(1, 'away')).getByTestId('injury-tag');

  expect(tag).toHaveAttribute('data-status', 'Q');
  expect(within(cell(1, 'away')).getByText('Q')).toBeInTheDocument();
  expect(within(cell(1, 'away')).getByText('Injury status: Questionable')).toBeInTheDocument();
  expect(within(cell(1, 'home')).queryByTestId('injury-tag')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('injury-tag')).toHaveLength(1);
});

test('a starter with an unknown game state shows no state marker', () => {
  const unknown = [{ slot: 'QB', first: starter({ game_state: null }), second: null }];
  render(<SlotComparison {...baseProps} rows={unknown} />);
  expect(within(cell(0, 'home')).queryByTestId(/^state-/)).not.toBeInTheDocument();
});

describe('an empty slot', () => {
  test('reads "No starter" once started; on the viewer\'s side with a lock the second line is "Empty · next kickoff {lock}", and it offers no link of its own', () => {
    render(<SlotComparison {...awayViewerProps} fillBy="Sun 3:25 PM" />);
    const empty = cell(3, 'away');

    expect(empty).toHaveTextContent('No starter');
    expect(empty).toHaveTextContent('Empty · next kickoff Sun 3:25 PM');
    expect(within(empty).queryByRole('link')).not.toBeInTheDocument();
    expect(within(empty).queryByRole('button')).not.toBeInTheDocument();
  });

  test('names a lock on the viewer\'s side only: the opponent\'s empty slot, and a viewer with none, say nothing', () => {
    const { rerender } = render(<SlotComparison {...baseProps} first={homeSide(true)} fillBy="Sun 3:25 PM" />);
    expect(cell(3, 'away')).not.toHaveTextContent(/Fill by|next kickoff/);
    rerender(<SlotComparison {...baseProps} fillBy="Sun 3:25 PM" />);
    expect(cell(3, 'away')).not.toHaveTextContent(/Fill by|next kickoff/);
    rerender(<SlotComparison {...awayViewerProps} />);
    expect(cell(3, 'away')).not.toHaveTextContent(/Fill by|next kickoff/);
  });

  test('reads "Empty" over "Fill by {lock}" before kickoff', () => {
    render(<SlotComparison {...awayViewerProps} status="scheduled" fillBy="Sun 12:00 PM" />);
    expect(cell(3, 'away')).toHaveTextContent('Empty');
    expect(cell(3, 'away')).toHaveTextContent('Fill by Sun 12:00 PM');
    expect(cell(3, 'away')).not.toHaveTextContent('next kickoff');
  });

  test('a wide started row prints the 0.0 an empty slot scores, and its Exp final', () => {
    render(<SlotComparison {...baseProps} />);
    expect(cell(3, 'away')).toHaveTextContent('0.0 pts');
    expect(within(cell(3, 'away')).getByText('0.0', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('the Totals row', () => {
  test('prints each Team\'s score from the board with its Exp final under it', () => {
    render(<SlotComparison {...baseProps} />);
    const totals = screen.getByTestId('slot-totals');

    expect(within(totals).getByText('Totals')).toBeInTheDocument();
    expect(screen.getByTestId('slot-total-home')).toHaveTextContent('99.9 pts');
    expect(screen.getByTestId('slot-total-away')).toHaveTextContent('88.8 pts');
    // The widget sums nothing: the figures are the handed-down labels.
    expect(screen.getAllByTestId('slot-exp-final').map((el) => el.textContent)).toEqual(['Exp final 110.5', 'Exp final 123.9']);
  });

  test.each(['played', 'final'])('a %s matchup shows no Exp final', (status) => {
    render(<SlotComparison {...baseProps} status={status} />);
    expect(screen.queryByTestId('slot-exp-final')).not.toBeInTheDocument();
  });

  test('a side with no Expected final prints none', () => {
    render(<SlotComparison {...baseProps} expectedFinal={{ first: 110.5, second: null }} />);
    expect(screen.getAllByTestId('slot-exp-final')).toHaveLength(1);
  });
});

describe('before kickoff', () => {
  const pre = () => render(<SlotComparison {...baseProps} status="scheduled" expectedFinal={{ first: 110.5, second: 123.9 }} />);

  test('the head says "Every starter yet to play" once, and no row repeats the state word or draws the legend', () => {
    pre();

    expect(screen.getByText('Every starter yet to play')).toBeInTheDocument();
    expect(screen.queryByText('Yet to play')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-legend')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^state-/)).not.toBeInTheDocument();
  });

  test('every figure is a Proj, and the Totals are the Proj totals', () => {
    pre();

    expect(within(cell(0, 'home')).getByTestId('slot-points')).toHaveTextContent('proj 19.2');
    expect(screen.getAllByText('Proj')).toHaveLength(2);
    expect(screen.getByTestId('slot-total-home')).toHaveTextContent('proj 110.5');
    expect(screen.getByTestId('slot-total-away')).toHaveTextContent('proj 123.9');
    expect(screen.queryByTestId('slot-exp-final')).not.toBeInTheDocument();
  });
});

describe('once settled', () => {
  const withState = (game_state) => rows.map((r) => ({
    ...r,
    first: r.first && { ...r.first, game_state },
    second: r.second && { ...r.second, game_state },
  }));
  const settled = (status, game_state) => render(<SlotComparison {...baseProps} status={status} rows={withState(game_state)} />);

  test('a final matchup (unpriced rows) says "Every starter final" once, with no legend and no mark', () => {
    settled('final', null);

    expect(screen.getByText('Every starter final')).toBeInTheDocument();
    expect(screen.queryByTestId('slot-legend')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^state-/)).not.toBeInTheDocument();
  });

  test('a played matchup (rows final) draws no mark and no "Final" word', () => {
    settled('played', 'final');

    expect(screen.getByText('Every starter final')).toBeInTheDocument();
    expect(screen.queryByTestId(/^state-/)).not.toBeInTheDocument();
    expect(screen.queryByText('Final')).not.toBeInTheDocument();
  });

  test('a played matchup draws no mark on a phone', () => {
    phone = true;
    settled('played', 'final');

    expect(screen.queryByTestId(/^state-/)).not.toBeInTheDocument();
  });
});

describe('the controls', () => {
  test('a name button opens the player, and the rest of the cell toggles the stat line', async () => {
    render(<SlotComparison {...baseProps} />);

    await userEvent.click(within(cell(0, 'home')).getByRole('button', { name: 'J. Goff' }));
    expect(baseProps.onOpenPlayer).toHaveBeenCalledWith(1);
    expect(baseProps.onToggle).not.toHaveBeenCalled();

    await userEvent.click(within(cell(0, 'home')).getByRole('button', { name: 'Stats for J. Goff' }));
    expect(baseProps.onToggle).toHaveBeenCalledWith(1);
  });

  test('an expanded row shows its stat line with middot separators and "points / proj"; an Unavailable one shows its reason alone', () => {
    const { rerender } = render(<SlotComparison {...baseProps} expandedId={1} />);
    const strip = screen.getByTestId('slot-expanded');

    expect(strip).toHaveTextContent('J. Goff');
    expect(strip).toHaveTextContent('289 pass yds · 2 pass TD · 1 INT');
    expect(strip).toHaveTextContent('18.6 / 19.2 proj');
    expect(within(cell(0, 'home')).getByRole('button', { name: 'Stats for J. Goff' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(cell(0, 'home')).getByRole('button', { name: 'Stats for J. Goff' })).toHaveAttribute('aria-controls', strip.id);

    rerender(<SlotComparison {...baseProps} expandedId={6} />);
    expect(screen.getByTestId('slot-expanded')).toHaveTextContent('on IR');
    expect(screen.getByTestId('slot-expanded')).toHaveTextContent('No stats recorded yet.');
    expect(screen.getByTestId('slot-expanded')).not.toHaveTextContent('proj');
    expect(within(cell(0, 'home')).getByRole('button', { name: 'Stats for J. Goff' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('no row is open by default', () => {
    render(<SlotComparison {...baseProps} />);
    expect(screen.queryByTestId('slot-expanded')).not.toBeInTheDocument();
  });
});

describe('on a phone', () => {
  beforeEach(() => { phone = true; });

  test('a cell is three lines: the name and injury tag, the shape and the figure, then the game on its own line', () => {
    render(<SlotComparison {...baseProps} />);
    const barkley = cell(1, 'away');
    const line2 = within(barkley).getByTestId('slot-line2');

    expect(within(barkley).getByRole('button', { name: 'S. Barkley' })).toBeInTheDocument();
    expect(within(barkley).getByTestId('injury-tag')).toBeInTheDocument();
    expect(within(line2).getByTestId('state-live')).toBeInTheDocument();
    // The words stay for a screen reader beside the shape.
    expect(within(line2).getByText('In progress')).toBeInTheDocument();
    expect(within(line2).getByTestId('slot-points')).toHaveTextContent('4.8 pts');
    const game = within(barkley).getByTestId('slot-game');
    expect(game).toHaveTextContent('PHI vs NO · Q3 11:20');
    expect(line2).not.toContainElement(game);
  });

  test('a starter yet to play shows his projection as the figure, never 0.0', () => {
    render(<SlotComparison {...baseProps} />);
    expect(within(cell(2, 'home')).getByTestId('slot-points')).toHaveTextContent('proj 14.2');
    expect(within(cell(2, 'home')).getByTestId('slot-points')).not.toHaveTextContent('0.0');
  });

  test('keeps one points element per cell (no desktop column) and the Totals row', () => {
    render(<SlotComparison {...baseProps} />);
    expect(within(cell(0, 'home')).getAllByTestId('slot-points')).toHaveLength(1);
    expect(screen.queryByText('Pts / proj')).not.toBeInTheDocument();
    expect(screen.getByTestId('slot-total-home')).toHaveTextContent('99.9 pts');
  });
});

describe('the viewer\'s side comes first', () => {
  const sides = (el) => Array.from(el.querySelectorAll('[data-testid^="slot-cell-"]')).map((n) => n.getAttribute('data-testid'));

  test('as the away team he is the left column and the opponent the right one, in the header, the rows and the Totals', () => {
    render(<SlotComparison {...awayViewerProps} />);

    expect(sides(rowAt(0))).toEqual(['slot-cell-away', 'slot-cell-home']);
    const totals = screen.getByTestId('slot-totals');
    expect(Array.from(totals.querySelectorAll('[data-testid^="slot-total-"]')).map((n) => n.getAttribute('data-testid'))).toEqual(['slot-total-away', 'slot-total-home']);
    const names = screen.getAllByText(/^(Duluth Dockworkers|Fargo Frostbite)$/).map((n) => n.textContent);
    expect(names).toEqual(['Fargo Frostbite', 'Duluth Dockworkers']);
    expect(screen.getByText('You').parentElement).toHaveTextContent('Fargo Frostbite');
    // Each side still carries its own figures: the away QB's points are the left cell's.
    expect(within(rowAt(0)).getAllByTestId('slot-points')[0]).toHaveTextContent('24.1 pts');
  });

  test('as the home team, and as a non-participant, home is on the left', () => {
    const { rerender } = render(<SlotComparison {...baseProps} first={homeSide(true)} />);
    expect(sides(rowAt(0))).toEqual(['slot-cell-home', 'slot-cell-away']);
    rerender(<SlotComparison {...baseProps} />);
    expect(sides(rowAt(0))).toEqual(['slot-cell-home', 'slot-cell-away']);
  });
});

describe('the Exp final column', () => {
  const withExp = rows.map((row) => ({
    ...row,
    first: row.first && { ...row.first, expected_final: 21.456 },
    second: row.second && { ...row.second, expected_final: null },
  }));

  test('a wide live row prints the producer\'s figure rounded to one decimal, a dash when it priced none, under an Exp final label', () => {
    render(<SlotComparison {...baseProps} rows={withExp} />);

    expect(within(cell(1, 'home')).getByTestId('slot-row-exp-final')).toHaveTextContent('Exp final 21.5');
    expect(within(cell(1, 'away')).getByTestId('slot-row-exp-final')).toHaveTextContent('Exp final –');
    expect(screen.getAllByText('Exp final').length).toBeGreaterThanOrEqual(2);
    // The Totals use the same columns.
    expect(screen.getAllByTestId('slot-exp-final').map((el) => el.textContent)).toEqual(['Exp final 110.5', 'Exp final 123.9']);
  });

  test('is not drawn before kickoff or once settled', () => {
    const { rerender } = render(<SlotComparison {...baseProps} rows={withExp} status="scheduled" />);
    expect(screen.queryByTestId('slot-row-exp-final')).not.toBeInTheDocument();
    rerender(<SlotComparison {...baseProps} rows={withExp} status="final" />);
    expect(screen.queryByTestId('slot-row-exp-final')).not.toBeInTheDocument();
    expect(screen.queryByText('Exp final')).not.toBeInTheDocument();
  });

  test('is not drawn on a phone, where the Totals carry each Exp final', () => {
    phone = true;
    render(<SlotComparison {...baseProps} rows={withExp} />);
    expect(screen.queryByTestId('slot-row-exp-final')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('slot-exp-final')).toHaveLength(2);
  });
});
