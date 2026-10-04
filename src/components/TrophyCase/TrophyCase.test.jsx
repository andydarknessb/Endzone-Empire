import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TrophyCase from './TrophyCase';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const trophies = [
  {
    id: 1,
    type: 'weekly_high',
    label: 'Weekly High Score',
    week: 4,
    season: 2026,
    team_id: 10,
    team_name: 'Sunday Ballers',
    data: {},
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 2,
    type: 'champion',
    label: 'League Champion',
    week: null,
    season: 2025,
    team_id: 11,
    team_name: "Alice's Team",
    data: {},
    awarded_at: '2025-12-30T00:00:00.000Z',
  },
  {
    id: 3,
    type: 'closest_game',
    label: 'Closest Game',
    week: 4,
    season: 2026,
    team_id: 12,
    team_name: 'Cardiac Comebacks',
    data: { margin: 0.01 },
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
];

test('renders trophies with team names, defaulting to the current (latest) season', async () => {
  apiClient.get.mockResolvedValue({ data: trophies });

  renderWithProviders(<TrophyCase leagueId={1} />);

  expect(await screen.findByTestId('trophy-case')).toBeInTheDocument();
  // The per-team tally repeats names and labels, so read the award rows by id.
  expect(screen.getByTestId('trophy-1')).toHaveTextContent('Weekly High Score');
  expect(screen.getByTestId('trophy-1')).toHaveTextContent('Sunday Ballers');
  expect(screen.getByTestId('trophy-3')).toHaveTextContent('Closest Game');
  expect(screen.getByTestId('trophy-3')).toHaveTextContent('Cardiac Comebacks');
  // 2025's champion trophy should not show by default since 2026 is the latest season
  expect(screen.queryByText(/League Champion/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('trophy-2')).not.toBeInTheDocument();
});

// This card and RecapCard were the route's two literal h6s (ADR 0021: the
// outline read h1, h6, h2, h2, h6). Asserted here rather than from the page
// test, which mocks this component as a bare div. The shared Card's title is
// the heading (#1986 L19), with the season's award count beside it.
test('renders its heading at level 2 through the shared Card title, with the award count', async () => {
  apiClient.get.mockResolvedValue({ data: trophies });

  renderWithProviders(<TrophyCase leagueId={1} />);

  const card = await screen.findByTestId('trophy-case');
  const heading = screen.getByRole('heading', { level: 2, name: 'Trophy Case' });
  expect(screen.queryByRole('heading', { level: 6 })).not.toBeInTheDocument();
  expect(card).toHaveAttribute('aria-labelledby', heading.id);
  // Two of the three fixture trophies are 2026 awards.
  expect(within(card).getByText('2')).toBeInTheDocument();
  // The Card's own header, not the legacy 16px-padded wrapper.
  expect(card).not.toHaveStyle({ padding: '16px' });
});

// No emoji in product UI: every trophy carries a decorative stroke glyph, and
// a type the client does not know still gets the medal fallback.
test('marks each trophy with a decorative stroke icon, no emoji', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      ...trophies,
      { ...trophies[0], id: 4, type: 'invented_by_the_server', label: 'Mystery Cup' },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  const card = await screen.findByTestId('trophy-case');

  expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design, so no Testing Library query can reach them
  const iconOf = (testId) => screen.getByTestId(testId).querySelector('svg[data-icon]');
  expect(iconOf('trophy-1')).toHaveAttribute('data-icon', 'flame');
  expect(iconOf('trophy-3')).toHaveAttribute('data-icon', 'compress');
  expect(iconOf('trophy-4')).toHaveAttribute('data-icon', 'medal');
  // eslint-disable-next-line testing-library/no-node-access -- same
  card.querySelectorAll('svg[data-icon]').forEach((icon) => {
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

// #1854: the two lineup trophies are weekly, so each reads "team · Week N", and
// each has its own glyph rather than the medal fallback.
test('shows Perfect Lineup and Captain Hindsight as rows with team and week', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { ...trophies[0], id: 5, type: 'perfect_lineup', label: 'Perfect Lineup', week: 6, team_name: 'Sunday Ballers', data: { points: 98 } },
      { ...trophies[0], id: 6, type: 'captain_hindsight', label: 'Captain Hindsight', week: 7, team_name: 'Cardiac Comebacks', data: { margin: 4 } },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  await screen.findByTestId('trophy-case');

  expect(screen.getByTestId('trophy-5')).toHaveTextContent('Perfect Lineup');
  expect(screen.getByTestId('trophy-5')).toHaveTextContent('Sunday Ballers · Week 6');
  expect(screen.getByTestId('trophy-6')).toHaveTextContent('Captain Hindsight');
  expect(screen.getByTestId('trophy-6')).toHaveTextContent('Cardiac Comebacks · Week 7');
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design
  const iconOf = (testId) => screen.getByTestId(testId).querySelector('svg[data-icon]');
  expect(iconOf('trophy-5')).toHaveAttribute('data-icon', 'target');
  expect(iconOf('trophy-6')).toHaveAttribute('data-icon', 'rebound');
});

// #1860: a hit Called shot is a weekly trophy: "team · Week N" and its own glyph.
test('shows Called Shot as a weekly row with team and week', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { ...trophies[0], id: 7, type: 'called_shot', label: 'Called Shot', week: 8, team_name: 'Sunday Ballers', data: { bold: true } },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  await screen.findByTestId('trophy-case');

  expect(screen.getByTestId('trophy-7')).toHaveTextContent('Called Shot');
  expect(screen.getByTestId('trophy-7')).toHaveTextContent('Sunday Ballers · Week 8');
  // eslint-disable-next-line testing-library/no-node-access -- the glyph is aria-hidden by design
  expect(screen.getByTestId('trophy-7').querySelector('svg[data-icon]')).toHaveAttribute('data-icon', 'target');
});

test('renders nothing while loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(<TrophyCase leagueId={1} />);
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('hides itself when there are no trophies', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<TrophyCase leagueId={1} teams={[{ id: 10, name: 'Sunday Ballers', teamId: 10, teamName: 'Sunday Ballers' }]} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
  // An empty league shows no tally of zeros either.
  expect(screen.queryByTestId('trophy-tally')).not.toBeInTheDocument();
});

// #1855, #1986 L17/L18: the per-team leaderboard (stacked above the award rows on a
// phone, beside them from md), for the selected season. Non-zero type counts only, named by type rather than by the
// first award's parameterised label.
describe('per-team tally', () => {
  const t = (id, type, label, teamId, teamName, season = 2026, week = 4) => ({
    id, type, label, week, season, team_id: teamId, team_name: teamName, data: {}, awarded_at: '2026-07-01T00:00:00.000Z',
  });
  const season2026 = [
    t(1, 'weekly_high', 'Weekly High Score', 10, 'Sunday Ballers'),
    t(2, 'weekly_high', 'Weekly High Score', 10, 'Sunday Ballers', 2026, 5),
    t(3, 'closest_game', 'Closest Game', 12, 'Cardiac Comebacks'),
    t(4, 'closest_game', 'Closest Game', 10, 'Sunday Ballers'),
    t(5, 'perfect_lineup', 'Perfect Lineup', 12, 'Cardiac Comebacks'),
    t(6, 'champion', 'League Champion', 11, "Alice's Team", 2025, null),
  ];
  const teams = [
    { id: 10, name: 'Sunday Ballers', teamId: 10, teamName: 'Sunday Ballers', avatar_url: null },
    { id: 11, name: "Alice's Team", teamId: 11, teamName: "Alice's Team", avatar_url: null },
    { id: 12, name: 'Cardiac Comebacks', teamId: 12, teamName: 'Cardiac Comebacks', avatar_url: null },
    { id: 13, name: 'Zero Hour', teamId: 13, teamName: 'Zero Hour', avatar_url: null },
    { id: 14, name: 'Aardvarks', teamId: 14, teamName: 'Aardvarks', avatar_url: null },
  ];
  const rowOrder = () =>
    screen.getAllByTestId(/^tally-team-/).map((row) => row.getAttribute('data-testid'));
  const totalOf = (id) => within(screen.getByTestId(`tally-team-${id}`)).getByTestId('tally-total');
  const breakdownOf = (id) => within(screen.getByTestId(`tally-team-${id}`)).getByTestId('tally-breakdown');

  test('one row per team, ordered by total then name, zero teams included', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    // Sunday Ballers 3, Cardiac Comebacks 2, then the zero teams by name.
    expect(rowOrder()).toEqual([
      'tally-team-10',
      'tally-team-12',
      'tally-team-14',
      'tally-team-11',
      'tally-team-13',
    ]);
    expect(screen.getByTestId('tally-team-10')).toHaveTextContent('Sunday Ballers');
    expect(totalOf(10)).toHaveTextContent('3 trophies');
    expect(breakdownOf(10)).toHaveTextContent('Weekly High ×2 · Closest Game ×1');
    expect(totalOf(12)).toHaveTextContent('2 trophies');
    // The 2025 champion trophy is not a 2026 type.
    expect(screen.getByTestId('trophy-tally')).not.toHaveTextContent('Champion');
  });

  test('prints no zero counts; a team with nothing is "0 trophies" with no breakdown line', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('trophy-tally')).not.toHaveTextContent(/×0|Perfect Lineup 0|Closest Game 0/);
    const zero = screen.getByTestId('tally-team-13');
    expect(zero).toHaveTextContent('Zero Hour');
    expect(totalOf(13)).toHaveTextContent('0 trophies');
    expect(within(zero).queryByTestId('tally-breakdown')).not.toBeInTheDocument();
    // Cardiac Comebacks holds Closest Game and Perfect Lineup but not Weekly High.
    expect(breakdownOf(12)).not.toHaveTextContent('Weekly High');
  });

  test('a single trophy reads "1 trophy"', async () => {
    apiClient.get.mockResolvedValue({ data: [t(1, 'top_scorer', 'Top Scorer', 10, 'Sunday Ballers')] });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(totalOf(10)).toHaveTextContent(/^1 trophy$/);
  });

  // L18: the column used to take the FIRST award's label, so a parameterised
  // label named every other team's count too.
  test('names each type from the fixed map, not the first award label', async () => {
    apiClient.get.mockResolvedValue({
      data: [
        t(1, 'draft_grade', 'Best Draft (A)', 10, 'Sunday Ballers', 2026, 0),
        t(2, 'win_streak', 'Longest Win Streak (7)', 10, 'Sunday Ballers', 2026, 0),
        t(3, 'fewest_left_on_bench', 'Fewest Left on the Bench (31.2)', 12, 'Cardiac Comebacks', 2026, 0),
        t(4, 'champion', '2026 League Champion', 12, 'Cardiac Comebacks', 2026, 0),
        t(5, 'pickem_champion', "2026 Pick'em Champion", 11, "Alice's Team", 2026, 0),
        t(6, 'comeback', 'Biggest Comeback', 11, "Alice's Team", 2026, 0),
        t(7, 'top_scorer', 'Top Scorer', 13, 'Zero Hour', 2026, 3),
        t(8, 'captain_hindsight', 'Captain Hindsight', 13, 'Zero Hour', 2026, 3),
        t(9, 'perfect_lineup', 'Perfect Lineup', 14, 'Aardvarks', 2026, 3),
        t(10, 'called_shot', 'Called Shot', 14, 'Aardvarks', 2026, 3),
        t(11, 'biggest_blowout', 'Biggest Blowout', 14, 'Aardvarks', 2026, 3),
      ],
    });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    // Equal counts sort by name.
    expect(breakdownOf(10)).toHaveTextContent('Best Draft ×1 · Longest Win Streak ×1');
    expect(breakdownOf(12)).toHaveTextContent('Champion ×1 · Fewest Left on the Bench ×1');
    expect(breakdownOf(11)).toHaveTextContent("Biggest Comeback ×1 · Pick'em Champion ×1");
    expect(breakdownOf(13)).toHaveTextContent('Captain Hindsight ×1 · Top Scorer ×1');
    expect(breakdownOf(14)).toHaveTextContent('Biggest Blowout ×1 · Called Shot ×1 · Perfect Lineup ×1');
    const tally = screen.getByTestId('trophy-tally');
    expect(tally).not.toHaveTextContent('(A)');
    expect(tally).not.toHaveTextContent('(7)');
    expect(tally).not.toHaveTextContent('(31.2)');
    // The award ROWS keep the award's own label.
    expect(screen.getByTestId('trophy-1')).toHaveTextContent('Best Draft (A)');
    expect(screen.getByTestId('trophy-2')).toHaveTextContent('Longest Win Streak (7)');
  });

  test('every type reads ×N, most first', async () => {
    apiClient.get.mockResolvedValue({
      data: [
        t(1, 'perfect_lineup', 'Perfect Lineup', 10, 'Sunday Ballers', 2026, 3),
        t(2, 'top_scorer', 'Top Scorer', 10, 'Sunday Ballers', 2026, 1),
        t(3, 'top_scorer', 'Top Scorer', 10, 'Sunday Ballers', 2026, 2),
        t(4, 'top_scorer', 'Top Scorer', 10, 'Sunday Ballers', 2026, 3),
        t(5, 'perfect_lineup', 'Perfect Lineup', 10, 'Sunday Ballers', 2026, 6),
      ],
    });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(breakdownOf(10)).toHaveTextContent(/^Top Scorer ×3 · Perfect Lineup ×2$/);
  });

  // #1874: the row reads the canonical teamId/teamName, not the raw `id`/`name`
  // columns the league-detail route leaks beside them.
  test('a roster row reads teamName, not the raw name column', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(
      <TrophyCase
        leagueId={1}
        teams={[{ id: 10, name: 'Old Name', teamId: 10, teamName: 'Sunday Ballers', avatar_url: null }]}
      />
    );
    await screen.findByTestId('trophy-case');

    const row = screen.getByTestId('tally-team-10');
    expect(row).toHaveTextContent('Sunday Ballers');
    expect(row).not.toHaveTextContent('Old Name');
  });

  // A roster row is a current Team: its teamName renders as it arrives, never
  // the raw `name` column and never a "Former manager" label (teamIdentity.js).
  test('a roster row with a blank teamName is neither the raw name nor Former manager', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(
      <TrophyCase
        leagueId={1}
        teams={[{ id: 13, name: 'Zero Hour', teamId: 13, teamName: '   ', avatar_url: null }]}
      />
    );
    await screen.findByTestId('trophy-case');

    const row = screen.getByTestId('tally-team-13');
    expect(row).not.toHaveTextContent('Former manager');
    expect(row).not.toHaveTextContent('Zero Hour');
  });

  test('a trophy-only row renders the trophy team_name as it arrives', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={[]} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('tally-team-12')).toHaveTextContent('Cardiac Comebacks');
  });

  test('the season select still switches seasons, tally and award rows together, without another request', async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    await user.click(screen.getByRole('combobox', { name: 'Season' }));
    await user.click(await screen.findByRole('option', { name: '2025' }));

    expect(rowOrder()[0]).toBe('tally-team-11');
    expect(breakdownOf(11)).toHaveTextContent('Champion ×1');
    expect(totalOf(11)).toHaveTextContent('1 trophy');
    expect(screen.getByTestId('trophy-tally')).not.toHaveTextContent('Weekly High');
    expect(screen.getByTestId('trophy-6')).toHaveTextContent('League Champion');
    expect(screen.queryByTestId('trophy-1')).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  test('the season select is in the Card header, and only with more than one season', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    const { unmount } = renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    const card = await screen.findByTestId('trophy-case');
    expect(within(card).getByRole('combobox', { name: 'Season' })).toBeInTheDocument();
    unmount();

    apiClient.get.mockResolvedValue({ data: season2026.filter((x) => x.season === 2026) });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');
    expect(screen.queryByRole('combobox', { name: 'Season' })).not.toBeInTheDocument();
  });

  test('a type the client has never heard of falls back to its label without the parenthetical', async () => {
    apiClient.get.mockResolvedValue({
      data: [...season2026, t(7, 'invented_by_the_server', 'Mystery Cup (III)', 13, 'Zero Hour')],
    });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(breakdownOf(13)).toHaveTextContent(/^Mystery Cup ×1$/);
    expect(screen.getByTestId('tally-team-10')).not.toHaveTextContent('Mystery Cup');
    expect(screen.getByTestId('trophy-7')).toHaveTextContent('Mystery Cup (III)');
  });

  test('without a teams list, teams come from the trophies', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(rowOrder()).toEqual(['tally-team-10', 'tally-team-12']);
  });

  test('is a named list with one item per team', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    const list = screen.getByRole('list', { name: 'Trophies by team' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  test('lets a long team name shrink: nothing forces a horizontal scroll', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('trophy-tally')).toHaveStyle({ minWidth: '0' });
    expect(screen.getByTestId('tally-team-10')).toHaveStyle({ minWidth: '0' });
  });

  // The standings truncate names this way; a wrapping name made rows 2 to 3
  // lines tall at 360.
  test('a team name is one ellipsized line, so a long name never pushes the total', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    const name = within(screen.getByTestId('tally-team-10')).getByText('Sunday Ballers');
    expect(name).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' });
    expect(screen.getByTestId('tally-team-10')).toHaveStyle({ display: 'grid' });
  });

  // A count must not wrap away from its type name ("Top Scorer" / "×3"); only
  // the middots break.
  test('each count is bound to its type name with a non-breaking space', async () => {
    apiClient.get.mockResolvedValue({ data: season2026 });
    renderWithProviders(<TrophyCase leagueId={1} teams={teams} />);
    await screen.findByTestId('trophy-case');

    expect(breakdownOf(10).textContent).toBe('Weekly High\u00a0×2 · Closest Game\u00a0×1');
  });
});

