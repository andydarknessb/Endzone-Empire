import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { matchupFromListRow } from '../../../entities/matchup';
import { MatchupGrid, recordsFromStandings } from '../index';
import { formatKickoff } from '../model/matchupCardView';

// Fixtures are built through the entity's own list-row builder, so a test
// proves the widget reads the one Matchup shape and never a wire column.
// Scores are strings, as pg returns DECIMAL columns.
const KICKOFF = '2026-09-14T00:20:00Z';

function row(overrides = {}) {
  return matchupFromListRow({
    id: 1,
    season: 2026,
    week: 3,
    final: false,
    status: 'live',
    first_kickoff_at: null,
    synced_at: null,
    home_team_id: 1,
    home_team_name: 'Bemidji Blizzard',
    home_score: '92.1',
    home_expected_final: 118,
    home_players_remaining: 2,
    away_team_id: 2,
    away_team_name: 'Mankato Mavericks',
    away_score: '88.7',
    away_expected_final: 119.4,
    away_players_remaining: 3,
    ...overrides,
  });
}

const LIVE = row();
const SCHEDULED = row({
  id: 2,
  status: 'scheduled',
  first_kickoff_at: KICKOFF,
  home_team_id: 3,
  home_team_name: 'Hibbing Hawks',
  home_score: '0',
  home_expected_final: 108.3,
  home_players_remaining: 9,
  away_team_id: 4,
  away_team_name: 'Brainerd Bruisers',
  away_score: '0',
  away_expected_final: 111.9,
  away_players_remaining: 9,
});
const PLAYED = row({
  id: 3,
  status: 'played',
  home_team_id: 5,
  home_team_name: 'Winona Wolfpack',
  home_score: '101.3',
  home_expected_final: null,
  home_players_remaining: 0,
  away_team_id: 6,
  away_team_name: 'Moorhead Monarchs',
  away_score: '97.6',
  away_expected_final: null,
  away_players_remaining: 0,
});
const FINAL = row({
  id: 4,
  status: 'final',
  final: true,
  home_team_id: 7,
  home_team_name: 'Rochester Rail Kings',
  home_score: '80',
  home_expected_final: null,
  home_players_remaining: 0,
  away_team_id: 8,
  away_team_name: 'St. Cloud Sentinels',
  away_score: '90',
  away_expected_final: null,
  away_players_remaining: 0,
});

function renderGrid(props) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupGrid leagueId={7} {...props} />
    </MemoryRouter>
  );
}

function card(id) {
  return screen
    .getAllByTestId('matchup-card')
    .find((el) => el.getAttribute('data-matchup-id') === String(id));
}

