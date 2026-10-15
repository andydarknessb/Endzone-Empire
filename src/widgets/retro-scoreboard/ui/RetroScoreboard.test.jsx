import React from 'react';
import { render, screen, within, act, isInaccessible } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { matchupBoard } from '../../../entities/matchup';
import { RetroScoreboard } from '..';

// prefers-reduced-motion (and the widget's own breakpoints) are read through
// MUI's useMediaQuery; mock matchMedia per query (this file's Field cases
// below are the widget's own field tests and read the same mock), so reduced
// motion can be switched on without the widget also reading as mobile, and
// the stacked (max-width) layout switched on by itself. Default: no
// preference and the desktop layout, so the ordinary (animated) path runs.
let reducedMotion = false;
let stacked = false;
beforeEach(() => {
  reducedMotion = false;
  stacked = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /reduced-motion/.test(query) ? reducedMotion : /max-width/.test(query) ? stacked : false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

// The Matchup entity model as the page hands it down (entities/matchup).
const matchup = (overrides = {}) => ({
  id: 9,
  season: 2026,
  week: 3,
  final: false,
  status: 'live',
  firstKickoffAt: null,
  syncedAt: null,
  home: {
    teamId: 1, name: 'Duluth Dockworkers', avatarUrl: null, avatarStaticUrl: null,
    score: 82.2, expectedFinal: 110.5, playersRemaining: 4,
  },
  away: {
    teamId: 2, name: 'Fargo Frostbite', avatarUrl: null, avatarStaticUrl: null,
    score: 77, expectedFinal: 123.9, playersRemaining: 6,
  },
  ...overrides,
});

// A starter as the Matchup entity normalises a detail row (`playerFromDetailRow`,
// #2147): the Matchup page model pairs these by slot; the widget renders the
// pairs as given and reads no wire column.
const starter = (overrides = {}) => ({
  playerId: 10,
  name: 'J. Goff',
  position: 'QB',
  slot: 'QB',
  nflTeam: 'DET',
  points: 18.6,
  projectedPoints: 19.2,
  availability: { available: true, reason: null },
  photoUrl: 'https://cdn.example/goff.png',
  ...overrides,
});

const rows = [
  {
    slot: 'QB',
    home: starter(),
    away: starter({
      playerId: 11, name: 'J. Allen', nflTeam: 'BUF', points: 24.1, projectedPoints: 22.5,
      photoUrl: 'https://cdn.example/allen.png', injuryStatus: 'Q',
    }),
  },
  {
    slot: 'RB',
    home: starter({ playerId: 12, name: 'A. Jones', position: 'RB', slot: 'RB', nflTeam: 'GB', points: 14.3, projectedPoints: 13.8, photoUrl: null }),
    away: null,
  },
  {
    slot: 'DEF',
    home: starter({
      playerId: 13, name: 'Ravens D/ST', position: 'DEF', slot: 'DEF', nflTeam: 'BAL', points: 0, projectedPoints: 0,
      availability: { available: false, reason: 'bye' }, photoUrl: null,
    }),
    away: starter({ playerId: 14, name: '49ers D/ST', position: 'DEF', slot: 'DEF', nflTeam: 'SF', points: 3, projectedPoints: 6.5, photoUrl: null }),
  },
];

// live_game_states rows as the entity hands them down on `model.games`.
const games = [
  { tank01_game_id: 'g1', game_status: 'in_progress', quarter: 'Q3', time_remaining: '8:42', home_team: 'KC', away_team: 'DEN', current_score_home: 17, current_score_away: 10 },
  { tank01_game_id: 'g2', game_status: 'scheduled', start_time: '2026-09-20T23:20:00Z', quarter: null, time_remaining: null, home_team: 'NYJ', away_team: 'CIN', current_score_home: 0, current_score_away: 0 },
  { tank01_game_id: 'g3', game_status: 'final', quarter: 'Final', time_remaining: null, home_team: 'CLE', away_team: 'BAL', current_score_home: 20, current_score_away: 24 },
];

// The widget takes the entity's board (#2142). `homeProb` pins the board's
// Win probability for a started Matchup, the way the entity would state it;
// a Matchup that has not started has none, whatever is pinned, as on the real
// board (the entity's own tests pin that gate).
const boardFor = (m, { homeProb = 0.36, viewerTeamId } = {}) => {
  const board = matchupBoard(m, viewerTeamId);
  if (board.winProbability === null) return board;
  return { ...board, winProbability: homeProb == null ? null : { home: homeProb, away: 1 - homeProb } };
};

const scoreboard = (props = {}) => {
  const { homeProb, viewerTeamId, matchup: m = matchup(), ...rest } = props;
  return (
    <RetroScoreboard
      matchup={m}
      board={boardFor(m, { homeProb, viewerTeamId })}
      leagueName="Northwoods League"
      rows={rows}
      games={games}
      activePlay={null}
      {...rest}
    />
  );
};

const renderBoard = (props = {}) => render(scoreboard(props));

// A sprite's x position on the field, from the CSS transform the widget
// places it with (`translate(Xpx, Ypx)`, in the field's own user units).
const spriteX = (el) => Number(el.style.transform.match(/translate\(([-\d.]+)px/)[1]);

// The responsive layout is CSS only (sx breakpoint objects), which jsdom can
// neither lay out nor evaluate a media query for. Emotion still inserts every
// rule into its stylesheet (through insertRule, so the <style> text is empty
// but `document.styleSheets` carries them), and MUI emits a breakpoint value
// as a rule under `@media (min-width:<breakpoint>)`. This reads a slot's
// rules back by its generated class name: `base` gathers the declarations
// that apply below md (a plain rule or one under min-width:0px), `md` the
// ones under `@media (min-width:900px)`.
const rulesFor = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = { base: '', md: '' };
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      const media = rule.media ? rule.media.mediaText : '';
      const inner = rule.cssRules ? Array.from(rule.cssRules) : [rule];
      inner.forEach((r) => {
        if (r.selectorText !== `.${cls}`) return;
        found[/min-width:\s*900px/.test(media) ? 'md' : 'base'] += `${r.style.cssText};`;
      });
    });
  });
  return found;
};

