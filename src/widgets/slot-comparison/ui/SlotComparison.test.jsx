import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlotComparison } from '..';

// A Matchup detail starter row as the entity pairs it (the wire shape of
// GET /api/league/:id/matchups/:matchupId, #892 fields included).
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
// projection, and a TE with an empty away side. Points sum to 42.6 home / 28.9
// away; projections sum to 58.2 / 52.0, so a footer that summed projections
// would read differently.
const rows = [
  {
    slot: 'QB',
    home: starter(),
    away: starter({
      id: 2, name: 'J. Allen', nfl_team: 'BUF', opponent: 'MIA', points: 24.1, projected: 22.5,
    }),
  },
  {
    slot: 'RB',
    home: starter({
      id: 3, name: 'A. Jones', position: 'RB', nfl_team: 'GB', opponent: 'TB',
      points: 14.3, projected: 13.8, game_state: 'in_progress', game_clock: 'Q3 6:42',
      stats: { rushingYards: 71, rushingTDs: 1, receptions: 3, receivingYards: 22 },
    }),
    away: starter({
      id: 4, name: 'S. Barkley', position: 'RB', nfl_team: 'PHI', opponent: 'NO',
      points: 4.8, projected: 16.4, game_state: 'in_progress', game_clock: 'Q3 11:20',
      photo_url: 'https://cdn.example/barkley.png',
    }),
  },
  {
    slot: 'WR',
    home: starter({
      id: 5, name: 'D. Adams', position: 'WR', nfl_team: 'NYJ', opponent: 'CIN',
      points: 0, projected: 14.2, game_state: 'scheduled', stats: null,
    }),
    away: starter({
      id: 6, name: 'N. Collins', position: 'WR', nfl_team: 'HOU', opponent: 'LAR',
      points: 0, projected: 13.1, availability: { available: false, reason: 'ir' },
      game_state: 'scheduled', stats: null,
    }),
  },
  {
    slot: 'TE',
    home: starter({
      id: 7, name: 'T. Kelce', position: 'TE', nfl_team: 'KC', opponent: 'LAC',
      points: 9.7, projected: 11.0, game_state: 'in_progress', game_clock: 'Q2 1:05',
    }),
    away: null,
  },
];

const baseProps = {
  rows,
  homeName: 'Duluth Dockworkers',
  awayName: 'Fargo Frostbite',
  expectedFinal: { home: 110.5, away: 123.9 },
  onOpenPlayer: jest.fn(),
  expandedId: null,
  onToggle: jest.fn(),
};

const rowAt = (i) => screen.getAllByTestId('slot-row')[i];
const cell = (i, side) => within(rowAt(i)).getByTestId(`slot-cell-${side}`);
// What a side's headshot wrapper holds: the avatar photo (its src) or the
// initials fallback (its text). The avatar is aria-hidden, hence `hidden`.
const avatarOf = (i, side) => {
  const wrapper = within(cell(i, side)).getByTestId('slot-headshot');
  const photo = within(wrapper).queryByRole('img', { hidden: true });
  return photo ? { photo: photo.getAttribute('src') } : { initials: wrapper.textContent };
};

beforeEach(() => {
  baseProps.onOpenPlayer.mockClear();
  baseProps.onToggle.mockClear();
});

test('renders the header with both Team names, a headshot per filled side and the slots in the given order', () => {
  render(<SlotComparison {...baseProps} />);

  expect(screen.getByRole('heading', { name: 'Starters' })).toBeInTheDocument();
  expect(screen.getByText('4 slots')).toBeInTheDocument();
  expect(screen.getByText('Duluth Dockworkers')).toBeInTheDocument();
  expect(screen.getByText('Fargo Frostbite')).toBeInTheDocument();

  // Seven filled sides across four rows: the TE row's away side is empty. Each
  // headshot wrapper holds PlayerAvatar itself: the photo for the one starter
  // with a photo_url (Barkley), the initials fallback for the six without, so
  // a wrapper drawn with no avatar inside reads as neither and fails here.
  expect(screen.getAllByTestId('slot-row')).toHaveLength(4);
  expect(screen.getAllByTestId('slot-headshot')).toHaveLength(7);
  expect([0, 1, 2, 3].map((i) => avatarOf(i, 'home'))).toEqual([
    { initials: 'JG' }, { initials: 'AJ' }, { initials: 'DA' }, { initials: 'TK' },
  ]);
  expect([0, 1, 2].map((i) => avatarOf(i, 'away'))).toEqual([
    { initials: 'JA' }, { photo: 'https://cdn.example/barkley.png' }, { initials: 'NC' },
  ]);
  expect(within(cell(3, 'away')).queryByTestId('slot-headshot')).not.toBeInTheDocument();

  // The rows render as given, never re-sorted.
  expect(screen.getAllByTestId('pos-chip').map((chip) => chip.textContent)).toEqual(['QB', 'RB', 'WR', 'TE']);
});