let matchMediaMatches;
beforeEach(() => {
  matchMediaMatches = () => false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches(query),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(() => {
  delete window.matchMedia;
});

test('a live card shows both scores and a bar with the two percentages', () => {
  renderGrid({ matchups: [LIVE] });
  const c = card(1);
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  expect(within(home).getByText('Bemidji Blizzard')).toBeInTheDocument();
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('92.1');
  expect(within(away).getByText('Mankato Mavericks')).toBeInTheDocument();
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('88.7');
  // Expected final and Players remaining ride the note line while live.
  expect(within(home).getByTestId('matchup-side-note')).toHaveTextContent('EF 118.0 · PMR 2');
  expect(within(away).getByTestId('matchup-side-note')).toHaveTextContent('EF 119.4 · PMR 3');
  // The bar, named with both sides and their shares, 5px on a card.
  const bar = within(c).getByRole('img', {
    name: 'Win probability: Bemidji Blizzard 49%, Mankato Mavericks 51%',
  });
  expect(bar).toBeInTheDocument();
  expect(within(c).getByTestId('split-bar-home').style.width).toBe('49%');
  expect(within(c).getByTestId('split-bar-away').style.width).toBe('51%');
  expect(within(c).queryByTestId('matchup-hairline')).toBeNull();
  // The footer carries the same two percentages; the header carries the week.
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent('Win probability 49% · 51%');
  expect(within(c).getByTestId('matchup-card-note')).toHaveTextContent('Week 3');
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('LIVE');
  expect(within(c).getByTestId('matchup-status')).toHaveAttribute('data-variant', 'live');
  // Live: no check mark on anyone yet.
  expect(within(c).queryByRole('img', { name: 'Leading' })).toBeNull();
});

// Red-tell: rendering the score on a scheduled card turns THIS case red and no
// other (the live and played cases above and below assert their scores present).
test('a scheduled card shows projected totals, no bar and its kickoff line', () => {
  renderGrid({ matchups: [SCHEDULED] });
  const c = card(2);
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  // The big number is each side's projected total in the faint tier, not the
  // (zero) score.
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('108.3');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('111.9');
  expect(within(c).queryByText('0.0')).toBeNull();
  expect(within(c).queryByText('0')).toBeNull();
  // No bar: a hairline sits between the rows instead.
  expect(within(c).queryByRole('img', { name: /Win probability/ })).toBeNull();
  expect(within(c).queryByTestId('split-bar')).toBeNull();
  expect(within(c).getByTestId('matchup-hairline')).toBeInTheDocument();
  // The kickoff line reads from firstKickoffAt in the viewer's zone, and the
  // footer says what the numbers are.
  expect(within(c).getByTestId('matchup-card-note')).toHaveTextContent(
    `Kicks off ${formatKickoff(KICKOFF)}`
  );
  expect(within(c).getByTestId('matchup-card-note')).toHaveTextContent(/^Kicks off /);
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent(
    'Projected totals shown until kickoff'
  );
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('Scheduled');
  expect(within(c).getByTestId('matchup-status')).toHaveAttribute('data-variant', 'neutral');
});

test('a scheduled card with no kickoff instant falls back to its week line', () => {
  renderGrid({ matchups: [{ ...SCHEDULED, firstKickoffAt: null }] });
  expect(within(card(2)).getByTestId('matchup-card-note')).toHaveTextContent('Week 3');
  expect(within(card(2)).getByTestId('matchup-card-note')).not.toHaveTextContent('Kicks off');
});

test('a played card shows the check mark on the leader and the awaiting line', () => {
  renderGrid({ matchups: [PLAYED] });
  const c = card(3);
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('101.3');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('97.6');
  // The check mark rides the leader only.
  expect(within(home).getByRole('img', { name: 'Leading' })).toBeInTheDocument();
  expect(within(away).queryByRole('img', { name: 'Leading' })).toBeNull();
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent(
    'Waiting on the score of record'
  );
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('Awaiting final');
  // A settled game shows no forecast on its note line.
  expect(within(home).queryByTestId('matchup-side-note')).toBeNull();
  // The bar still splits the two sides.
  expect(within(c).getByRole('img', { name: /^Win probability: Winona Wolfpack/ })).toBeInTheDocument();
});

test('a final card checks the winner, wherever they sit, and reads the score of record', () => {
  renderGrid({ matchups: [FINAL] });
  const c = card(4);
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  // The away side won this one: the check is on the away row, not the home row.
  expect(within(away).getByRole('img', { name: 'Leading' })).toBeInTheDocument();
  expect(within(home).queryByRole('img', { name: 'Leading' })).toBeNull();
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('80.0');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('90.0');
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('Final');
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent('Score of record');
  expect(within(c).getByTestId('matchup-card-footer')).not.toHaveTextContent('Win probability');
});

test('each card is a link to /league/:id/matchups/:matchupId', () => {
  renderGrid({ matchups: [LIVE, SCHEDULED, PLAYED, FINAL] });
  const links = screen.getAllByRole('link');
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/league/7/matchups/1',
    '/league/7/matchups/2',
    '/league/7/matchups/3',
    '/league/7/matchups/4',
  ]);
  // The card itself is the link (one hit target), listed for navigation.
  expect(card(1).tagName).toBe('A');
  expect(screen.getByRole('list')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('each side prints its record from the lookup, in any of its shapes', () => {
  const { unmount } = renderGrid({ matchups: [LIVE], records: { 1: '2-0', 2: '1-1' } });
  expect(within(card(1)).getByTestId('matchup-side-home')).toHaveTextContent('2-0 · EF 118.0 · PMR 2');
  expect(within(card(1)).getByTestId('matchup-side-away')).toHaveTextContent('1-1 · EF 119.4 · PMR 3');
  unmount();

  const fromStandings = recordsFromStandings([
    { teamId: 5, wins: 2, losses: 0, ties: 0 },
    { teamId: 6, wins: 1, losses: 1, ties: 1 },
  ]);
  const { unmount: unmountSecond } = renderGrid({ matchups: [PLAYED], records: fromStandings });
  // A settled card shows the record alone on its note line.
  expect(within(card(3)).getByTestId('matchup-side-home')).toHaveTextContent('2-0');
  expect(within(card(3)).getByTestId('matchup-side-away')).toHaveTextContent('1-1-1');
  unmountSecond();

  renderGrid({ matchups: [LIVE], records: (teamId) => (teamId === 1 ? '3-0' : null) });
  expect(within(card(1)).getByTestId('matchup-side-home')).toHaveTextContent('3-0 · EF 118.0');
  expect(within(card(1)).getByTestId('matchup-side-away')).toHaveTextContent('EF 119.4 · PMR 3');
  expect(within(card(1)).getByTestId('matchup-side-away')).not.toHaveTextContent('null');
});

test('an unknown status renders no chip, no bar and no footer sentence', () => {
  renderGrid({ matchups: [{ ...LIVE, status: null }] });
  const c = card(1);
  expect(within(c).queryByTestId('matchup-status')).toBeNull();
  expect(within(c).queryByRole('img', { name: /Win probability/ })).toBeNull();
  expect(within(c).getByTestId('matchup-hairline')).toBeInTheDocument();
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent('');
  expect(within(c).getByTestId('matchup-card-note')).toHaveTextContent('Week 3');
});

test('an empty list renders nothing', () => {
  const { container } = renderGrid({ matchups: [] });
  expect(screen.queryByTestId('matchup-grid')).toBeNull();
  expect(container).toBeEmptyDOMElement();
});

describe('below the sm breakpoint', () => {
  beforeEach(() => {
    matchMediaMatches = (query) => /max-width/.test(query);
  });

  test('the same data renders as compact rows', () => {
    renderGrid({ matchups: [LIVE, SCHEDULED, PLAYED], records: { 1: '2-0', 2: '1-1' } });
    expect(screen.getByTestId('matchup-grid')).toHaveAttribute('data-layout', 'rows');

    const live = card(1);
    expect(live).toHaveAttribute('data-layout', 'row');
    const liveHome = within(live).getByTestId('matchup-side-home');
    const liveAway = within(live).getByTestId('matchup-side-away');
    expect(within(liveHome).getByText('Bemidji Blizzard')).toBeInTheDocument();
    expect(within(liveHome).getByTestId('matchup-figure')).toHaveTextContent('92.1');
    expect(within(liveHome).getByTestId('matchup-side-note')).toHaveTextContent('2-0 · EF 118.0 · PMR 2');
    expect(within(liveAway).getByTestId('matchup-figure')).toHaveTextContent('88.7');
    expect(within(live).getByRole('img', { name: 'Win probability: Bemidji Blizzard 49%, Mankato Mavericks 51%' })).toBeInTheDocument();
    expect(within(live).getByTestId('matchup-card-note')).toHaveTextContent('Week 3');
    expect(within(live).getByTestId('matchup-status')).toHaveTextContent('LIVE');

    // Scheduled: the projection rides the note line, the score column is empty.
    const scheduled = card(2);
    const schedHome = within(scheduled).getByTestId('matchup-side-home');
    expect(within(schedHome).getByTestId('matchup-side-note')).toHaveTextContent('Proj 108.3');
    expect(within(schedHome).queryByTestId('matchup-figure')).toBeNull();
    expect(within(scheduled).queryByText('0.0')).toBeNull();
    expect(within(scheduled).queryByTestId('split-bar')).toBeNull();
    expect(within(scheduled).getByTestId('matchup-hairline')).toBeInTheDocument();
    expect(within(scheduled).getByTestId('matchup-card-note')).toHaveTextContent(/^Kicks off /);

    // Played: the leader's check mark, no forecast on the note line.
    const played = card(3);
    expect(within(within(played).getByTestId('matchup-side-home')).getByRole('img', { name: 'Leading' })).toBeInTheDocument();
    expect(within(within(played).getByTestId('matchup-side-away')).queryByRole('img', { name: 'Leading' })).toBeNull();

    // Every row is still a link to its matchup.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/league/7/matchups/1',
      '/league/7/matchups/2',
      '/league/7/matchups/3',
    ]);
  });
});