// #1986: the tally collapses to its top 5 teams so the card does not grow with
// the league; the one toggle opens it together with the awards.
describe('capped tally', () => {
  const league = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 20 + i, teamId: 20 + i, teamName: `Team ${String(i + 1).padStart(2, '0')}`, name: `Team ${i + 1}`, avatar_url: null }));
  // Team 01 holds a trophy more than team 02, and so on: totals are distinct
  // down to Team 06, so the top 5 are Teams 01 to 05.
  const awardsFor = (teamList, perTeam) =>
    teamList.flatMap((tm, i) =>
      Array.from({ length: Math.max(perTeam - i, 0) }, (_, k) => ({
        id: tm.teamId * 100 + k, type: 'top_scorer', label: 'Top Scorer', week: k + 1, season: 2026,
        team_id: tm.teamId, team_name: tm.teamName, data: {}, awarded_at: '2026-07-01T00:00:00.000Z',
      }))
    );
  const tallyRowCount = () => within(screen.getByTestId('trophy-tally')).getAllByRole('listitem').length;

  test('12 teams show the top 5 collapsed and all 12 expanded', async () => {
    const user = userEvent.setup();
    const twelveTeams = league(12);
    apiClient.get.mockResolvedValue({ data: awardsFor(twelveTeams, 8) });
    renderWithProviders(<TrophyCase leagueId={1} teams={twelveTeams} />);
    await screen.findByTestId('trophy-case');

    expect(tallyRowCount()).toBe(5);
    expect(screen.getByTestId('tally-team-20')).toBeInTheDocument();
    expect(screen.getByTestId('tally-team-24')).toBeInTheDocument();
    expect(screen.queryByTestId('tally-team-25')).not.toBeInTheDocument();
    // 8 + 7 + ... + 1 = 36 awards: both lists are cut.
    const toggle = screen.getByRole('button', { name: 'Show all 12 teams and 36 awards' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute(
      'aria-controls',
      `${screen.getByTestId('trophy-tally').id} ${screen.getByRole('list', { name: 'Awards' }).id}`
    );

    await user.click(toggle);
    expect(tallyRowCount()).toBe(12);
    expect(within(screen.getByRole('list', { name: 'Awards' })).getAllByRole('listitem')).toHaveLength(36);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');

    await user.click(fewer);
    expect(tallyRowCount()).toBe(5);
    expect(within(screen.getByRole('list', { name: 'Awards' })).getAllByRole('listitem')).toHaveLength(6);
  });

  test('the toggle names only the list that is cut', async () => {
    // 12 teams, 4 awards: only the tally is capped.
    const twelveTeams = league(12);
    apiClient.get.mockResolvedValue({ data: awardsFor(twelveTeams, 3).slice(0, 4) });
    const { unmount } = renderWithProviders(<TrophyCase leagueId={1} teams={twelveTeams} />);
    await screen.findByTestId('trophy-case');
    expect(screen.getByRole('button', { name: 'Show all 12 teams' })).toBeInTheDocument();
    unmount();

    // 3 teams, 10 awards: only the awards are capped.
    const threeTeams = league(3);
    apiClient.get.mockResolvedValue({ data: awardsFor(threeTeams, 10) });
    renderWithProviders(<TrophyCase leagueId={1} teams={threeTeams} />);
    await screen.findByTestId('trophy-case');
    expect(screen.getByRole('button', { name: 'Show all 27 awards' })).toBeInTheDocument();
  });

  test('5 teams with 4 awards show everything and no toggle', async () => {
    const fiveTeams = league(5);
    apiClient.get.mockResolvedValue({ data: awardsFor(fiveTeams, 3).slice(0, 4) });
    renderWithProviders(<TrophyCase leagueId={1} teams={fiveTeams} />);
    await screen.findByTestId('trophy-case');

    expect(tallyRowCount()).toBe(5);
    expect(within(screen.getByRole('list', { name: 'Awards' })).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByTestId('trophy-show-all')).not.toBeInTheDocument();
  });
});