test('a final starter shows the check and no clock', () => {
  render(<SlotComparison {...baseProps} />);
  const goff = cell(0, 'home');

  expect(within(goff).getByRole('img', { name: 'Final' })).toBeInTheDocument();
  expect(within(goff).queryByRole('img', { name: 'In progress' })).not.toBeInTheDocument();
  expect(within(goff).queryByRole('img', { name: 'Yet to play' })).not.toBeInTheDocument();
  expect(within(goff).getByTestId('slot-line2')).toHaveTextContent('DET vs CHI');
  expect(within(goff).getByTestId('slot-line2')).not.toHaveTextContent(/Q\d/);
});

test('an in-progress starter shows the live dot, in the design danger red, and its clock', () => {
  render(<SlotComparison {...baseProps} />);
  const jones = cell(1, 'home');

  const live = within(jones).getByRole('img', { name: 'In progress' });
  expect(live).toBeInTheDocument();
  // The dot is the design's `--danger` (build.mjs stateDot and the legend), not
  // the kit's accent: the pace bar's at-or-ahead fill is already green beside
  // it. jsdom cannot read a var() color, so the dot declares its tone.
  expect(within(live).getByTestId('live-dot')).toHaveAttribute('data-tone', 'danger');
  expect(within(screen.getByTestId('slot-legend')).getByTestId('live-dot'))
    .toHaveAttribute('data-tone', 'danger');
  expect(within(jones).queryByRole('img', { name: 'Final' })).not.toBeInTheDocument();
  expect(within(jones).getByTestId('slot-line2')).toHaveTextContent('GB vs TB · Q3 6:42');
  expect(within(jones).getByTestId('slot-points')).toHaveTextContent('14.3');
});

test('a scheduled starter shows the clock icon', () => {
  render(<SlotComparison {...baseProps} />);
  const adams = cell(2, 'home');

  expect(within(adams).getByRole('img', { name: 'Yet to play' })).toBeInTheDocument();
  expect(within(adams).queryByRole('img', { name: 'In progress' })).not.toBeInTheDocument();
  expect(within(adams).queryByRole('img', { name: 'Final' })).not.toBeInTheDocument();
});

test('a starter with an unknown game state shows no state marker', () => {
  const unknown = [{ slot: 'QB', home: starter({ game_state: null }), away: null }];
  render(<SlotComparison {...baseProps} rows={unknown} />);

  expect(within(cell(0, 'home')).queryByRole('img')).not.toBeInTheDocument();
});

test('an Unavailable starter shows the reason in place of the projection and no pace bar', () => {
  render(<SlotComparison {...baseProps} />);
  const collins = cell(2, 'away');
  const adams = cell(2, 'home');

  expect(within(collins).getByTestId('unavailable-reason')).toHaveTextContent('on IR');
  expect(within(collins).queryByTestId('pace-bar')).not.toBeInTheDocument();
  expect(within(collins).queryByText(/proj/)).not.toBeInTheDocument();
  expect(within(collins).queryByText('13.1')).not.toBeInTheDocument();

  // The available starter beside him keeps his bar and projection.
  expect(within(adams).getByTestId('pace-bar')).toBeInTheDocument();
  expect(within(adams).getByText('14.2 proj')).toBeInTheDocument();
  expect(within(adams).queryByTestId('unavailable-reason')).not.toBeInTheDocument();
});

