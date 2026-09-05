import React from 'react';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RetroScoreboard } from '..';

// prefers-reduced-motion (and the widget's own mobile breakpoint) are read
// through MUI's useMediaQuery; mock matchMedia the way RetroField.test.jsx
// does, but answer per query so reduced motion can be switched on without the
// widget also reading as mobile. Default: no preference, so the ordinary
// (animated) path runs.
let reducedMotion = false;
beforeEach(() => {
  reducedMotion = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /reduced-motion/.test(query) ? reducedMotion : false,
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

// A detail starter row as the wire carries it (league.router.js buildPlayer):
// the entity pairs these by slot; the widget renders the pairs as given.
const starter = (overrides = {}) => ({
  id: 10,
  name: 'J. Goff',
  position: 'QB',
  slot: 'QB',
  nfl_team: 'DET',
  points: 18.6,
  projected: 19.2,
  availability: { available: true, reason: null },
  photo_url: 'https://cdn.example/goff.png',
  ...overrides,
});

const rows = [
  {
    slot: 'QB',
    home: starter(),
    away: starter({ id: 11, name: 'J. Allen', nfl_team: 'BUF', points: 24.1, projected: 22.5, photo_url: 'https://cdn.example/allen.png' }),
  },
  {
    slot: 'RB',
    home: starter({ id: 12, name: 'A. Jones', position: 'RB', slot: 'RB', nfl_team: 'GB', points: 14.3, projected: 13.8, photo_url: null }),
    away: null,
  },
  {
    slot: 'DEF',
    home: starter({
      id: 13, name: 'Ravens D/ST', position: 'DEF', slot: 'DEF', nfl_team: 'BAL', points: 0, projected: 0,
      availability: { available: false, reason: 'bye' }, photo_url: null,
    }),
    away: starter({ id: 14, name: '49ers D/ST', position: 'DEF', slot: 'DEF', nfl_team: 'SF', points: 3, projected: 6.5, photo_url: null }),
  },
];

// live_game_states rows as the entity hands them down on `model.games`.
const games = [
  { tank01_game_id: 'g1', game_status: 'in_progress', quarter: 'Q3', time_remaining: '8:42', home_team: 'KC', away_team: 'DEN', current_score_home: 17, current_score_away: 10 },
  { tank01_game_id: 'g2', game_status: 'scheduled', start_time: '2026-09-20T23:20:00Z', quarter: null, time_remaining: null, home_team: 'NYJ', away_team: 'CIN', current_score_home: 0, current_score_away: 0 },
  { tank01_game_id: 'g3', game_status: 'final', quarter: 'Final', time_remaining: null, home_team: 'CLE', away_team: 'BAL', current_score_home: 20, current_score_away: 24 },
];

const renderBoard = (props = {}) =>
  render(
    <RetroScoreboard
      matchup={matchup()}
      leagueName="Northwoods League"
      rows={rows}
      games={games}
      activePlay={null}
      homeProb={0.36}
      {...props}
    />
  );

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
    matchup: matchup({ status: 'final', home: { ...matchup().home, expectedFinal: null, playersRemaining: 0 } }),
    homeProb: null,
  });

  const board = within(screen.getByTestId('led-board'));
  expect(board.getByTestId('led-home-ef')).toHaveTextContent('-');
  expect(board.getByTestId('led-home-pmr')).toHaveTextContent('0');
  expect(board.getByTestId('led-win-home')).toHaveTextContent('-');
  expect(board.getByTestId('led-win-away')).toHaveTextContent('-');
  expect(board.getByText('FINAL')).toBeInTheDocument();
  // ADR 0030: an unknown status shows blank, never a guessed "NOT STARTED".
  expect(board.queryByText('NOT STARTED')).not.toBeInTheDocument();
});

// --- Field -------------------------------------------------------------------

test('the field places the two sprites by the home probability: a higher probability moves the home sprite further right', () => {
  const { rerender } = renderBoard({ homeProb: 0.2 });
  const homeLow = spriteX(screen.getByTestId('sprite-home'));
  const awayLow = spriteX(screen.getByTestId('sprite-away'));

  rerender(
    <RetroScoreboard matchup={matchup()} leagueName="Northwoods League" rows={rows} games={games} activePlay={null} homeProb={0.8} />
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

test('the field caption carries the sentence and, on its right, whatever the page slots in as the tail', () => {
  const { rerender } = renderBoard();
  const caption = screen.getByTestId('field-caption');
  expect(caption).toHaveTextContent('Sprites move with win probability. Plays flash on the field as they land.');
  expect(within(caption).queryByRole('button')).not.toBeInTheDocument();

  rerender(
    <RetroScoreboard
      matchup={matchup()}
      leagueName="Northwoods League"
      rows={rows}
      games={games}
      activePlay={null}
      homeProb={0.36}
      fieldTail={<button type="button">Celebrations on</button>}
    />
  );
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
    <RetroScoreboard
      matchup={matchup()}
      leagueName="Northwoods League"
      rows={rows}
      games={games}
      activePlay={{ side: 'home', type: 'rushing', isTouchdown: true, nflTeam: 'KC', opponent: 'BUF' }}
      homeProb={0.36}
    />
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
  // resolve (see RetroField.test.jsx); what this guards is that the reduced
  // path keeps the callout in the DOM and announced.
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

test('the Lineups card shows an empty line until the paired rows arrive', () => {
  renderBoard({ rows: [] });
  const card = within(screen.getByTestId('lineups-card'));
  expect(card.queryAllByTestId('slot-row')).toHaveLength(0);
  expect(card.getByText('No starters to show yet.')).toBeInTheDocument();
});

test('the Lineups card offers a Full comparison action only when the page gives it one', async () => {
  const onFullComparison = jest.fn();
  const { rerender } = renderBoard();
  expect(screen.queryByRole('button', { name: 'Full comparison' })).not.toBeInTheDocument();

  rerender(
    <RetroScoreboard
      matchup={matchup()}
      leagueName="Northwoods League"
      rows={rows}
      games={games}
      activePlay={null}
      homeProb={0.36}
      onFullComparison={onFullComparison}
    />
  );
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
  render(<RetroScoreboard matchup={null} rows={rows} games={games} homeProb={0.5} />);
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