// #1986 L16: a bounded, ordered list of award rows.
describe('award rows', () => {
  const a = (id, type, label, week, teamName = 'Sunday Ballers', season = 2026) => ({
    id, type, label, week, season, team_id: 10, team_name: teamName, data: {}, awarded_at: '2026-07-01T00:00:00.000Z',
  });
  const rowIds = () =>
    screen.getAllByTestId(/^trophy-\d+$/).map((row) => row.getAttribute('data-testid'));

  // Two season awards and ten weekly ones (weeks 1..5, two a week), sent out
  // of order on purpose.
  const twelve = [
    a(1, 'top_scorer', 'Top Scorer', 1),
    a(2, 'top_scorer', 'Top Scorer', 5),
    a(3, 'draft_grade', 'Best Draft (A)', 0),
    a(4, 'top_scorer', 'Top Scorer', 3),
    a(5, 'captain_hindsight', 'Captain Hindsight', 4),
    a(6, 'win_streak', 'Longest Win Streak (7)', 0),
    a(7, 'captain_hindsight', 'Captain Hindsight', 2),
    a(8, 'top_scorer', 'Top Scorer', 2),
    a(9, 'captain_hindsight', 'Captain Hindsight', 5),
    a(10, 'top_scorer', 'Top Scorer', 4),
    a(11, 'captain_hindsight', 'Captain Hindsight', 1),
    a(12, 'captain_hindsight', 'Captain Hindsight', 3),
  ];

  test('season awards come first, then weekly awards newest week first', async () => {
    apiClient.get.mockResolvedValue({ data: twelve });
    const user = userEvent.setup();
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');
    await user.click(screen.getByRole('button', { name: 'Show all 12 awards' }));

    // Season awards (3, 6) in the order the server sent them, then weeks 5..1,
    // ties inside a week in server order.
    expect(rowIds()).toEqual([
      'trophy-3', 'trophy-6',
      'trophy-2', 'trophy-9',
      'trophy-5', 'trophy-10',
      'trophy-4', 'trophy-12',
      'trophy-7', 'trophy-8',
      'trophy-1', 'trophy-11',
    ]);
  });

  test('a null week is a season award, like week 0', async () => {
    apiClient.get.mockResolvedValue({
      data: [a(1, 'top_scorer', 'Top Scorer', 9), a(2, 'champion', '2026 League Champion', null), a(3, 'draft_grade', 'Best Draft (B)', 0)],
    });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(rowIds()).toEqual(['trophy-2', 'trophy-3', 'trophy-1']);
  });

  test('collapsed shows 6 rows with a Show all N awards toggle; expanded shows every row', async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: twelve });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    const list = screen.getByRole('list', { name: 'Awards' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    const toggle = screen.getByRole('button', { name: 'Show all 12 awards' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.getAttribute('aria-controls').split(' ')).toContain(list.id);
    expect(toggle).toHaveStyle({ minHeight: '44px' });

    await user.click(toggle);
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    expect(fewer.getAttribute('aria-controls').split(' ')).toContain(list.id);

    await user.click(fewer);
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show all 12 awards' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('exactly 6 awards need no toggle', async () => {
    apiClient.get.mockResolvedValue({ data: twelve.slice(0, 6) });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(within(screen.getByRole('list', { name: 'Awards' })).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /Show/ })).not.toBeInTheDocument();
  });

  test('switching seasons collapses the list again', async () => {
    const user = userEvent.setup();
    const older = Array.from({ length: 8 }, (_, i) => a(100 + i, 'top_scorer', 'Top Scorer', i + 1, 'Sunday Ballers', 2025));
    apiClient.get.mockResolvedValue({ data: [...twelve, ...older] });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    await user.click(screen.getByRole('button', { name: 'Show all 12 awards' }));
    await user.click(screen.getByRole('combobox', { name: 'Season' }));
    await user.click(await screen.findByRole('option', { name: '2025' }));

    expect(within(screen.getByRole('list', { name: 'Awards' })).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show all 8 awards' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('each row reads label, then "Team · Week N" (weekly) or the Team alone (season)', async () => {
    apiClient.get.mockResolvedValue({ data: twelve });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    expect(screen.getByTestId('trophy-3')).toHaveTextContent(/^Best Draft \(A\)Sunday Ballers$/);
    expect(screen.getByTestId('trophy-2')).toHaveTextContent(/^Top ScorerSunday Ballers · Week 5$/);
  });

  test('is a list with an explicit role, since WebKit drops the mapping from list-style: none', async () => {
    apiClient.get.mockResolvedValue({ data: twelve });
    renderWithProviders(<TrophyCase leagueId={1} />);
    await screen.findByTestId('trophy-case');

    const list = screen.getByRole('list', { name: 'Awards' });
    expect(list.tagName).toBe('UL');
    expect(list).toHaveAttribute('role', 'list');
  });
});

test('hides itself on a fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

// #1861: the season's fewest points left is a season trophy: the team name
// alone (no week) beside its own glyph, the number carried by the label.
test('shows Fewest Left on the Bench as a season row with its number and no week', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { ...trophies[0], id: 8, type: 'fewest_left_on_bench', label: 'Fewest Left on the Bench (31.2)', week: 0, team_name: 'Sunday Ballers', data: { pointsLeft: 31.2 } },
    ],
  });

  renderWithProviders(<TrophyCase leagueId={1} />);
  await screen.findByTestId('trophy-case');

  expect(screen.getByTestId('trophy-8')).toHaveTextContent('Fewest Left on the Bench (31.2)');
  expect(screen.getByTestId('trophy-8')).toHaveTextContent('Sunday Ballers');
  expect(screen.getByTestId('trophy-8')).not.toHaveTextContent('Week');
  // eslint-disable-next-line testing-library/no-node-access -- the glyph is aria-hidden by design
  expect(screen.getByTestId('trophy-8').querySelector('svg[data-icon]')).toHaveAttribute('data-icon', 'target');
});
