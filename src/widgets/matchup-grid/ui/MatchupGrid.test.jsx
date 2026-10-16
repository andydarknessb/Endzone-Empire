import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { matchupFromListRow } from '../../../entities/matchup';
import { MatchupGrid } from '../index';
import MatchupHero from '../../matchup-hero';
import { formatKickoff } from '../../../shared/lib';
import { recordsByTeamId } from '../../../entities/standings';
import { invalidate, setResource } from '../../../lib/resourceCache';

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

const frame = () => screen.getByRole('region', { name: 'League matchups' });

test('the frame is a tertiary frame with an h2, the count, the credit and no tile chips', () => {
  renderGrid({ matchups: [LIVE, PLAYED], more: 2 });
  expect(screen.getByRole('heading', { level: 2, name: 'League matchups' })).toBeInTheDocument();
  expect(screen.getByTestId('game-center-grid-count')).toHaveTextContent('2 more');
  expect(frame()).toHaveTextContent(/win probability · Endzone Forecast/);
  expect(frame()).not.toHaveTextContent('Projected totals shown until kickoff');
  // Live tiles carry no Live chip and no week label: Board black says live.
  expect(within(card(1)).queryByText('Live')).toBeNull();
  expect(within(card(1)).queryByTestId('matchup-status')).toBeNull();
  expect(card(1)).not.toHaveTextContent('Week 3');
});

test('a live card is Board black: both scores, Exp final and players remaining on separate lines, a two-sided bar', () => {
  renderGrid({ matchups: [LIVE] });
  const c = card(1);
  expect(c).toHaveAttribute('data-state', 'live');
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  expect(within(home).getByText(/Bemidji Blizzard/)).toBeInTheDocument();
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('92.1');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('88.7');
  expect(within(home).getByTestId('matchup-side-expected')).toHaveTextContent('Exp final 118.0');
  expect(within(home).getByTestId('matchup-side-remaining')).toHaveTextContent('2 players remaining');
  expect(within(away).getByTestId('matchup-side-remaining')).toHaveTextContent('3 players remaining');
  // One accessible name carries both teams and both percentages; the ends print them too.
  expect(within(c).getByRole('img', { name: 'Bemidji Blizzard 49%, Mankato Mavericks 51% win probability' })).toBeInTheDocument();
  expect(c).toHaveTextContent('Bemidji Blizzard 49%');
  expect(c).toHaveTextContent('Mankato Mavericks 51%');
  expect(within(c).queryByTestId('leader-check')).toBeNull();
});

// Label in name: the tile carries no aria-label, so its accessible name is its visible content plus the one
// label of the two-sided bar. What a screen reader hears is what the eye reads.
test('the tile link is named by its content: both sides, Exp final, players remaining and the bar', () => {
  renderGrid({ matchups: [LIVE, SCHEDULED] });
  expect(card(1)).not.toHaveAttribute('aria-label');
  const name = (el) => el.textContent;
  expect(card(1)).toHaveAccessibleName(/Bemidji Blizzard/);
  expect(card(1)).toHaveAccessibleName(/Score 92.1/);
  expect(card(1)).toHaveAccessibleName(/Exp final 118.0/);
  expect(card(1)).toHaveAccessibleName(/2 players remaining/);
  expect(card(1)).toHaveAccessibleName(/Mankato Mavericks/);
  expect(card(1)).toHaveAccessibleName(/Exp final 119.4/);
  expect(card(1)).toHaveAccessibleName(/3 players remaining/);
  expect(card(1)).toHaveAccessibleName(/Bemidji Blizzard 49%, Mankato Mavericks 51% win probability/);
  expect(card(1)).toHaveAccessibleName(/Details/);
  // Every visible word of the tile is in its name (the percentages at the bar's ends are the bar's own label).
  expect(name(card(1))).toContain('Exp final 118.0');
  expect(screen.getByRole('link', { name: /Hibbing Hawks 9 starters set to play Projected 108.3 Brainerd Bruisers 9 starters set to play Projected 111.9/ })).toBe(card(2));
});

// Red-tell: rendering the score on a scheduled card turns THIS case red and no other.
test('a scheduled card is framed with Proj figures, starters set to play, no chip, and the frame head says it once', () => {
  renderGrid({ matchups: [SCHEDULED] });
  const c = card(2);
  expect(c).toHaveAttribute('data-state', 'scheduled');
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('108.3');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('111.9');
  expect(c).toHaveTextContent('Proj');
  expect(within(c).queryByText('0.0')).toBeNull();
  expect(within(home).getByTestId('matchup-side-remaining')).toHaveTextContent('9 starters set to play');
  expect(within(home).queryByTestId('matchup-side-expected')).toBeNull();
  // No per-tile chip and no "Kicks off" line.
  expect(within(c).queryByTestId('matchup-status')).toBeNull();
  expect(c).not.toHaveTextContent(/Scheduled|Kicks off/);
  // RULINGS Critique 10 item 13: the head says it once, with the earliest kickoff.
  expect(screen.getAllByText(/projected totals/)).toHaveLength(1);
  expect(frame()).toHaveTextContent(`All games kick off ${formatKickoff(KICKOFF)} · projected totals`);
  // The bar is the projections-only split.
  expect(within(c).getByRole('img', { name: /^Hibbing Hawks \d+%, Brainerd Bruisers \d+% win probability$/ })).toBeInTheDocument();
});

