import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import TeamSummaryStrip from '../index';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
};

const row = (over = {}) => ({
  id: 55,
  week: 1,
  season: 2026,
  final: false,
  status: null,
  home_team_id: 3,
  away_team_id: 7,
  home_score: '0.0',
  away_score: '0.0',
  home_expected_final: null,
  away_expected_final: null,
  home_players_remaining: null,
  away_players_remaining: null,
  ...over,
});

const LIST_URL = '/api/league/1/matchups?week=1';

const lineup = (entries) => ({ entries });
const starter = (over = {}) => ({ playerId: 1, slot: 'QB', spent: false, locked: false, ...over });

// The widget takes `week`/`viewerTeamId` as props (formal review finding
// ac1-widgets-reach-below-the-island): the page supplies them from its own
// useLeague read rather than this widget calling the hook itself, so no
// /api/league/1 mock is needed here at all.
const renderStrip = (props) => renderWithProviders(<TeamSummaryStrip leagueId={1} week={1} viewerTeamId={3} {...props} />);

test('a loading matchup read shows skeletons and is aria-busy', async () => {
  mockGetByUrl({ [LIST_URL]: new Promise(() => {}) });
  renderStrip({ lineup: lineup([]) });
  await waitFor(() => expect(screen.getByTestId('team-summary-strip')).toHaveAttribute('aria-busy', 'true'));
});

test('a ready matchup shows the score/projected figures, players remaining, and locked count', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [row({ home_expected_final: '95.4', away_expected_final: '88.1', home_players_remaining: 3 })],
    },
  });
  renderStrip({ lineup: lineup([starter({ playerId: 1, locked: true }), starter({ playerId: 2, locked: false })]) });

  expect(await screen.findByTestId('strip-score')).toHaveTextContent('95.4');
  expect(screen.getByTestId('strip-opponent-score')).toHaveTextContent('88.1');
  expect(screen.getByTestId('strip-starters-remaining')).toHaveTextContent('3 to play');
  expect(screen.getByTestId('strip-starters-locked')).toHaveTextContent('1 of 2');
});

test('a bench/IR/spent entry never counts toward locked starters', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [row()] } });
  renderStrip({
    lineup: lineup([
      starter({ playerId: 1, locked: true }),
      { playerId: 2, slot: 'BENCH', locked: true, spent: false },
      { playerId: 3, slot: 'IR', locked: true, spent: false },
      starter({ playerId: 4, locked: true, spent: true }),
    ]),
  });
  expect(await screen.findByTestId('strip-starters-locked')).toHaveTextContent('1 of 1');
});

test('win probability renders once the matchup has started', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [
        row({
          status: 'live',
          home_score: '20', away_score: '10',
          home_expected_final: '95', away_expected_final: '85',
        }),
      ],
    },
  });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

// AC4 (formal review finding ac4-win-probability-gated-on-kickoff): the
// figure must not be gated on the matchup having started - pre-kickoff it
// reads purely off the two projected totals.
test('win probability also renders before kickoff, from the two projected totals alone', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [row({ status: 'scheduled', home_expected_final: '95', away_expected_final: '85' })],
    },
  });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

test('no matchup this week renders the empty state, never an error', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByText('No matchup this week')).toBeInTheDocument();
});

// #1238 AC4: the advice tile.
test('the advice tile shows the gain and swap count when the advice names a suggestion', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }], movePlan: [{ playerId: 1, toSlot: 'RB' }], projectedTotal: 90, optimalTotal: 96.5 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('+6.5 pts · 1 swap');
});

test('the advice tile pluralizes two or more swaps', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }, { slot: 'WR' }], movePlan: [], projectedTotal: 90, optimalTotal: 100 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('2 swaps');
});

test('the advice tile reads "Lineup set" when there is no suggestion', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]), advice: { suggestions: [], movePlan: [] } });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('Lineup set');
});

test('the advice tile also reads "Lineup set" with no advice prop at all (best ball)', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]) });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('Lineup set');
});

test('the advice tile renders even when the matchup read errors, never hidden behind it', async () => {
  mockGetByUrl({ [LIST_URL]: Promise.reject(new Error('boom')) });
  renderStrip({
    lineup: lineup([]),
    advice: { suggestions: [{ slot: 'RB' }], movePlan: [], projectedTotal: 90, optimalTotal: 96.5 },
  });
  expect(await screen.findByTestId('strip-advice')).toHaveTextContent('+6.5 pts · 1 swap');
});

// #1239 AC4: the Bye cluster attention chip.
test('a worst cluster of three or more shows a "Wk N · N byes" attention chip', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]), worstByeCluster: { week: 5, count: 3, players: [] } });
  expect(await screen.findByTestId('attention-chip-bye-cluster')).toHaveTextContent('Wk 5 · 3 byes');
});

test('a worst cluster of only two does not earn an attention chip (notable, not a warning)', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]), worstByeCluster: { week: 5, count: 2, players: [] } });
  await screen.findByTestId('strip-advice');
  expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
});

test('no worst cluster at all renders no attention row', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [] } });
  renderStrip({ lineup: lineup([]) });
  await screen.findByTestId('strip-advice');
  expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
});