test('the pace bar fills by points over projection and turns to the ahead fill at or past it', () => {
  render(<SlotComparison {...baseProps} />);

  // 4.8 of 16.4 -> 29%; 14.3 of 13.8 -> clamped to 100%.
  expect(within(cell(1, 'away')).getByTestId('pace-bar-fill')).toHaveStyle({ width: '29%' });
  expect(within(cell(1, 'home')).getByTestId('pace-bar-fill')).toHaveStyle({ width: '100%' });
});

test('the footer totals are the sum of each column points beside the Expected final', () => {
  render(<SlotComparison {...baseProps} />);
  const home = screen.getByTestId('slot-total-home');
  const away = screen.getByTestId('slot-total-away');

  // 18.6 + 14.3 + 0 + 9.7 (points, never projections, which would read 58.2).
  expect(within(home).getByText('42.6')).toBeInTheDocument();
  expect(within(home).getByText('EF 110.5')).toBeInTheDocument();
  // 24.1 + 4.8 + 0 over three filled sides (projections would read 52.0).
  expect(within(away).getByText('28.9')).toBeInTheDocument();
  expect(within(away).getByText('EF 123.9')).toBeInTheDocument();
  expect(screen.getByText('Totals')).toBeInTheDocument();
});

test('omits an Expected final the model does not carry', () => {
  render(<SlotComparison {...baseProps} expectedFinal={{ home: null, away: null }} />);

  expect(screen.queryByText(/^EF /)).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-totals')).toBeInTheDocument();
});

test('the name opens the player and the rest of the cell toggles the row', async () => {
  const user = userEvent.setup();
  render(<SlotComparison {...baseProps} />);
  const jones = cell(1, 'home');

  await user.click(within(jones).getByRole('button', { name: 'A. Jones' }));
  expect(baseProps.onOpenPlayer).toHaveBeenCalledWith(3);
  expect(baseProps.onToggle).not.toHaveBeenCalled();

  const expand = within(jones).getByRole('button', { name: 'Stats for A. Jones' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  await user.click(expand);
  expect(baseProps.onToggle).toHaveBeenCalledWith(3);
  expect(baseProps.onOpenPlayer).toHaveBeenCalledTimes(1);
});

test('an expanded row shows its stat line with middot separators and its pace', () => {
  render(<SlotComparison {...baseProps} expandedId={3} />);
  const strip = within(rowAt(1)).getByTestId('slot-expanded');

  expect(within(cell(1, 'home')).getByRole('button', { name: 'Stats for A. Jones' }))
    .toHaveAttribute('aria-expanded', 'true');
  expect(within(cell(1, 'away')).getByRole('button', { name: 'Stats for S. Barkley' }))
    .toHaveAttribute('aria-expanded', 'false');
  expect(strip).toHaveTextContent('71 rush yds · 1 rush TD · 3 rec · 22 rec yds');
  expect(strip).toHaveTextContent('14.3 / 13.8 proj');
  expect(within(strip).getByTestId('pace-bar')).toBeInTheDocument();
  // Only the open row carries a strip.
  expect(screen.getAllByTestId('slot-expanded')).toHaveLength(1);
});

test('an expanded row with nothing recorded says so, and an Unavailable one shows its reason without a bar', () => {
  const { rerender } = render(<SlotComparison {...baseProps} expandedId={5} />);
  expect(within(rowAt(2)).getByTestId('slot-expanded')).toHaveTextContent('No stats recorded yet.');

  rerender(<SlotComparison {...baseProps} expandedId={6} />);
  const strip = within(rowAt(2)).getByTestId('slot-expanded');
  expect(within(strip).getByTestId('unavailable-reason')).toHaveTextContent('on IR');
  expect(within(strip).queryByTestId('pace-bar')).not.toBeInTheDocument();
});

test('with no rows it shows an empty note and no totals', () => {
  render(<SlotComparison {...baseProps} rows={[]} />);

  expect(screen.getByText('0 slots')).toBeInTheDocument();
  expect(screen.getByText('No starters to compare yet.')).toBeInTheDocument();
  expect(screen.queryByTestId('slot-totals')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-row')).not.toBeInTheDocument();
});