// --- LED board ---------------------------------------------------------------

test('the LED board renders both one-decimal scores, both win percentages, and Expected final and to-play per side', () => {
  renderBoard();

  const board = within(screen.getByTestId('led-board'));
  expect(board.getByTestId('led-score-home')).toHaveTextContent('82.2');
  expect(board.getByTestId('led-score-away')).toHaveTextContent('77.0');
  expect(board.getByTestId('led-win-home')).toHaveTextContent('36%');
  expect(board.getByTestId('led-win-away')).toHaveTextContent('64%');
  expect(board.getByTestId('led-home-ef')).toHaveTextContent('110.5');
  expect(board.getByTestId('led-away-ef')).toHaveTextContent('123.9');
  expect(board.getByTestId('led-home-pmr')).toHaveTextContent('4');
  expect(board.getByTestId('led-away-pmr')).toHaveTextContent('6');
  expect(board.getAllByText('EXP FINAL')).toHaveLength(2);
  expect(board.getAllByText('TO PLAY')).toHaveLength(2);

  // The top line: league, week and the entity's status label, on the LED face.
  expect(board.getByText('NORTHWOODS LEAGUE')).toBeInTheDocument();
  expect(board.getByText('WEEK 3')).toBeInTheDocument();
  expect(board.getByText('LIVE')).toBeInTheDocument();
  expect(board.getByText('DULUTH DOCKWORKERS')).toBeInTheDocument();
  expect(board.getByText('FARGO FROSTBITE')).toBeInTheDocument();
});

test('the LED board blanks an unpriced Expected final and an unknown win probability rather than printing a zero', () => {
  renderBoard({
    matchup: matchup({ status: 'live', home: { ...matchup().home, expectedFinal: null, playersRemaining: 0 } }),
    homeProb: null,
  });

  const board = within(screen.getByTestId('led-board'));
  expect(board.getByTestId('led-home-ef')).toHaveTextContent('-');
  expect(board.getByTestId('led-home-pmr')).toHaveTextContent('0');
  expect(board.getByTestId('led-win-home')).toHaveTextContent('-');
  expect(board.getByTestId('led-win-away')).toHaveTextContent('-');
  expect(board.getByText('LIVE')).toBeInTheDocument();
  // ADR 0030: an unknown status shows blank, never a guessed "NOT STARTED".
  expect(board.queryByText('NOT STARTED')).not.toBeInTheDocument();
});

// A final or played matchup states the result instead (#2007): the WIN row and
// the EXP FINAL / TO PLAY row give way to one result line, which is real text.
test.each([
  ['final', 'You won by 5.2', false],
  ['final', 'You won by 5.2', true],
  ['played', 'Unofficial: You won by 5.2', false],
])('a %s LED board (mobile: %s) renders the result line in place of the WIN and EXP FINAL rows', (status, line, mobileBoard) => {
  stacked = mobileBoard;
  renderBoard({ matchup: matchup({ status }), homeProb: 1, viewerTeamId: 1 });
  const board = within(screen.getByTestId('led-board'));
  const result = board.getByTestId('led-result');
  expect(result).toHaveTextContent(line);
  expect(isInaccessible(result)).toBe(false);
  expect(board.queryByTestId('led-win')).not.toBeInTheDocument();
  expect(board.queryByText('WIN')).not.toBeInTheDocument();
  expect(board.queryByText('EXP FINAL')).not.toBeInTheDocument();
  expect(board.queryByText('TO PLAY')).not.toBeInTheDocument();
  expect(board.queryByTestId('led-home-ef')).not.toBeInTheDocument();
  // The scores and the status stay.
  expect(board.getByTestId('led-score-home')).toHaveTextContent('82.2');
});

