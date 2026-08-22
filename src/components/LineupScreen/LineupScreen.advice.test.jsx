import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import LineupScreen from './LineupScreen';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), request: jest.fn() },
}));

/**
 * Start/Sit panel against the `free_baseline_v2` advice payload.
 *
 * Every case here is about the panel rendering EXACTLY what the server sent
 * and nothing more: no invented factor, no invented range, no "vs null" for an
 * opponent the model could not resolve, and an honest statement that expert
 * consensus is unavailable rather than an implication that experts agreed.
 */

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<LineupScreen />, {
    path: '/league/:leagueId/lineup',
    route: `/league/${leagueId}/lineup`,
  });

const flexBenchEntries = [
  { id: 10, name: 'Justin Jefferson', position: 'WR', nfl_team: 'Minnesota Vikings', slot: 'FLEX', locked: false, onBye: false },
  { id: 11, name: 'Saquon Barkley', position: 'RB', nfl_team: 'Philadelphia Eagles', slot: 'BENCH', locked: false, onBye: false },
];

const lineupResponse = (overrides = {}) => ({
  leagueId: 1,
  teamId: 10,
  season: 2026,
  week: 3,
  currentWeek: 3,
  rosterSlots: [
    { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'WR', count: 2, eligiblePositions: ['WR'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ],
  benchSlots: 5,
  irSlots: 1,
  entries: flexBenchEntries,
  ...overrides,
});

const setupGet = ({ lineup, advice } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) return Promise.resolve({ data: advice });
    if (url.startsWith('/api/team/lineup')) return Promise.resolve({ data: lineup ?? lineupResponse() });
    if (url.startsWith('/api/team/hindsight')) return Promise.resolve({ data: undefined });
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: { id: 1, best_ball: false } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
};

/** The pre-v2 response shape: totals, suggestions, opponent context, nothing else. */
const legacyAdvice = (overrides = {}) => ({
  week: 3,
  season: 2026,
  projectedTotal: 110.4,
  optimalTotal: 118.2,
  suggestions: [
    {
      slot: 'FLEX',
      gain: 7.7,
      current: { playerId: 10, name: 'Justin Jefferson', projection: 10.2, opponent: 'DAL', opponentPointsAllowed: 14.5 },
      suggested: { playerId: 11, name: 'Saquon Barkley', projection: 17.9, opponent: 'NYG', opponentPointsAllowed: 22.1 },
    },
  ],
  ...overrides,
});

const v2Advice = (overrides = {}) => ({
  ...legacyAdvice(),
  modelVersion: 'free_baseline_v2',
  generatedAt: '2026-10-08T12:00:00.000Z',
  inputCutoff: '2026-10-11T17:00:00.000Z',
  sourceCoverage: {
    opponent: { status: 'available' },
    weather: { status: 'unavailable', reason: 'no verified stadium coordinates' },
    expertConsensus: { status: 'unavailable', source: null },
  },
  openSlotFills: [],
  unavailable: [],
  movePlan: [],
  suggestions: [
    {
      slot: 'FLEX',
      gain: 7.7,
      probabilityBetter: 0.82,
      verdict: 'start',
      confidence: 'medium',
      current: {
        playerId: 10,
        name: 'Justin Jefferson',
        projection: 10.2,
        opponent: 'DAL',
        opponentPointsAllowed: 14.5,
        distribution: { p10: 5.1, p25: 7.8, median: 10.2, p75: 13, p90: 16.4 },
        confidence: 'medium',
        factors: {},
      },
      suggested: {
        playerId: 11,
        name: 'Saquon Barkley',
        projection: 17.9,
        opponent: 'NYG',
        opponentPointsAllowed: 22.1,
        distribution: { p10: 11.4, p25: 14.6, median: 17.9, p75: 21.2, p90: 25.8 },
        confidence: 'medium',
        factors: {
          opponent: { available: true, opponentTeam: 'NYG', games: 6, pointsContribution: 1.2 },
          homeAway: { available: true, isHome: true },
          weather: null,
          versusOpponent: null,
          availability: { status: 'Q', activeProbability: null },
        },
      },
    },
  ],
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
  localStorage.removeItem('pending_lineup_mutations');
});

test('the suggestion shows a projection range, a confidence chip and calibrated odds', async () => {
  setupGet({ advice: v2Advice() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const row = screen.getByTestId('suggestion-row-FLEX');
  // The range sits inside the one set of parentheses the headline already
  // opens; nesting a second pair around it reads as a typo.
  expect(within(row).getByText(/17\.9 proj, range 11\.4–25\.8/)).toBeInTheDocument();
  expect(within(row).getByText(/10\.2 proj, range 5\.1–16\.4/)).toBeInTheDocument();
  // Label is the level alone; the full phrasing lives in the tooltip so the
  // chip cannot truncate to "medium confi…" on a phone.
  expect(screen.getByTestId('suggestion-confidence-FLEX')).toHaveTextContent('medium');
  // Both players are named: "he outscores him" is unreadable out of context.
  expect(
    within(row).getByText(/82% chance Saquon Barkley outscores Justin Jefferson/)
  ).toBeInTheDocument();
});

test('factor chips render only for the factors the server supplied', async () => {
  setupGet({ advice: v2Advice() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const row = screen.getByTestId('suggestion-row-FLEX');
  expect(within(row).getByText('Matchup +1.2')).toBeInTheDocument();
  expect(within(row).getByText('Home')).toBeInTheDocument();
  expect(within(row).getByText('Questionable')).toBeInTheDocument();
  // Weather and head-to-head came back null, so neither draws a chip at all —
  // an unevaluated factor must never appear as a measured neutral.
  expect(within(row).queryByText(/Sunny|Rain|Windy/)).not.toBeInTheDocument();
  expect(within(row).queryByText(/prior meetings/)).not.toBeInTheDocument();
});

test('a missing opponent, range or probability never renders as null', async () => {
  const advice = v2Advice();
  advice.suggestions[0].current.opponent = null;
  advice.suggestions[0].current.opponentPointsAllowed = null;
  advice.suggestions[0].suggested.opponent = null;
  advice.suggestions[0].suggested.opponentPointsAllowed = null;
  advice.suggestions[0].suggested.distribution = null;
  advice.suggestions[0].probabilityBetter = null;
  setupGet({ advice });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const row = screen.getByTestId('suggestion-row-FLEX');
  expect(row).not.toHaveTextContent('null');
  expect(row).not.toHaveTextContent('undefined');
  expect(within(row).queryByText(/vs NYG/)).not.toBeInTheDocument();
  expect(within(row).queryByText(/outscores/)).not.toBeInTheDocument();
  // Without a range, the bare point estimate still renders.
  expect(within(row).getByText(/17\.9 proj/)).toBeInTheDocument();
});

test('a toss-up comparison is labeled instead of presented as an instruction', async () => {
  setupGet({ advice: v2Advice({ suggestions: v2Advice().suggestions.map((s) => ({ ...s, verdict: 'tossup', probabilityBetter: 0.54 })) }) });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(within(screen.getByTestId('suggestion-row-FLEX')).getByText('Toss-up')).toBeInTheDocument();
});

test('the panel says out loud that expert consensus and weather are unavailable', async () => {
  setupGet({ advice: v2Advice() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(screen.getByRole('heading', { name: 'Endzone Forecast' })).toBeInTheDocument();
  const provenance = screen.getByTestId('lineup-advice-provenance');
  expect(provenance).toHaveTextContent('Version free_baseline_v2');
  expect(provenance).toHaveTextContent('expert consensus unavailable');
  expect(provenance).toHaveTextContent('weather unavailable');
});

test('unavailable players are listed with the reason they cannot play', async () => {
  setupGet({
    advice: v2Advice({
      unavailable: [
        { playerId: 4, name: 'Davante Adams', slot: 'WR', reason: 'bye' },
        { playerId: 9, name: 'SF Defense', slot: 'DEF', reason: 'out' },
      ],
    }),
  });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(screen.getByTestId('lineup-unavailable-note')).toHaveTextContent(
    'Not available this week: Davante Adams (bye), SF Defense (out)'
  );
});

test('an empty starting slot offers a one-move fill that saves a legal lineup', async () => {
  setupGet({
    advice: v2Advice({
      suggestions: [],
      openSlotFills: [
        {
          slot: 'FLEX',
          playerId: 11,
          name: 'Saquon Barkley',
          projection: 17.9,
          distribution: { p10: 11.4, p25: 14.6, median: 17.9, p75: 21.2, p90: 25.8 },
          confidence: 'medium',
          factors: {},
          opponent: 'NYG',
          opponentPointsAllowed: 22.1,
        },
      ],
    }),
  });
  apiClient.put.mockResolvedValue({});

  renderScreen();
  await screen.findByTestId('lineup-open-slot-fills');

  expect(
    within(screen.getByTestId('open-slot-fill-FLEX')).getByText(
      /Start Saquon Barkley \(17\.9 proj, range 11\.4–25\.8\) in your empty FLEX/
    )
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [{ playerId: 11, slot: 'FLEX' }],
    })
  );
});

test('a legacy advice response with none of the new fields still renders', async () => {
  // A tab opened before the deploy, or a response cached by the service
  // worker: no modelVersion, no distributions, no coverage.
  setupGet({ advice: legacyAdvice() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const row = screen.getByTestId('suggestion-row-FLEX');
  expect(within(row).getByText(/17\.9 proj/)).toBeInTheDocument();
  expect(row).not.toHaveTextContent('undefined');
  expect(within(row).getByText(/vs NYG, 22\.1 pts\s*allowed to FLEX/)).toBeInTheDocument();
  expect(screen.queryByTestId('lineup-advice-provenance')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lineup-unavailable-note')).not.toBeInTheDocument();
});

test('Apply still sends the same two-move swap under the new payload', async () => {
  setupGet({ advice: v2Advice() });
  apiClient.put.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Justin Jefferson');

  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [
        { playerId: 10, slot: 'BENCH' },
        { playerId: 11, slot: 'FLEX' },
      ],
    })
  );
});

test('the suggestion row exposes a screen-reader-readable recommendation', async () => {
  setupGet({ advice: v2Advice() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  // Confidence is in the label because the chip's own phrasing is tooltip-only,
  // which a virtual cursor reading the group never opens.
  expect(
    screen.getByRole('group', {
      name: 'FLEX: start Saquon Barkley over Justin Jefferson, 7.7 projected points, medium confidence',
    })
  ).toBeInTheDocument();
});

test('an unavailable incumbent shows the reason, not a zero with a range', async () => {
  // Regression: the bye player used to render as "0 (6.82-7.62) proj" — a zero
  // beside a range that excludes zero. A player who cannot play has no
  // distribution and no odds to quote against.
  const advice = v2Advice();
  advice.suggestions[0].current.projection = 0;
  advice.suggestions[0].current.distribution = null;
  advice.suggestions[0].current.availability = { available: false, reason: 'bye', activeProbability: 0 };
  advice.suggestions[0].probabilityBetter = null;
  setupGet({ advice });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const row = screen.getByTestId('suggestion-row-FLEX');
  expect(within(row).getByText(/over Justin Jefferson \(on bye\)/)).toBeInTheDocument();
  expect(row).not.toHaveTextContent('0 proj');
  expect(within(row).queryByText(/outscores/)).not.toBeInTheDocument();
});