// #1330: the questionable-starter and starter-on-bye attention chips.
describe('the questionable-starter and starter-on-bye attention chips (#1330)', () => {
  const lamb = (over = {}) => starter({
    playerId: 1,
    name: 'CeeDee Lamb',
    injuryStatus: 'Q',
    injuryDetail: 'ankle',
    ...over,
  });
  const hubbard = (over = {}) => starter({
    playerId: 2,
    name: 'Sam Hubbard',
    onBye: true,
    ...over,
  });

  test('no starter carries a questionable or bye flag renders no attention row', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([starter({ playerId: 1, name: 'Josh Allen' })]) });
    await screen.findByTestId('strip-advice');
    expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
  });

  test('a Questionable starter with a detail renders "<Last name> Q · <detail>"', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb()]) });
    const chip = await screen.findByTestId('attention-chip-questionable-1');
    expect(chip).toHaveTextContent('Lamb Q · ankle');
    expect(chip).toHaveAttribute('data-variant', 'warning');
  });

  test('a Questionable starter without a detail renders "<Last name> Q" alone', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb({ injuryDetail: null })]) });
    expect(await screen.findByTestId('attention-chip-questionable-1')).toHaveTextContent('Lamb Q');
  });

  test('a Doubtful starter renders "<Last name> D"', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb({ injuryStatus: 'D', injuryDetail: null })]) });
    expect(await screen.findByTestId('attention-chip-questionable-1')).toHaveTextContent('Lamb D');
  });

  test('an Out starter produces no questionable chip (Out is Unavailable, not questionable)', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb({ injuryStatus: 'O', injuryDetail: null })]) });
    await screen.findByTestId('strip-advice');
    expect(screen.queryByTestId(/attention-chip-questionable/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
  });

  test('a bench player carrying Q produces no chip', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb({ slot: 'BENCH' })]) });
    await screen.findByTestId('strip-advice');
    expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
  });

  test('a starter on bye renders "<Last name> on bye"', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([hubbard()]) });
    const chip = await screen.findByTestId('attention-chip-bye-2');
    expect(chip).toHaveTextContent('Hubbard on bye');
    expect(chip).toHaveAttribute('data-variant', 'warning');
  });

  // Red-tell: all three kinds together, in order questionable, on bye, Bye
  // cluster - removing either new chip turns this red and no other case red.
  test('all three kinds together render in order: questionable, on bye, Bye cluster', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({
      lineup: lineup([lamb(), hubbard()]),
      worstByeCluster: { week: 5, count: 3, players: [] },
    });
    const row = await screen.findByTestId('strip-attention');
    const badges = within(row).getAllByTestId(/^attention-chip-/);
    expect(badges.map((b) => b.textContent)).toEqual([
      'Lamb Q · ankle',
      'Hubbard on bye',
      'Wk 5 · 3 byes',
    ]);
    expect(badges[0]).toHaveAttribute('data-variant', 'warning');
    expect(badges[1]).toHaveAttribute('data-variant', 'warning');
  });

  test('a past week hides the whole attention row, including questionable and bye chips', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({
      lineup: { week: 2, currentWeek: 3, entries: [lamb(), hubbard()] },
      worstByeCluster: { week: 5, count: 3, players: [] },
    });
    await screen.findByTestId('strip-advice');
    expect(screen.queryByTestId('strip-attention')).not.toBeInTheDocument();
  });

  test('best ball shows the injury chip but never the on-bye chip', async () => {
    mockGetByUrl({ [LIST_URL]: { data: [] } });
    renderStrip({ lineup: lineup([lamb(), hubbard()]), bestBall: true });
    expect(await screen.findByTestId('attention-chip-questionable-1')).toBeInTheDocument();
    expect(screen.queryByTestId('attention-chip-bye-2')).not.toBeInTheDocument();
  });
});

// #1241 AC2: a socket score update moves the strip's own totals, the same
// scores:updated feed the Ledger's points cell reads (entities/matchup's
// applyScoreEvent, applied by useTeamSummaryStrip).
test('a scoreEvent prop patches the score/projected figures on top of the list read', async () => {
  mockGetByUrl({
    [LIST_URL]: {
      data: [row({ home_expected_final: '95.4', away_expected_final: '88.1' })],
    },
  });
  renderStrip({
    lineup: lineup([]),
    scoreEvent: { scored: [{ matchupId: 55, homeScore: 14, awayScore: 7 }] },
  });
  expect(await screen.findByTestId('strip-score')).toHaveTextContent('14.0 / 95.4');
});

// An event for a different matchup is a no-op (entities/matchup's own
// applyScoreEvent contract).
test('a scoreEvent for a different matchup never patches this one', async () => {
  mockGetByUrl({ [LIST_URL]: { data: [row({ home_expected_final: '95.4' })] } });
  renderStrip({
    lineup: lineup([]),
    scoreEvent: { scored: [{ matchupId: 999, homeScore: 14, awayScore: 7 }] },
  });
  expect(await screen.findByTestId('strip-score')).toHaveTextContent('0.0 / 95.4');
});