test('the LED result line names the winner for a spectator and reads Tied on a tie', () => {
  const { unmount } = renderBoard({ matchup: matchup({ status: 'final' }), homeProb: 1 });
  expect(screen.getByTestId('led-result')).toHaveTextContent('Duluth Dockworkers won by 5.2');
  unmount();
  renderBoard({
    matchup: matchup({ status: 'final', away: { ...matchup().away, score: 82.2 } }),
    homeProb: 0.5,
    viewerTeamId: 2,
  });
  expect(screen.getByTestId('led-result')).toHaveTextContent('Tied');
});

test.each(['scheduled', 'live', null])('a %s LED board has no result line', (status) => {
  renderBoard({ matchup: matchup({ status }), homeProb: 0.5, viewerTeamId: 1 });
  expect(screen.queryByTestId('led-result')).not.toBeInTheDocument();
});

// --- Field -------------------------------------------------------------------

test('the field places the two sprites by the home probability: a higher probability moves the home sprite further right', () => {
  const { rerender } = renderBoard({ homeProb: 0.2 });
  const homeLow = spriteX(screen.getByTestId('sprite-home'));
  const awayLow = spriteX(screen.getByTestId('sprite-away'));

  rerender(
    scoreboard({ homeProb: 0.8 })
  );
  const homeHigh = spriteX(screen.getByTestId('sprite-home'));
  const awayHigh = spriteX(screen.getByTestId('sprite-away'));

  // Red-tell: reversing the sprite direction (moving the home sprite LEFT as
  // its chances rise) turns this case red and no other.
  expect(homeHigh).toBeGreaterThan(homeLow);
  // The away defender trails the runner and moves with it.
  expect(awayHigh).toBeGreaterThan(awayLow);
  expect(awayLow).toBeGreaterThan(homeLow);
});

test('the field announces the live win probability and carries each side\'s name in its end zone', () => {
  renderBoard({ homeProb: 0.73 });

  expect(screen.getByRole('img', { name: 'Field position: Duluth Dockworkers 73% likely to win' })).toBeInTheDocument();
  // The LED board and the end zone both carry the uppercased name.
  expect(screen.getAllByText('DULUTH DOCKWORKERS').length).toBeGreaterThan(1);
  expect(screen.getAllByText('FARGO FROSTBITE').length).toBeGreaterThan(1);
});

test('the field does not announce a guessed 50% when the win probability is unknown', () => {
  renderBoard({ homeProb: null });
  const field = screen.getByRole('img', { name: /Field position/ });
  expect(field).toHaveAccessibleName('Field position: win probability not yet available');
  expect(field).not.toHaveAccessibleName(/50%/);
  // The board's WIN row blanks for the same unknown, so the two agree.
  expect(within(screen.getByTestId('led-board')).getByTestId('led-win-home')).toHaveTextContent('-');
});

// The Scoreboard view follows the started state exactly as the Standard
// view's strip does (#903 review): before kickoff, and under a status the
// server could not compute, there are no WIN digits and the sprites rest at
// the neutral midpoint, whatever probability the page computed. Red-tell:
// showing the WIN row for a scheduled Matchup turns the scheduled case red;
// gating on `hasStarted !== false` (which lets null through) turns the null
// case red and no other.
test.each(['scheduled', null])('a %s matchup shows no WIN digits and parks the sprites at midfield even with a probability on hand', (status) => {
  // The neutral midpoint: where an unknown probability parks the sprites.
  const { unmount: unmountNeutral } = renderBoard({ matchup: matchup({ status: 'live' }), homeProb: null });
  const midHome = spriteX(screen.getByTestId('sprite-home'));
  const midAway = spriteX(screen.getByTestId('sprite-away'));
  unmountNeutral();
  // Where 0.8 puts the home runner once started: further right than midfield.
  const { unmount: unmountStarted } = renderBoard({ matchup: matchup({ status: 'live' }), homeProb: 0.8 });
  expect(spriteX(screen.getByTestId('sprite-home'))).toBeGreaterThan(midHome);
  unmountStarted();

  renderBoard({ matchup: matchup({ status }), homeProb: 0.8 });
  const board = within(screen.getByTestId('led-board'));
  expect(board.queryByTestId('led-win')).not.toBeInTheDocument();
  expect(board.queryByText('WIN')).not.toBeInTheDocument();
  expect(board.queryByText('80%')).not.toBeInTheDocument();
  expect(board.queryByText('20%')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Field position/ })).toHaveAccessibleName('Field position: win probability not yet available');
  expect(spriteX(screen.getByTestId('sprite-home'))).toBe(midHome);
  expect(spriteX(screen.getByTestId('sprite-away'))).toBe(midAway);
});

