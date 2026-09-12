import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';

/**
 * player-decision-card widget tests (#1240). LineupPage.test.jsx (AC8) covers
 * the composed page: opening from a row, a swap from bench options, a locked
 * option, the sheet at a narrow width, focus return on close. This suite
 * covers the widget's own section visibility, actions and Compare in
 * isolation - each null-source hide rule, the Bench/Start action, and the
 * Compare picker.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

function setViewport(isMobile) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: isMobile,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

beforeEach(() => {
  setViewport(false);
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });
});

afterEach(() => {
  jest.clearAllMocks();
});

const entry = (over = {}) => ({
  playerId: 1,
  name: 'Josh Allen',
  position: 'QB',
  nflTeam: 'BUF',
  slot: 'QB',
  projection: 24.3,
  floor: 18,
  ceiling: 30,
  points: null,
  injuryStatus: null,
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  gameKey: 'g1',
  eligibleSlots: ['BENCH', 'QB'],
  locked: false,
  spent: false,
  edge: null,
  ...over,
});

function renderCard(props = {}) {
  const defaults = {
    open: true,
    onClose: jest.fn(),
    entry: entry(),
    entries: [entry()],
    leagueId: 1,
    week: 4,
    bestBall: false,
    onSwap: jest.fn(),
    onRequestDrop: jest.fn(),
    canDropEntry: () => true,
  };
  const merged = { ...defaults, ...props };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('opens with the row\'s own fields immediately, before the context endpoint resolves', async () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderCard();
  expect(await screen.findByRole('heading', { name: 'Josh Allen' })).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-range-bar')).toBeInTheDocument();
});

test('a null Line hides the Line and Implied team total tiles; a null weather hides the weather tile', async () => {
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });
  renderCard();
  await screen.findByRole('heading', { name: 'Josh Allen' });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('decision-card-line')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-weather')).not.toBeInTheDocument();
});

test('a real Line/weather renders the Line, Implied team total and weather tiles', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      line: { spread: -3, total: 47, impliedTeamTotal: 22, observedAt: '2026-09-14T00:00:00Z' },
      weather: { indoor: false, temperatureF: 45, windSpeedMph: 10, windGustMph: 18, precipitationProbability: 20, shortForecast: 'Cloudy' },
      usage: null,
    },
  });
  renderCard();
  expect(await screen.findByTestId('decision-card-line')).toHaveTextContent('Line: -3 / 47');
  expect(screen.getByTestId('decision-card-implied-total')).toHaveTextContent('22.0');
  expect(screen.getByTestId('decision-card-weather')).toHaveTextContent('45°F');
});

test('indoor weather shows Indoor, never a fabricated temperature', async () => {
  apiClient.get.mockResolvedValue({
    data: { line: null, weather: { indoor: true, temperatureF: null, windSpeedMph: null, windGustMph: null, precipitationProbability: null, shortForecast: null }, usage: null },
  });
  renderCard();
  expect(await screen.findByTestId('decision-card-weather')).toHaveTextContent('Indoor');
});

test('empty usage hides the Usage table', async () => {
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });
  renderCard();
  await screen.findByRole('heading', { name: 'Josh Allen' });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('decision-card-usage')).not.toBeInTheDocument();
});

test('usage renders the weekly rows and the season average', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      line: null,
      weather: null,
      usage: {
        weeks: [{ season: 2026, week: 3, targets: 8, carries: 0, airYards: 90, targetShare: 0.23, fantasyPoints: 12.4 }],
        seasonAverage: { targets: 6.5, carries: 0.5, airYards: 65, targetShare: 0.21, fantasyPoints: 10.2 },
      },
    },
  });
  renderCard();
  const table = await screen.findByTestId('decision-card-usage-table');
  expect(within(table).getByText('Wk 3')).toBeInTheDocument();
  expect(within(table).getByText('Season avg')).toBeInTheDocument();
});

test('the largest Factor\'s explanation renders only when the Edge line kind is "factor"', async () => {
  renderCard({ entry: entry({ edge: { kind: 'factor', text: 'Matchup +3.5' } }) });
  expect(await screen.findByTestId('decision-card-factor')).toHaveTextContent('Matchup +3.5');
});

test('no Factor tile when the Edge line is a different kind', async () => {
  renderCard({ entry: entry({ edge: { kind: 'result', text: 'Beat projection' } }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-factor')).not.toBeInTheDocument();
});

test('the injury tile is hidden for a healthy player', async () => {
  renderCard({ entry: entry({ injuryStatus: null }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-injury')).not.toBeInTheDocument();
});

test('the injury tile shows the designation and the injury Edge line\'s own detail', async () => {
  renderCard({
    entry: entry({ injuryStatus: 'Q', edge: { kind: 'injury', text: 'Hamstring, limited in practice' } }),
  });
  const tile = await screen.findByTestId('decision-card-injury');
  expect(tile).toHaveTextContent('Questionable');
  expect(tile).toHaveTextContent('Hamstring, limited in practice');
});

test('bench options list eligible bench players by projection, and a swap sends both moves', async () => {
  const onSwap = jest.fn();
  const starter = entry();
  const benchA = entry({ playerId: 2, name: 'Bench Low', slot: 'BENCH', projection: 8, eligibleSlots: ['BENCH', 'QB'] });
  const benchB = entry({ playerId: 3, name: 'Bench High', slot: 'BENCH', projection: 20, eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, benchA, benchB], onSwap });

  const section = await screen.findByTestId('decision-card-bench-options');
  const names = within(section).getAllByText(/Bench (Low|High)/).map((n) => n.textContent);
  expect(names).toEqual(['Bench High', 'Bench Low']);
  // Review finding: every Swap button shared the name "Swap"; each now
  // names the player it swaps in.
  expect(within(section).getByRole('button', { name: 'Swap in Bench High' })).toBeInTheDocument();
  expect(within(section).getByRole('button', { name: 'Swap in Bench Low' })).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(within(section).getByTestId('decision-card-bench-swap-3'));
  expect(onSwap).toHaveBeenCalledWith([
    { playerId: 3, slot: 'QB' },
    { playerId: 1, slot: 'BENCH' },
  ]);
});

test('a locked bench option is disabled with the lock shown, never swappable', async () => {
  const onSwap = jest.fn();
  const starter = entry();
  const lockedBench = entry({ playerId: 2, name: 'Locked Bench', slot: 'BENCH', locked: true, eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, lockedBench], onSwap });

  const section = await screen.findByTestId('decision-card-bench-options');
  expect(within(section).getByTestId('decision-card-bench-option-lock')).toHaveTextContent('Locked');
  const swapButton = within(section).getByTestId('decision-card-bench-swap-2');
  expect(swapButton).toBeDisabled();
  expect(onSwap).not.toHaveBeenCalled();
});

test('no bench options section when the opened player is himself BENCH or IR', async () => {
  renderCard({ entry: entry({ slot: 'BENCH' }), entries: [entry({ slot: 'BENCH' })] });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
});

test('Bench moves a starter to BENCH with one move', async () => {
  const onSwap = jest.fn();
  renderCard({ onSwap });
  await userEvent.click(await screen.findByTestId('decision-card-bench-action'));
  expect(onSwap).toHaveBeenCalledWith([{ playerId: 1, slot: 'BENCH' }]);
});

test('Bench is disabled in best ball', async () => {
  renderCard({ bestBall: true });
  expect(await screen.findByTestId('decision-card-bench-action')).toBeDisabled();
});

test('Start moves a bench player directly when exactly one eligible starting slot exists', async () => {
  const onSwap = jest.fn();
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: bench, entries: [bench], onSwap });
  await userEvent.click(await screen.findByTestId('decision-card-start-action'));
  expect(onSwap).toHaveBeenCalledWith([{ playerId: 1, slot: 'QB' }]);
});

test('Start opens a menu of eligible starting slots when there is more than one', async () => {
  const onSwap = jest.fn();
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB', 'FLEX'] });
  renderCard({ entry: bench, entries: [bench], onSwap });
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('decision-card-start-action'));
  await user.click(await screen.findByRole('menuitem', { name: 'FLEX' }));
  expect(onSwap).toHaveBeenCalledWith([{ playerId: 1, slot: 'FLEX' }]);
});

test('Drop is disabled when canDropEntry refuses', async () => {
  renderCard({ canDropEntry: () => false });
  expect(await screen.findByTestId('decision-card-drop')).toBeDisabled();
});

test('Drop is enabled and calls onRequestDrop when canDropEntry allows it', async () => {
  const onRequestDrop = jest.fn();
  renderCard({ canDropEntry: () => true, onRequestDrop });
  const dropButton = await screen.findByTestId('decision-card-drop');
  expect(dropButton).toBeEnabled();
  await userEvent.click(dropButton);
  expect(onRequestDrop).toHaveBeenCalledWith(entry());
});

test('Trade links to the existing trade flow', async () => {
  renderCard({ leagueId: 7 });
  expect(await screen.findByTestId('decision-card-trade')).toHaveAttribute('href', '/league/7/trades');
});

test('Compare shows two cards side by side, each named by its own heading, with no duplicated content, and can be cleared', async () => {
  const starter = entry();
  const other = entry({ playerId: 2, name: 'Compare Target' });
  renderCard({ entry: starter, entries: [starter, other] });

  const user = userEvent.setup();
  await user.click(await screen.findByTestId('decision-card-compare-action'));
  await user.click(await screen.findByRole('menuitem', { name: 'Compare Target' }));

  const compare = await screen.findByTestId('decision-card-compare');
  expect(within(compare).getByRole('heading', { name: 'Josh Allen', level: 3 })).toBeInTheDocument();
  expect(within(compare).getByRole('heading', { name: 'Compare Target', level: 3 })).toBeInTheDocument();
  // Review finding: an earlier revision rendered the primary player's own
  // sections twice (once above the grid, once inside it), so this would
  // have found three RangeBars instead of the correct two - one per panel.
  expect(within(compare).getAllByTestId('decision-card-range-bar')).toHaveLength(2);
  expect(screen.getAllByTestId('decision-card-range-bar')).toHaveLength(2);

  await user.click(screen.getByRole('button', { name: 'Clear compare' }));
  expect(screen.queryByTestId('decision-card-compare')).not.toBeInTheDocument();
  // Focus returns to the Compare button rather than being dropped (review finding).
  expect(screen.getByTestId('decision-card-compare-action')).toHaveFocus();
});

test('the Start and Compare menu triggers expose popup state, and the menus carry an accessible name', async () => {
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB', 'FLEX'] });
  renderCard({ entry: bench, entries: [bench, entry({ playerId: 2, name: 'Other' })] });

  const startButton = await screen.findByTestId('decision-card-start-action');
  expect(startButton).toHaveAttribute('aria-haspopup', 'menu');
  expect(startButton).toHaveAttribute('aria-expanded', 'false');
  const user = userEvent.setup();
  await user.click(startButton);
  expect(startButton).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByRole('menu', { name: 'Eligible starting slots' })).toBeInTheDocument();
  await user.keyboard('{Escape}');

  const compareButton = screen.getByTestId('decision-card-compare-action');
  expect(compareButton).toHaveAttribute('aria-haspopup', 'menu');
  await user.click(compareButton);
  expect(await screen.findByRole('menu', { name: 'Players to compare' })).toBeInTheDocument();
});

test('the phone sheet carries the drag handle and the sheet variant; desktop is the drawer variant', async () => {
  setViewport(true);
  renderCard();
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.getByTestId('decision-card-drag-handle')).toBeInTheDocument();
  expect(screen.getByTestId('decision-card')).toHaveAttribute('data-variant', 'sheet');
});

test('desktop renders no drag handle and carries the drawer variant', async () => {
  renderCard();
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-drag-handle')).not.toBeInTheDocument();
  expect(screen.getByTestId('decision-card')).toHaveAttribute('data-variant', 'drawer');
});

test('the close control calls onClose', async () => {
  const onClose = jest.fn();
  renderCard({ onClose });
  await userEvent.click(await screen.findByTestId('decision-card-close'));
  expect(onClose).toHaveBeenCalled();
});

test('a locked player carries a Locked indicator on the card itself, not only a disabled control', async () => {
  renderCard({ entry: entry({ locked: true }) });
  expect(await screen.findByTestId('decision-card-locked')).toHaveTextContent('Locked');
});

test('a spent player carries a Spent indicator on the card itself', async () => {
  renderCard({ entry: entry({ spent: true }) });
  expect(await screen.findByTestId('decision-card-spent')).toHaveTextContent('Spent');
});

test('an unlocked, unspent player shows neither indicator', async () => {
  renderCard();
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-locked')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-spent')).not.toBeInTheDocument();
});
