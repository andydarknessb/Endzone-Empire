import React from 'react';
import { render, screen, within } from '@testing-library/react';
import NflGameStrip from './NflGameStrip';
// The model through the slice's public surface, so the export a page test
// would use is the one exercised here.
import { gameTileView } from '..';

// The strip is a pure render of live_game_states rows handed in by the page
// (#885, #901): no hook, no Supabase client, nothing mocked. Red-tell: the
// strip reading realtime itself would need the client mocked here, and it is
// not. It links nowhere, so no router wraps it.

const liveRow = (overrides = {}) => ({
  tank01_game_id: '20260920_GB@TB',
  game_status: 'in_progress',
  quarter: 'Q3',
  time_remaining: '6:42',
  home_team: 'TB',
  away_team: 'GB',
  current_score_home: 20,
  current_score_away: 17,
  ...overrides,
});

const KICKOFF_ISO = '2026-09-20T23:20:00Z';

// A scheduled row as the table stores it: the scores are the column's
// NOT NULL DEFAULT 0, not a result, and the kickoff rides `start_time`.
const scheduledRow = (overrides = {}) => ({
  tank01_game_id: '20260920_CIN@NYJ',
  game_status: 'scheduled',
  quarter: null,
  time_remaining: null,
  home_team: 'NYJ',
  away_team: 'CIN',
  current_score_home: 0,
  current_score_away: 0,
  start_time: KICKOFF_ISO,
  ...overrides,
});

const finalRow = (overrides = {}) => ({
  tank01_game_id: '20260920_DEN@KC',
  game_status: 'final',
  quarter: 'Final',
  time_remaining: null,
  home_team: 'KC',
  away_team: 'DEN',
  current_score_home: 24,
  current_score_away: 20,
  ...overrides,
});

// The kickoff as the viewer's own zone prints it, computed here without the
// widget's formatter so a formatter regression (a dropped minute, a zone the
// viewer is not in) goes red rather than being mirrored.
const expectedKickoff = (iso) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

// The pattern a score label takes ("GB 17", "TB 20"): a code with a number
// beside it. Both orders are matched on purpose so a scheduled tile that
// leaked a score in EITHER shape (the kit's "TB 20" or the legacy "20 TB")
// would be caught; a scheduled tile must contain none.
const SCORE_LABEL = /^(\d+ [A-Z]+|[A-Z]+ \d+)$/;