// The home win probability reaches the accessibility tree once (#903 review):
// the field image's name carries it, and the board's WIN row is its visible,
// decorative duplicate, hidden from the tree. Red-tell: dropping the
// aria-hidden from the WIN row turns the attribute assertion red.
test('the WIN row is aria-hidden, so the probability is announced once, on the field image', () => {
  renderBoard({ homeProb: 0.73 });
  const win = within(screen.getByTestId('led-board')).getByTestId('led-win');
  expect(win).toHaveAttribute('aria-hidden', 'true');
  expect(win).toHaveTextContent('WIN');
  expect(win).toHaveTextContent('73%');
  expect(win).toHaveTextContent('27%');
  expect(screen.getAllByRole('img', { name: /73% likely to win/ })).toHaveLength(1);
  // Every "73%" text node sits under the hidden row: nothing outside the
  // image exposes the figure.
  screen.getAllByText('73%').forEach((el) => expect(win).toContainElement(el));
});

test('the field caption carries the sentence and, on its right, whatever the page slots in as the tail', () => {
  const { rerender } = renderBoard();
  const caption = screen.getByTestId('field-caption');
  expect(caption).toHaveTextContent('Sprites move with win probability. Plays flash on the field as they land.');
  expect(within(caption).queryByRole('button')).not.toBeInTheDocument();

  rerender(scoreboard({ fieldTail: <button type="button">Celebrations on</button> }));
  const withTail = within(screen.getByTestId('retro-field'));
  expect(withTail.getByRole('button', { name: 'Celebrations on' })).toBeInTheDocument();
  expect(screen.getByTestId('field-caption')).toContainElement(withTail.getByRole('button', { name: 'Celebrations on' }));
});

test('a non-touchdown moment play flashes the LED callout on the field as a status', () => {
  renderBoard({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
  expect(screen.getByRole('status')).toHaveTextContent('BUF · SACK');
});

test('no callout renders without an active play, and a touchdown dashes the sprite in its NFL kit instead of flashing a callout', () => {
  const { rerender } = renderBoard({ activePlay: null });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // At rest each sprite wears the resting kit, its jersey inheriting the
  // side's token through currentColor, under its Team's initials.
  expect(screen.getByTestId('sprite-home')).toHaveAttribute('data-kit', 'rest');
  expect(screen.getByTestId('sprite-away')).toHaveAttribute('data-kit', 'rest');
  expect(screen.getByTestId('sprite-home')).toHaveStyle({ color: 'var(--dash-home)' });
  expect(screen.getByTestId('sprite-away')).toHaveStyle({ color: 'var(--dash-away)' });
  expect(within(screen.getByTestId('sprite-home')).getByText('DD')).toBeInTheDocument();
  expect(within(screen.getByTestId('sprite-away')).getByText('FF')).toBeInTheDocument();

  rerender(
    scoreboard({ activePlay: { side: 'home', type: 'rushing', isTouchdown: true, nflTeam: 'KC', opponent: 'BUF' } })
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Field position/ })).toBeInTheDocument();
  // The scoring side's sprite dashes in its real NFL kit (getSpriteColors);
  // the other sprite stays at rest in its side's color.
  expect(screen.getByTestId('sprite-home')).toHaveAttribute('data-kit', 'nfl');
  expect(screen.getByTestId('sprite-away')).toHaveAttribute('data-kit', 'rest');
});