test('the head names the earliest kickoff of the scheduled games, and reads differently once some have started', () => {
  const earlier = row({
    id: 20, status: 'scheduled', first_kickoff_at: '2026-09-13T17:00:00Z', home_team_id: 21, home_team_name: 'Early A', away_team_id: 22, away_team_name: 'Early B', home_score: '0', away_score: '0', home_expected_final: 100, away_expected_final: 100,
  });
  const { unmount } = renderGrid({ matchups: [SCHEDULED, earlier] });
  expect(frame()).toHaveTextContent(`All games kick off ${formatKickoff('2026-09-13T17:00:00Z')} · projected totals`);
  unmount();
  renderGrid({ matchups: [LIVE, SCHEDULED] });
  expect(frame()).toHaveTextContent('Projected totals shown until kickoff');
  expect(frame()).not.toHaveTextContent('All games kick off');
});

test('a live card with a null Expected final draws no bar', () => {
  renderGrid({ matchups: [row({ home_expected_final: null })] });
  expect(within(card(1)).queryByRole('img', { name: /win probability/ })).toBeNull();
});

test('a played card says Awaiting final and waits on the score of record, with no forecast lines', () => {
  renderGrid({ matchups: [PLAYED] });
  const c = card(3);
  const home = within(c).getByTestId('matchup-side-home');
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('101.3');
  expect(within(within(c).getByTestId('matchup-side-away')).getByTestId('matchup-figure')).toHaveTextContent('97.6');
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('Awaiting final');
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent('Waiting on the score of record');
  expect(within(home).queryByTestId('matchup-side-expected')).toBeNull();
  expect(within(home).queryByTestId('matchup-side-remaining')).toBeNull();
  expect(within(c).queryByRole('img', { name: /win probability/ })).toBeNull();
});

test('a final card marks the winner wherever they sit, with no bar and no 100/0', () => {
  renderGrid({ matchups: [FINAL] });
  const c = card(4);
  const home = within(c).getByTestId('matchup-side-home');
  const away = within(c).getByTestId('matchup-side-away');
  expect(within(away).getByRole('img', { name: 'Winner' })).toBeInTheDocument();
  expect(within(home).queryByRole('img', { name: 'Winner' })).toBeNull();
  expect(within(home).getByTestId('matchup-figure')).toHaveTextContent('80.0');
  expect(within(away).getByTestId('matchup-figure')).toHaveTextContent('90.0');
  expect(within(c).getByTestId('matchup-status')).toHaveTextContent('Final');
  expect(within(c).getByTestId('matchup-card-footer')).toHaveTextContent('Score of record');
  expect(within(c).queryByRole('img', { name: /win probability/ })).toBeNull();
  expect(c).not.toHaveTextContent(/100%|0%/);
});