test('renders nothing for an empty array, and for no list at all', () => {
  const { container, rerender } = render(<NflGameStrip games={[]} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<NflGameStrip games={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<NflGameStrip />);
  expect(container).toBeEmptyDOMElement();
});

test('renders one tile per row, in the order the rows arrive', () => {
  render(<NflGameStrip games={[liveRow(), scheduledRow(), finalRow()]} />);
  const list = screen.getByRole('list', { name: 'NFL games' });
  const tiles = within(list).getAllByRole('listitem');
  expect(tiles).toHaveLength(3);
  expect(tiles[0]).toHaveAttribute('data-state', 'live');
  expect(tiles[1]).toHaveAttribute('data-state', 'scheduled');
  expect(tiles[2]).toHaveAttribute('data-state', 'final');
});

test('an in-progress game shows the live dot, both scores and the clock', () => {
  render(<NflGameStrip games={[liveRow()]} />);
  const tile = screen.getByRole('listitem');

  expect(within(tile).getByTestId('nfl-game-live-dot')).toBeInTheDocument();
  expect(within(tile).queryByTestId('nfl-game-clock-icon')).toBeNull();
  // "AWAY score - HOME score": each code leads its own score (the canvas's
  // nflStrip shape, not the legacy "20 TB"), a hyphen between them (house
  // style, never an en dash), the away side first.
  expect(within(tile).getByText('GB 17')).toBeInTheDocument();
  expect(within(tile).getByText('-')).toBeInTheDocument();
  expect(within(tile).getByText('TB 20')).toBeInTheDocument();
  expect(within(tile).queryByText('20 TB')).toBeNull();
  expect(within(tile).getAllByText(SCORE_LABEL).map((n) => n.textContent)).toEqual(['GB 17', 'TB 20']);
  expect(within(tile).getByText('Q3 6:42')).toBeInTheDocument();
  expect(within(tile).queryByText('FINAL')).toBeNull();
});

// The canvas (build.mjs nflStrip(), and the Scoreboard view's Games tile)
// prints the team code then its score on BOTH sides. Bound on the model
// through the slice's index, so mirroring the home side back to the legacy
// LiveGameStatus form ("20 TB") turns this case red, not only the DOM ones.
test('gameTileView prints code then score on both sides, away first, as the canvas does', () => {
  expect(gameTileView(liveRow())).toMatchObject({
    state: 'live',
    awayLabel: 'GB 17',
    separator: '-',
    homeLabel: 'TB 20',
    trailing: 'Q3 6:42',
  });
  expect(gameTileView(finalRow())).toMatchObject({
    state: 'final',
    awayLabel: 'DEN 20',
    separator: '-',
    homeLabel: 'KC 24',
    trailing: 'FINAL',
  });
  expect(gameTileView(scheduledRow())).toMatchObject({
    state: 'scheduled',
    awayLabel: 'CIN',
    separator: '@',
    homeLabel: 'NYJ',
  });
});

test('a live tile announces Live so the dot is never the only signal', () => {
  render(<NflGameStrip games={[liveRow()]} />);
  const tile = screen.getByRole('listitem');
  expect(within(tile).getByText('Live')).toBeInTheDocument();
  expect(within(tile).getByTestId('nfl-game-live-dot')).toHaveAttribute('aria-hidden', 'true');
});

test('an in-progress game with no clock yet reads LIVE', () => {
  render(<NflGameStrip games={[liveRow({ quarter: null, time_remaining: null })]} />);
  const tile = screen.getByRole('listitem');
  expect(within(tile).getByTestId('nfl-game-live-dot')).toBeInTheDocument();
  expect(within(tile).getByText('GB 17')).toBeInTheDocument();
  expect(within(tile).getByText('LIVE')).toBeInTheDocument();
});

// The ticket's red-tell: rendering scores on a scheduled tile turns THIS case
// red (the exact-text lookups below would then see "CIN 0" and "0 NYJ", and
// the score-label scan would find them) and no other case.
test('a scheduled game shows the clock icon, the kickoff time and no scores', () => {
  render(<NflGameStrip games={[scheduledRow()]} />);
  const tile = screen.getByRole('listitem');

  expect(within(tile).getByTestId('nfl-game-clock-icon')).toBeInTheDocument();
  expect(within(tile).queryByTestId('nfl-game-live-dot')).toBeNull();
  expect(within(tile).getByText('Scheduled')).toBeInTheDocument();
  // "AWAY @ HOME": the bare codes, an at sign between them, nothing numeric
  // beside either code.
  expect(within(tile).getByText('CIN')).toBeInTheDocument();
  expect(within(tile).getByText('@')).toBeInTheDocument();
  expect(within(tile).getByText('NYJ')).toBeInTheDocument();
  expect(within(tile).queryByText('-')).toBeNull();
  expect(within(tile).queryByText(SCORE_LABEL)).toBeNull();
  // The kickoff, as a clock time in the viewer's zone.
  const kickoff = within(tile).getByTestId('nfl-game-trailing');
  expect(kickoff).toHaveTextContent(expectedKickoff(KICKOFF_ISO));
  expect(kickoff).toHaveTextContent(/\d{1,2}:\d{2}/);
});

// Deliberately NOT bound to the scores mutation above (the codes are matched
// loosely here), so the red-tell case is the one case that mutation turns red.
test('a scheduled game with no known kickoff shows no kickoff time', () => {
  render(<NflGameStrip games={[scheduledRow({ start_time: null })]} />);
  const tile = screen.getByRole('listitem');
  expect(within(tile).getByTestId('nfl-game-clock-icon')).toBeInTheDocument();
  expect(within(tile).getByText(/CIN/)).toBeInTheDocument();
  expect(within(tile).getByText(/NYJ/)).toBeInTheDocument();
  expect(within(tile).queryByTestId('nfl-game-trailing')).toBeNull();
});

test('a scheduled row prefers kickoff_at over the table start_time when both are present', () => {
  const later = '2026-09-21T00:15:00Z';
  render(<NflGameStrip games={[scheduledRow({ kickoff_at: later, start_time: KICKOFF_ISO })]} />);
  expect(screen.getByTestId('nfl-game-trailing')).toHaveTextContent(expectedKickoff(later));
});

test('a final game shows FINAL and the final score, with no dot and no clock icon', () => {
  render(<NflGameStrip games={[finalRow()]} />);
  const tile = screen.getByRole('listitem');

  expect(within(tile).queryByTestId('nfl-game-live-dot')).toBeNull();
  expect(within(tile).queryByTestId('nfl-game-clock-icon')).toBeNull();
  expect(within(tile).getByText('DEN 20')).toBeInTheDocument();
  expect(within(tile).getByText('-')).toBeInTheDocument();
  expect(within(tile).getByText('KC 24')).toBeInTheDocument();
  expect(within(tile).getByText('FINAL')).toBeInTheDocument();
  expect(within(tile).queryByText('Live')).toBeNull();
});

test('the strip is a labelled list a keyboard can reach to scroll', () => {
  render(<NflGameStrip games={[liveRow(), scheduledRow()]} />);
  const list = screen.getByRole('list', { name: 'NFL games' });
  expect(list).toHaveAttribute('tabindex', '0');
});

test('the rendered copy carries no em dash', () => {
  const { container } = render(<NflGameStrip games={[liveRow(), scheduledRow(), finalRow()]} />);
  // U+2014 as an escape, so this file never carries the character itself.
  expect(container).not.toHaveTextContent('\u2014');
});