test('under reduced motion the moment callout is still rendered (not gated out by the preference)', () => {
  // The visible/invisible distinction is a computed-opacity one jsdom cannot
  // resolve (see this file's Field cases above, the widget's own field
  // tests); what this guards is that the reduced path keeps the callout in
  // the DOM and announced.
  reducedMotion = true;
  renderBoard({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
  expect(screen.getByRole('status')).toHaveTextContent('BUF · SACK');
});

test('under reduced motion the moment callout dismisses on its own after the flash window', () => {
  jest.useFakeTimers();
  try {
    reducedMotion = true;
    renderBoard({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1800); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

// --- Lineups card --------------------------------------------------------------

test('the Lineups card renders the paired rows in the given order with a headshot per filled side', () => {
  renderBoard();

  const card = within(screen.getByTestId('lineups-card'));
  expect(card.getByRole('heading', { name: 'Lineups' })).toBeInTheDocument();
  const slotRows = card.getAllByTestId('slot-row');
  expect(slotRows).toHaveLength(3);
  // The rows are rendered as given (the entity's order), each with its PosChip.
  expect(slotRows.map((row) => within(row).getByTestId('pos-chip').textContent)).toEqual(['QB', 'RB', 'D/ST']);

  // Row one: a headshot per side, each the player's ESPN photo, and the
  // "points · proj" note under each name.
  const qb = within(slotRows[0]);
  expect(within(qb.getByTestId('headshot-home')).getByRole('img', { hidden: true })).toHaveAttribute('src', 'https://cdn.example/goff.png');
  expect(within(qb.getByTestId('headshot-away')).getByRole('img', { hidden: true })).toHaveAttribute('src', 'https://cdn.example/allen.png');
  expect(qb.getByText('J. Goff')).toBeInTheDocument();
  expect(qb.getByText('J. Allen')).toBeInTheDocument();
  expect(qb.getAllByTestId('lineup-note').map((el) => el.textContent)).toEqual(['18.6 · proj 19.2', '24.1 · proj 22.5']);
  // The flagged starter carries his injury designation beside his name (the
  // legacy page's badge, #903); the healthy one carries none.
  const allen = within(qb.getByTestId('lineup-side-away'));
  expect(allen.getByTestId('injury-tag')).toHaveAttribute('data-status', 'Q');
  expect(allen.getByText('Q')).toBeInTheDocument();
  expect(allen.getByText('Injury status: Questionable')).toBeInTheDocument();
  expect(within(qb.getByTestId('lineup-side-home')).queryByTestId('injury-tag')).not.toBeInTheDocument();
  expect(card.getAllByTestId('injury-tag')).toHaveLength(1);

  // Row two: only the home side is filled; the row keeps its empty away side.
  const rb = within(slotRows[1]);
  expect(rb.getByTestId('headshot-home')).toBeInTheDocument();
  expect(rb.queryByTestId('headshot-away')).not.toBeInTheDocument();
  expect(rb.getByTestId('lineup-side-away')).toBeEmptyDOMElement();
  expect(rb.getByText('A. Jones')).toBeInTheDocument();

  // Row three: an Unavailable starter shows the reason where his projection
  // would go (the `unavailable-reason` id the page tests read); a photo-less
  // player still gets an initials headshot.
  const def = within(slotRows[2]);
  expect(def.getByTestId('unavailable-reason')).toHaveTextContent('on bye');
  expect(def.getAllByTestId('lineup-note').map((el) => el.textContent)).toEqual(['0.0 · on bye', '3.0 · proj 6.5']);
  expect(def.getByTestId('headshot-home')).toHaveTextContent('RD');
  // Only the one Unavailable starter carries the reason.
  expect(card.getAllByTestId('unavailable-reason')).toHaveLength(1);
});

test('every Lineups headshot wears its position\'s pos-* ring, the treatment the slot comparison shares', () => {
  renderBoard();
  const slotRows = within(screen.getByTestId('lineups-card')).getAllByTestId('slot-row');
  const ringOf = (row, side) => within(row).getByTestId(`headshot-${side}`).getAttribute('data-ring');
  expect(ringOf(slotRows[0], 'home')).toBe('qb');
  expect(ringOf(slotRows[0], 'away')).toBe('qb');
  expect(ringOf(slotRows[1], 'home')).toBe('rb');
  expect(ringOf(slotRows[2], 'home')).toBe('def');
  expect(ringOf(slotRows[2], 'away')).toBe('def');
  // The ring is painted as a box-shadow in the position's token (jsdom keeps
  // the var() in a box-shadow, unlike a color), rounded to the pill.
  expect(within(slotRows[0]).getByTestId('headshot-home')).toHaveStyle({ boxShadow: '0 0 0 2px var(--pos-qb)' });
  expect(within(slotRows[1]).getByTestId('headshot-home')).toHaveStyle({ boxShadow: '0 0 0 2px var(--pos-rb)' });
});

// A starter with the game fields the wire carries (league.router.js buildPlayer).
const gameRows = [
  {
    slot: 'QB',
    home: starter({ gameState: 'in_progress', gameClock: 'Q3 7:22', opponent: 'GB' }),
    away: starter({ playerId: 11, name: 'J. Allen', nflTeam: 'BUF', gameState: 'final', opponent: 'MIA', gameClock: null }),
  },
  {
    slot: 'RB',
    home: starter({ playerId: 12, name: 'A. Jones', position: 'RB', slot: 'RB', gameState: 'scheduled', opponent: 'DET', gameClock: null }),
    away: starter({ playerId: 15, name: 'No State', position: 'RB', slot: 'RB' }),
  },
];

test('each Lineups row carries the state marker Standard draws, named for a screen reader', () => {
  renderBoard({ rows: gameRows });
  const [qb, rb] = within(screen.getByTestId('lineups-card')).getAllByTestId('slot-row');

  expect(within(within(qb).getByTestId('lineup-side-home')).getByRole('img', { name: 'In progress' })).toHaveAttribute('data-testid', 'state-live');
  expect(within(within(qb).getByTestId('lineup-side-away')).getByRole('img', { name: 'Final' })).toHaveAttribute('data-testid', 'state-final');
  expect(within(within(rb).getByTestId('lineup-side-home')).getByRole('img', { name: 'Yet to play' })).toHaveAttribute('data-testid', 'state-scheduled');
  // A starter whose state the wire does not speak gets no marker, nothing guessed.
  expect(within(within(rb).getByTestId('lineup-side-away')).queryByRole('img', { name: /progress|final|yet to play/i })).not.toBeInTheDocument();
});

test('on desktop the marker sits beside the name and the name ellipsizes', () => {
  renderBoard({ rows: gameRows });
  const home = within(within(screen.getByTestId('lineups-card')).getAllByTestId('slot-row')[0]).getByTestId('lineup-side-home');
  expect(within(home).getByText('J. Goff')).toHaveStyle({ textOverflow: 'ellipsis' });
  expect(within(within(home).getByTestId('lineup-line1')).getByTestId('state-live')).toBeInTheDocument();
  expect(within(within(home).getByTestId('lineup-line2')).queryByTestId('state-live')).not.toBeInTheDocument();
});

test('on a phone the marker leads the second line and the name wraps instead of ellipsizing', () => {
  stacked = true;
  renderBoard({ rows: gameRows });
  const [qb, rb] = within(screen.getByTestId('lineups-card')).getAllByTestId('slot-row');
  const home = within(within(qb).getByTestId('lineup-side-home'));

  const line2 = home.getByTestId('lineup-line2');
  expect(within(line2).getByRole('img', { name: 'In progress' })).toBeInTheDocument();
  // The marker comes before the points note, and leaves the name's line.
  expect(within(line2).getByTestId('state-live').compareDocumentPosition(within(line2).getByTestId('lineup-note')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(home.getByTestId('lineup-line1')).not.toContainElement(home.getByTestId('state-live'));

  const name = home.getByText('J. Goff');
  expect(name).not.toHaveStyle({ textOverflow: 'ellipsis' });
  expect(name).not.toHaveStyle({ whiteSpace: 'nowrap' });
  // 'break-word', not 'anywhere': a short word is never split mid-word at 320px.
  expect(name).toHaveStyle({ overflowWrap: 'break-word' });

  // Final and scheduled starters lead their second line with their markers too.
  expect(within(within(within(qb).getByTestId('lineup-side-away')).getByTestId('lineup-line2')).getByTestId('state-final')).toBeInTheDocument();
  expect(within(within(within(rb).getByTestId('lineup-side-home')).getByTestId('lineup-line2')).getByTestId('state-scheduled')).toBeInTheDocument();
});

test('a live Lineups row names the opponent and the game clock on its second line', () => {
  renderBoard({ rows: gameRows });
  const [qb, rb] = within(screen.getByTestId('lineups-card')).getAllByTestId('slot-row');

  const live = within(within(qb).getByTestId('lineup-side-home'));
  expect(live.getByText('Q3 7:22')).toBeInTheDocument();
  expect(live.getByTestId('lineup-game')).toHaveTextContent('vs GB · Q3 7:22');
  // Final and scheduled starters have no clock: the opponent alone.
  expect(within(within(qb).getByTestId('lineup-side-away')).getByTestId('lineup-game')).toHaveTextContent(/^vs MIA$/);
  expect(within(within(rb).getByTestId('lineup-side-home')).getByTestId('lineup-game')).toHaveTextContent(/^vs DET$/);
  // No opponent and no clock: no game line at all, and the points note is untouched.
  const bare = within(within(rb).getByTestId('lineup-side-away'));
  expect(bare.queryByTestId('lineup-game')).not.toBeInTheDocument();
  expect(bare.getByTestId('lineup-note')).toHaveTextContent('18.6 · proj 19.2');
});

test('the Lineups card ends with a Totals row of both scores and Expected finals', () => {
  renderBoard();
  const card = within(screen.getByTestId('lineups-card'));
  const totals = within(card.getByTestId('lineup-totals'));

  expect(totals.getByText('Totals')).toBeInTheDocument();
  expect(totals.getByTestId('lineup-total-home')).toHaveTextContent('82.2');
  expect(totals.getByTestId('lineup-total-home')).toHaveTextContent('Exp final 110.5');
  expect(totals.getByTestId('lineup-total-away')).toHaveTextContent('77.0');
  expect(totals.getByTestId('lineup-total-away')).toHaveTextContent('Exp final 123.9');
  // It is the card's last row, below the slot rows.
  const rowsInCard = card.getAllByTestId('slot-row');
  expect(rowsInCard[rowsInCard.length - 1].compareDocumentPosition(totals.getByTestId('lineup-total-home')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the Totals row Exp final notes wrap, so 320px never scrolls sideways (#2010 QA)', () => {
  renderBoard();
  const notes = within(screen.getByTestId('lineup-totals')).getAllByTestId('lineup-exp-final');

  expect(notes).toHaveLength(2);
  for (const note of notes) expect(note).not.toHaveStyle({ whiteSpace: 'nowrap' });
});

test.each(['played', 'final'])('a %s matchup hides the Totals row Exp final though the server priced one (#2010 QA)', (status) => {
  renderBoard({ matchup: matchup({ status }) });
  const totals = within(screen.getByTestId('lineup-totals'));

  expect(totals.getByTestId('lineup-total-home')).toHaveTextContent('82.2');
  expect(totals.getByTestId('lineup-total-home')).not.toHaveTextContent('Exp final');
  expect(totals.getByTestId('lineup-total-away')).not.toHaveTextContent('Exp final');
});

test('the Totals row drops an Expected final the server did not price', () => {
  const m = matchup();
  renderBoard({ matchup: matchup({ home: { ...m.home, expectedFinal: null } }) });
  const totals = within(screen.getByTestId('lineup-totals'));
  expect(totals.getByTestId('lineup-total-home')).not.toHaveTextContent('Exp final');
  expect(totals.getByTestId('lineup-total-away')).toHaveTextContent('Exp final 123.9');
});

test('the Lineups card shows an empty line until the paired rows arrive', () => {
  renderBoard({ rows: [] });
  const card = within(screen.getByTestId('lineups-card'));
  expect(card.queryAllByTestId('slot-row')).toHaveLength(0);
  expect(card.getByText('No starters to show yet.')).toBeInTheDocument();
  expect(card.queryByTestId('lineup-totals')).not.toBeInTheDocument();
});

test('the Lineups card offers a Full comparison action only when the page gives it one', async () => {
  const onFullComparison = jest.fn();
  const { rerender } = renderBoard();
  expect(screen.queryByRole('button', { name: 'Full comparison' })).not.toBeInTheDocument();

  rerender(scoreboard({ onFullComparison }));
  await userEvent.click(screen.getByRole('button', { name: 'Full comparison' }));
  expect(onFullComparison).toHaveBeenCalledTimes(1);
});

// --- Games tile ----------------------------------------------------------------

test('the Games tile lists every game row with a live dot or a clock glyph and its clock', () => {
  renderBoard();

  const tile = within(screen.getByTestId('games-tile'));
  expect(tile.getByRole('heading', { name: 'Games' })).toBeInTheDocument();
  expect(tile.getByText('1 live')).toBeInTheDocument();
  const gameRows = tile.getAllByTestId('game-row');
  expect(gameRows).toHaveLength(3);

  // In progress: the live dot (with its hidden word, so the state is not
  // colour alone), both scores (away first) and the quarter and clock.
  const live = within(gameRows[0]);
  expect(live.getByTestId('live-dot')).toBeInTheDocument();
  // The dot is the design's danger red, as the slot comparison paints its
  // own live marker; the tone is declared where jsdom can read it.
  expect(live.getByTestId('live-dot')).toHaveAttribute('data-tone', 'danger');
  expect(live.getByText('Live')).toBeInTheDocument();
  expect(live.queryByTestId('clock-glyph')).not.toBeInTheDocument();
  expect(live.getByText('DEN 10 - 17 KC')).toBeInTheDocument();
  expect(live.getByText('Q3 8:42')).toBeInTheDocument();

  // Scheduled: the clock glyph, no scores, and the kickoff time.
  const scheduled = within(gameRows[1]);
  expect(scheduled.queryByTestId('live-dot')).not.toBeInTheDocument();
  expect(scheduled.getByTestId('clock-glyph')).toBeInTheDocument();
  expect(scheduled.getByText('CIN @ NYJ')).toBeInTheDocument();
  expect(gameRows[1]).toHaveAttribute('data-state', 'scheduled');
  expect(gameRows[1]).toHaveTextContent(/\d{1,2}:\d{2}/);
  expect(gameRows[1]).not.toHaveTextContent('TBD');

  // Final: the clock glyph, the score line and FINAL.
  const final = within(gameRows[2]);
  expect(final.queryByTestId('live-dot')).not.toBeInTheDocument();
  expect(final.getByTestId('clock-glyph')).toBeInTheDocument();
  expect(final.getByText('BAL 24 - 20 CLE')).toBeInTheDocument();
  expect(final.getByText('FINAL')).toBeInTheDocument();
  expect(gameRows[2]).toHaveAttribute('data-state', 'final');
});

test('the Games tile says so when the Matchup spans no listed games', () => {
  renderBoard({ games: [] });
  const tile = within(screen.getByTestId('games-tile'));
  expect(tile.getByText('0 live')).toBeInTheDocument();
  expect(tile.getByText('No games listed.')).toBeInTheDocument();
});

// --- Composition -----------------------------------------------------------------

test('renders nothing without a Matchup', () => {
  render(<RetroScoreboard matchup={null} board={matchupBoard(null)} rows={rows} games={games} />);
  expect(screen.queryByTestId('retro-scoreboard')).not.toBeInTheDocument();
});

test('the cards take the heading level the page gives and the aside slot sits in the right column above the Games tile', () => {
  renderBoard({ headingLevel: 3, aside: <div data-testid="page-aside">Bench what-if</div> });

  expect(screen.getByRole('heading', { level: 3, name: 'Lineups' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Games' })).toBeInTheDocument();
  const column = screen.getByTestId('right-column');
  expect(column).toContainElement(screen.getByTestId('page-aside'));
  expect(column).toContainElement(screen.getByTestId('games-tile'));
  // Desktop reading order in the DOM: Lineups, then the aside, then Games.
  expect(screen.getByTestId('lineups-slot').compareDocumentPosition(screen.getByTestId('aside-slot')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByTestId('aside-slot').compareDocumentPosition(screen.getByTestId('games-slot')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('below md the columns stack in the mobile artboard\'s order: Games, then Lineups, then the aside last', () => {
  renderBoard({ aside: <div data-testid="page-aside">Bench what-if</div> });

  // The right column dissolves into the grid below md and is a flex column
  // from md up, so its two slots order themselves against the Lineups slot.
  const column = rulesFor(screen.getByTestId('right-column'));
  expect(column.base).toMatch(/display:\s*contents/);
  expect(column.md).toMatch(/display:\s*flex/);

  const lineups = rulesFor(screen.getByTestId('lineups-slot'));
  const aside = rulesFor(screen.getByTestId('aside-slot'));
  const gamesSlot = rulesFor(screen.getByTestId('games-slot'));
  // Stacked: Games (1), Lineups (2), aside (3).
  expect(gamesSlot.base).toMatch(/\border:\s*1;/);
  expect(lineups.base).toMatch(/\border:\s*2;/);
  expect(aside.base).toMatch(/\border:\s*3;/);
  // Columns: Lineups first, then the right column's aside over its Games.
  expect(lineups.md).toMatch(/\border:\s*1;/);
  expect(aside.md).toMatch(/\border:\s*1;/);
  expect(gamesSlot.md).toMatch(/\border:\s*2;/);
});

// Document order, the one layout fact jsdom can read.
const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// The canvas (matchupScoreboardDesktop()) draws the ticker full width between
// the field and the Lineups/aside grid, never inside the 340px column where a
// four-play row would clip; the aside sits above the Games tile in that column.
test('on desktop the ticker slot renders full width under the field, before the Lineups card, and the aside sits above the Games tile', () => {
  renderBoard({
    ticker: <div data-testid="page-ticker">Last plays</div>,
    aside: <div data-testid="page-aside">Bench what-if</div>,
  });

  const field = screen.getByTestId('retro-field');
  const ticker = screen.getByTestId('page-ticker');
  const lineups = screen.getByTestId('lineups-card');
  const aside = screen.getByTestId('page-aside');
  const games = screen.getByTestId('games-tile');
  expect(precedes(field, ticker)).toBe(true);
  expect(precedes(ticker, lineups)).toBe(true);
  expect(precedes(lineups, aside)).toBe(true);
  expect(precedes(aside, games)).toBe(true);
});

// The canvas (liveTicker()): the ticker sits under the field and above the
// cards at every width. It is a slot the page fills; the cards' own stacking
// below md is CSS order (the case above), so the DOM keeps the desktop reading
// order and nothing remounts at the breakpoint.
test('the ticker slot renders under the field and before every card, at every width', () => {
  stacked = true;
  renderBoard({
    ticker: <div data-testid="page-ticker">Last plays</div>,
    aside: <div data-testid="page-aside">Bench what-if</div>,
  });

  const ticker = screen.getByTestId('page-ticker');
  expect(precedes(screen.getByTestId('retro-field'), ticker)).toBe(true);
  expect(precedes(ticker, screen.getByTestId('lineups-card'))).toBe(true);
  expect(precedes(ticker, screen.getByTestId('games-tile'))).toBe(true);
  expect(precedes(ticker, screen.getByTestId('page-aside'))).toBe(true);
  // The aside lands in the widget's aside slot, so the CSS order rules above
  // apply to it.
  expect(within(screen.getByTestId('aside-slot')).getByTestId('page-aside')).toBeInTheDocument();
});

test('without a ticker or an aside the widget renders only its own pieces', () => {
  renderBoard();
  expect(screen.queryByTestId('page-ticker')).not.toBeInTheDocument();
  expect(screen.queryByTestId('page-aside')).not.toBeInTheDocument();
  expect(screen.getByTestId('lineups-card')).toBeInTheDocument();
  expect(screen.getByTestId('games-tile')).toBeInTheDocument();
});