test('each card is a link to /league/:id/matchups/:matchupId', () => {
  renderGrid({ matchups: [LIVE, SCHEDULED, PLAYED, FINAL] });
  expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
    '/league/7/matchups/1',
    '/league/7/matchups/2',
    '/league/7/matchups/3',
    '/league/7/matchups/4',
  ]);
  expect(card(1).tagName).toBe('A');
  expect(screen.getByRole('list')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('each side prints its record from the lookup, in any of its shapes', () => {
  const { unmount } = renderGrid({ matchups: [LIVE], records: { 1: '2-0', 2: '1-1' } });
  expect(within(card(1)).getByTestId('matchup-side-home')).toHaveTextContent('Bemidji Blizzard 2-0');
  expect(within(card(1)).getByTestId('matchup-side-away')).toHaveTextContent('Mankato Mavericks 1-1');
  unmount();

  const fromStandings = recordsByTeamId([
    { teamId: 5, wins: 2, losses: 0, ties: 0 },
    { teamId: 6, wins: 1, losses: 1, ties: 1 },
  ]);
  const { unmount: unmountSecond } = renderGrid({ matchups: [PLAYED], records: fromStandings });
  expect(within(card(3)).getByTestId('matchup-side-home')).toHaveTextContent('Winona Wolfpack 2-0');
  expect(within(card(3)).getByTestId('matchup-side-away')).toHaveTextContent('Moorhead Monarchs 1-1-1');
  unmountSecond();

  renderGrid({ matchups: [LIVE], records: (teamId) => (teamId === 1 ? '3-0' : null) });
  expect(within(card(1)).getByTestId('matchup-side-home')).toHaveTextContent('Bemidji Blizzard 3-0');
  expect(within(card(1)).getByTestId('matchup-side-away')).not.toHaveTextContent('null');
});

test('an unknown status asserts neither a chip nor a probability, and shows the stored scores', () => {
  renderGrid({ matchups: [{ ...LIVE, status: null }] });
  const c = card(1);
  expect(c).toHaveAttribute('data-state', 'unknown');
  expect(within(c).queryByTestId('matchup-status')).toBeNull();
  expect(within(c).queryByRole('img', { name: /win probability/ })).toBeNull();
  expect(within(within(c).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('92.1');
});

test('an empty list renders nothing without an empty line, and the line in a frame with one', () => {
  const { container, unmount } = renderGrid({ matchups: [] });
  expect(container).toBeEmptyDOMElement();
  unmount();
  renderGrid({ matchups: [], empty: 'No other league matchups this week.' });
  expect(screen.getByTestId('game-center-grid-empty')).toHaveTextContent('No other league matchups this week.');
  expect(screen.getByRole('heading', { level: 2, name: 'League matchups' })).toBeInTheDocument();
});

test('a team prints one players-remaining number in the hero and its tile (AC 6l)', () => {
  // Same model in both places: the hero reads side.playersRemaining, and so does the tile.
  const view = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero matchup={LIVE} viewerTeamId={1} leagueId={7} />
    </MemoryRouter>
  );
  const heroHome = within(view.container).getByTestId('matchup-hero-side-home');
  expect(heroHome).toHaveTextContent('2 players remaining');
  view.unmount();
  renderGrid({ matchups: [LIVE] });
  expect(within(card(1)).getByTestId('matchup-side-home')).toHaveTextContent('2 players remaining');
});

describe('below the sm breakpoint', () => {
  beforeEach(() => {
    matchMediaMatches = (query) => /max-width/.test(query);
  });

  test('the same data renders as ~56px rows with the leader marked by the word Leads', () => {
    renderGrid({ matchups: [LIVE, SCHEDULED, PLAYED], records: { 1: '2-0', 2: '1-1' } });
    expect(screen.getByTestId('matchup-grid')).toHaveAttribute('data-layout', 'rows');

    const live = card(1);
    expect(live).toHaveAttribute('data-layout', 'row');
    const liveHome = within(live).getByTestId('matchup-side-home');
    expect(within(liveHome).getByText('Bemidji Blizzard')).toBeInTheDocument();
    expect(within(liveHome).getByTestId('matchup-figure')).toHaveTextContent('92.1');
    expect(liveHome).toHaveTextContent('Leads');
    expect(within(within(live).getByTestId('matchup-side-away')).getByTestId('matchup-figure')).toHaveTextContent('88.7');
    // The win probability names its team; the whole row's name carries who leads.
    expect(live).toHaveTextContent('51% Mankato Mavericks');
    expect(live).not.toHaveAttribute('aria-label');
    expect(live).toHaveAccessibleName(/Bemidji Blizzard Leads 92[.]1/);
    expect(live).toHaveAccessibleName(/Mankato Mavericks 88[.]7/);
    expect(live).toHaveAccessibleName(/51% Mankato Mavericks/);
    expect(live).toHaveTextContent('Details');

    // Scheduled: the Proj figures, no "Leads".
    const scheduled = card(2);
    expect(within(within(scheduled).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('108.3');
    expect(scheduled).not.toHaveTextContent('Leads');

    // Played: the state word.
    expect(card(3)).toHaveTextContent('Awaiting final');

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/league/7/matchups/1',
      '/league/7/matchups/2',
      '/league/7/matchups/3',
    ]);
  });
});

test('a CPU-managed side (league teams[].is_cpu) carries the CPU label beside its name', () => {
  setResource(['league', 7], {
    league: { id: 7 },
    teams: [{ teamId: 1, teamName: 'Bemidji Blizzard' }, { teamId: 2, teamName: 'Mankato Mavericks', is_cpu: true }],
    viewerTeamId: 1,
  });
  try {
    renderGrid({ matchups: [LIVE] });
    expect(screen.getAllByTestId('cpu-badge')).toHaveLength(1);
    const away = screen.getByTestId('matchup-side-away');
    expect(within(away).getByText('Mankato Mavericks')).toBeInTheDocument();
    expect(within(away).getByTestId('cpu-badge')).toHaveTextContent('CPU');
    expect(within(screen.getByTestId('matchup-side-home')).queryByTestId('cpu-badge')).not.toBeInTheDocument();
  } finally {
    invalidate(['league', 7]);
  }
});
