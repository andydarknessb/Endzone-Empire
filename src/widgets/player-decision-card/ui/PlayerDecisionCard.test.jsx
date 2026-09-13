import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import * as slotActions from '../model/slotActions';

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
  jest.restoreAllMocks(); // s2 spies on movesToStart; never let a failure leak it (round 4 finding t3)
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
  factorExplanation: null,
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
    leagueUnsettled: false,
    onSwap: jest.fn(),
    onRequestDrop: jest.fn(),
    canDropEntry: () => true,
  };
  const merged = { ...defaults, ...props };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

// #1307 (ADR 0040): a non-lineup player row, the shape WaiverWire and
// PlayerManagement map their own rows into - no slot/locked/spent/
// eligibleSlots, since neither surface has a lineup to read those from.
const availabilityEntry = (over = {}) => ({
  playerId: 7,
  name: 'Breece Hall',
  position: 'RB',
  nflTeam: 'NYJ',
  slot: 'RB',
  injuryStatus: null,
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  ...over,
});

// Routes `apiClient.get` by URL so the same suite can stub the lineup-
// context endpoint (`line`/`weather`/`usage`) and the card route
// (`/api/players/:id/card`, #1306/#1331) with different bodies.
function mockCardRoute(card) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/card?')) return Promise.resolve({ data: card || {} });
    return Promise.resolve({ data: { line: null, weather: null, usage: null } });
  });
}

describe('context (#1307, ADR 0040)', () => {
  // Red tell: this is the FIRST context test, against a widget whose
  // `context` prop did not exist before this ticket.
  test('context="waivers" renders Claim and the news list, and no bench options', async () => {
    mockCardRoute({ news: [{ headline: 'Questionable for Sunday', publishedAt: null }] });
    renderCard({
      context: 'waivers',
      entry: availabilityEntry(),
      entries: undefined,
      availability: { waiverPriority: 3 },
    });

    expect(await screen.findByTestId('claim-player-action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
    expect(await screen.findByText('Questionable for Sunday')).toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-start-action')).not.toBeInTheDocument();
  });

  test('context="my_team" (the default) renders bench options and no news', async () => {
    mockCardRoute({ news: [{ headline: 'Should not show for your own player' }] });
    const starter = entry();
    const bench = entry({ playerId: 2, name: 'Bench Guy', slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    renderCard({ entry: starter, entries: [starter, bench] });

    await screen.findByTestId('decision-card-bench-options');
    expect(screen.queryByTestId('decision-card-news-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('claim-player-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-player-action')).not.toBeInTheDocument();
  });

  test('context="free_agent" at capacity renders the inline drop pick', async () => {
    mockCardRoute(null);
    renderCard({
      context: 'free_agent',
      entry: availabilityEntry(),
      entries: undefined,
      availability: { rosterCount: 16, rosterCapacity: 16 },
      roster: [{ id: 20, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 }],
    });

    const action = await screen.findByTestId('add-player-action');
    expect(within(action).getByLabelText('Drop a player')).toBeInTheDocument();
    expect(within(action).getByTestId('add-player-submit')).toHaveTextContent('Add and drop');
  });

  test('a null Upgrade renders no Upgrade tile and no empty label', async () => {
    mockCardRoute({
      decision: { projWeek: { week: 4, points: 12 }, ros: { points: 90 }, upgrade: null },
      news: [],
    });
    renderCard({
      context: 'waivers',
      entry: availabilityEntry(),
      entries: undefined,
      availability: { waiverPriority: 1 },
    });

    await screen.findByTestId('decision-strip');
    expect(screen.queryByTestId('decision-strip-upgrade')).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });

  test('context="rostered" shows a Propose trade link and the rostering team', async () => {
    mockCardRoute(null);
    renderCard({
      context: 'rostered',
      entry: availabilityEntry(),
      entries: undefined,
      leagueId: 7,
      availability: { teamName: 'Polk High Legends' },
    });

    expect(await screen.findByTestId('decision-card-propose-trade')).toHaveAttribute('href', '/league/7/trades');
    expect(screen.getByText('Rostered by Polk High Legends')).toBeInTheDocument();
  });

  // Formal review round 1, f1 (blocker): PlayerManagement opens the card for
  // the caller's own player too (context="my_team" with no lineup wiring at
  // all - no entries, no onSwap, no onRequestDrop), which used to crash in
  // isEligibleMove on an entry with no eligibleSlots.
  test('context="my_team" with no lineup wiring (opened from a non-Lineup surface) renders an Open lineup link instead of crashing', async () => {
    mockCardRoute(null);
    renderCard({
      context: 'my_team',
      entry: availabilityEntry({ slot: 'RB' }),
      entries: undefined,
      onSwap: undefined,
      onRequestDrop: undefined,
      canDropEntry: undefined,
      leagueId: 9,
    });

    expect(await screen.findByTestId('decision-card-open-lineup')).toHaveAttribute('href', '/league/9/lineup');
    expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-start-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
  });

  test('context="my_team" WITH lineup wiring (the base Lineup case) still renders the Bench/Start/Compare/Trade/Drop bar, not the Open lineup link', async () => {
    renderCard(); // the suite's own default props: entry+entries+onSwap+onRequestDrop+canDropEntry
    await screen.findByTestId('decision-card-bench-action');
    expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
  });
});

describe('prev/next over the opening list (formal review round 1, f5)', () => {
  test('shows the position in the list and navigates with Previous/Next', async () => {
    const onNavigate = jest.fn();
    renderCard({ playerIds: [1, 2, 3], onNavigate });

    expect(await screen.findByLabelText('Player 1 of 3')).toBeInTheDocument();
    const prev = screen.getByTestId('decision-card-prev');
    const next = screen.getByTestId('decision-card-next');
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    await userEvent.click(next);
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  test('Right/Left arrow keys navigate when not typing in a control', async () => {
    const onNavigate = jest.fn();
    renderCard({ entry: entry({ playerId: 2 }), playerIds: [1, 2, 3], onNavigate });
    await screen.findByLabelText('Player 2 of 3');

    await userEvent.keyboard('{ArrowRight}');
    expect(onNavigate).toHaveBeenCalledWith(3);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  test('no playerIds prop renders no prev/next controls', async () => {
    renderCard();
    await screen.findByRole('heading', { name: 'Josh Allen' });
    expect(screen.queryByTestId('decision-card-prev')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decision-card-next')).not.toBeInTheDocument();
  });

  // Second risk review (accessibility, round 1 fix delta), finding 4: the
  // caption is a status region with a real accessible name, not a bare
  // <span> only jsdom's aria-label matcher could "see".
  test('the position caption carries the status role', async () => {
    renderCard({ playerIds: [1, 2, 3], onNavigate: jest.fn() });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('1 of 3');
  });

  // Second risk review, finding 2: a Prev/Next click that disables that same
  // button (an end of the list) must not drop focus to the document body -
  // it moves to the title, which also announces the new player's name.
  test('focus moves to the title heading after navigating, even at an end of the list', async () => {
    // A small stateful wrapper stands in for WaiverWire/PlayerManagement,
    // which own `quickViewId` and re-render the card with a new `entry` on
    // `onNavigate` - a plain `rerender()` call would instead replace the
    // whole MemoryRouter tree `renderWithProviders` wraps this in.
    function NavigatingCard(props) {
      const [current, setCurrent] = React.useState(props.entry);
      return (
        <PlayerDecisionCard
          {...props}
          entry={current}
          onNavigate={(id) => setCurrent(entry({ playerId: id }))}
        />
      );
    }
    renderWithProviders(
      <NavigatingCard
        open
        onClose={jest.fn()}
        entry={entry({ playerId: 1 })}
        entries={[entry({ playerId: 1 })]}
        leagueId={1}
        week={4}
        bestBall={false}
        leagueUnsettled={false}
        onSwap={jest.fn()}
        onRequestDrop={jest.fn()}
        canDropEntry={() => true}
        playerIds={[1, 2]}
      />
    );
    await screen.findByLabelText('Player 1 of 2');

    await userEvent.click(screen.getByTestId('decision-card-next'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Josh Allen' })).toHaveFocus());
    expect(await screen.findByLabelText('Player 2 of 2')).toBeInTheDocument();
  });

  // Second risk review, finding 1: the global ArrowLeft/ArrowRight handler
  // must not steal the keys from a FOCUSED, horizontally-scrollable region -
  // WeeklyPointsBars' own tabIndex={0} strip (the prior risk round's own
  // keyboard-scroll fix, WCAG 2.1.1) is exactly such a region.
  test('arrow keys are left alone for a focused, horizontally-scrollable region', async () => {
    mockCardRoute({
      weeks: Array.from({ length: 18 }, (_, i) => ({ week: i + 1, kind: 'projected', points: 10 })),
    });
    const onNavigate = jest.fn();
    renderCard({ playerIds: [1, 2, 3], onNavigate });

    const strip = await screen.findByTestId('weekly-points-bars');
    Object.defineProperty(strip, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: 358, configurable: true });
    strip.focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

// Formal review round 1, f6: the body and ADR 0040 say 560px, not the 420 this
// shipped at.
test('the desktop drawer is 560px wide (760px is now 1040px with Compare open)', async () => {
  renderCard();
  const card = await screen.findByTestId('decision-card');
  expect(card).toHaveStyle({ width: '560px' });
});

test('opens with the row\'s own fields immediately, before the context endpoint resolves', async () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderCard();
  expect(await screen.findByRole('heading', { name: 'Josh Allen' })).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-range-bar')).toBeInTheDocument();
});

// #1317: the header avatar's ink is monogramInk(kit.jersey), not the themed
// var(--text-inverse) - the same fixed white-or-black rule LedgerRow's
// PlayerAvatar uses, chosen against the jersey itself rather than the theme.
// CHI's jersey (#0b162a) clears 4.5:1 against white; CIN's (#fb4f14) does not.
test('the header avatar ink is white for a jersey that clears 4.5:1 against white (CHI)', async () => {
  renderCard({ entry: entry({ nflTeam: 'CHI' }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.getByText('JA')).toHaveStyle({ color: '#ffffff' });
});

test('the header avatar ink is black for a jersey that fails 4.5:1 against white (CIN)', async () => {
  renderCard({ entry: entry({ nflTeam: 'CIN' }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.getByText('JA')).toHaveStyle({ color: '#000000' });
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

test('the largest Factor\'s explanation renders from factorExplanation, not from the Edge line', async () => {
  renderCard({ entry: entry({ edge: { kind: 'result', text: 'Beat projection' }, factorExplanation: 'Matchup +3.5' }) });
  expect(await screen.findByTestId('decision-card-factor')).toHaveTextContent('Matchup +3.5');
});

test('no Factor tile when factorExplanation is null', async () => {
  renderCard({ entry: entry({ edge: { kind: 'factor', text: 'Matchup +3.5' }, factorExplanation: null }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-factor')).not.toBeInTheDocument();
});

// #1281: the point of the ticket - an injured player can show BOTH the
// injury tile and his largest Factor's explanation at once, which he could
// not before (the Factor tile was gated on the Edge line's own kind, and
// injury always outranks factor there, #1235's priority order).
test('the injury tile and the Factor tile render together, independent of which Edge kind won', async () => {
  renderCard({
    entry: entry({
      injuryStatus: 'Q',
      edge: { kind: 'injury', text: 'Questionable, hamstring' },
      factorExplanation: 'Matchup +3.5',
    }),
  });
  const injuryTile = await screen.findByTestId('decision-card-injury');
  expect(injuryTile).toHaveTextContent('Questionable');
  expect(injuryTile).toHaveTextContent('Questionable, hamstring');
  expect(await screen.findByTestId('decision-card-factor')).toHaveTextContent('Matchup +3.5');
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

// Formal review finding f1 (round 2): the row path (useSwapPlayers.js
// onRowClick) refuses to even start a swap on a locked, spent, or (in best
// ball) starting-slot opened player, before any target is chosen - bench
// options must never offer a move the row would refuse. For locked and
// spent, AC4's "disabled with the lock shown" is literally achievable: the
// list stays visible, every Swap is disabled, and the header's Locked/
// Spent indicator carries the lock for the opened player. Best ball keeps
// hiding, matching how the page hides the Start/sit panel entirely rather
// than disabling it. One red-tell per case the review named.
test('f1(a): a locked opened starter shows bench options, every Swap disabled, the lock shown via the header', async () => {
  const starter = entry({ locked: true });
  const bench = entry({ playerId: 2, name: 'Bench Guy', slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, bench] });
  expect(await screen.findByTestId('decision-card-locked')).toHaveTextContent('Locked');
  const section = await screen.findByTestId('decision-card-bench-options');
  expect(within(section).getByRole('button', { name: 'Swap in Bench Guy' })).toBeDisabled();
  // Not the per-candidate lock note - Bench Guy himself is not locked.
  expect(within(section).queryByTestId('decision-card-bench-option-lock')).not.toBeInTheDocument();
});

test('f1(c): best ball offers no bench options for a starting-slot opened player', async () => {
  const starter = entry();
  const bench = entry({ playerId: 2, name: 'Bench Guy', slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, bench], bestBall: true });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
});

test('f1(d): a spent opened player shows bench options, every Swap disabled, the state shown via the header', async () => {
  const starter = entry({ spent: true });
  const bench = entry({ playerId: 2, name: 'Bench Guy', slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, bench] });
  expect(await screen.findByTestId('decision-card-spent')).toHaveTextContent('Spent');
  const section = await screen.findByTestId('decision-card-bench-options');
  expect(within(section).getByRole('button', { name: 'Swap in Bench Guy' })).toBeDisabled();
});

// r1 (round 2): the header's own Bench button, not just bench options, must
// refuse a spent opened starter - CONTEXT.md's #627 rule, and a move the
// row path refuses outright.
test('r1: the header Bench button is disabled for a spent opened starter', async () => {
  renderCard({ entry: entry({ spent: true }) });
  expect(await screen.findByTestId('decision-card-bench-action')).toBeDisabled();
});

test('f1(b): Start never offers a slot whose current occupant is locked', async () => {
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const lockedStarter = entry({ playerId: 9, name: 'Locked Starter', slot: 'QB', locked: true });
  renderCard({ entry: bench, entries: [bench, lockedStarter] });
  expect(await screen.findByTestId('decision-card-start-action')).toBeDisabled();
});

// s2 (round 3): if movesToStart's own invariant is ever stale (the menu
// stayed open across a refetch) and it returns [] as its refusal, the
// CALLER must honour that refusal rather than handing an empty moves array
// to onSwap - which is performMove, a real PUT that would report "Lineup
// saved" for a write that changed nothing.
test('s2: an empty move list from movesToStart is never handed to onSwap', async () => {
  const onSwap = jest.fn();
  jest.spyOn(slotActions, 'movesToStart').mockReturnValue([]);
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const starter = entry({ playerId: 9, name: 'Starter', slot: 'QB' });
  renderCard({ entry: bench, entries: [bench, starter], onSwap });
  await userEvent.click(await screen.findByTestId('decision-card-start-action'));
  expect(onSwap).not.toHaveBeenCalled();
  // Teardown is the suite's own afterEach (jest.restoreAllMocks, round 4
  // finding t3) - a failure above must not leave this spy live for the
  // tests that follow.
});

// r2 (round 2): the same refusal for a SPENT occupant, not just a locked one.
test('r2: Start never offers a slot whose current occupant is spent', async () => {
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const spentStarter = entry({ playerId: 9, name: 'Spent Starter', slot: 'QB', spent: true });
  renderCard({ entry: bench, entries: [bench, spentStarter] });
  expect(await screen.findByTestId('decision-card-start-action')).toBeDisabled();
});

// r3 (round 2): the league-unsettled window reaches the card and refuses
// every write action on it, the same as the row path.
test('r3: an unsettled league disables Bench, Start and bench-option Swaps', async () => {
  const onSwap = jest.fn();
  const starter = entry();
  const bench = entry({ playerId: 2, name: 'Bench Guy', slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: starter, entries: [starter, bench], leagueUnsettled: true, onSwap });
  expect(await screen.findByTestId('decision-card-bench-action')).toBeDisabled();
  const section = await screen.findByTestId('decision-card-bench-options');
  expect(within(section).getByRole('button', { name: 'Swap in Bench Guy' })).toBeDisabled();
});

// r4 (round 2): Start into IR must not displace an occupant who isn't
// himself IR-eligible - the row path's own reciprocal-eligibility check.
test('r4: Start on an IR player does not offer to displace a non-IR-eligible starter', async () => {
  const irEntry = entry({ slot: 'IR', eligibleSlots: ['BENCH', 'IR', 'RB'] });
  const healthyStarter = entry({ playerId: 9, name: 'Healthy Starter', slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
  renderCard({ entry: irEntry, entries: [irEntry, healthyStarter] });
  expect(await screen.findByTestId('decision-card-start-action')).toBeDisabled();
});

// r5 (round 2): a slot type with two instances, one locked and one open,
// must still offer Start - a single find() used to disable the whole slot
// type if the locked instance was found first.
test('r5: Start still offers a slot type with one locked and one open instance', async () => {
  const onSwap = jest.fn();
  const bench = entry({ slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const lockedQb = entry({ playerId: 8, name: 'Locked QB', slot: 'QB', locked: true, eligibleSlots: ['BENCH', 'QB'] });
  const openQb = entry({ playerId: 9, name: 'Open QB', slot: 'QB', locked: false, eligibleSlots: ['BENCH', 'QB'] });
  renderCard({ entry: bench, entries: [bench, lockedQb, openQb], onSwap });
  await userEvent.click(await screen.findByTestId('decision-card-start-action'));
  expect(onSwap).toHaveBeenCalledWith([
    { playerId: 1, slot: 'QB' },
    { playerId: 9, slot: 'BENCH' },
  ]);
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

// AC6: "both close on Escape and on the close control" - formal review
// finding f7, previously untested (the suite's only Escape closed a menu).
test('Escape closes the card', async () => {
  const onClose = jest.fn();
  renderCard({ onClose });
  await screen.findByTestId('decision-card');
  await userEvent.keyboard('{Escape}');
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

// The header avatar carries the same headshot the Ledger row does, off the
// entry's own `photoUrl`, with the jersey-colour monogram as the fallback.
test('the header avatar renders the headshot when the entry carries a photoUrl', async () => {
  renderCard({ entry: entry({ photoUrl: 'https://cdn.example/josh-allen.png' }) });
  await screen.findByRole('heading', { name: 'Josh Allen' });
  expect(screen.getByTestId('decision-card-headshot')).toHaveAttribute('src', 'https://cdn.example/josh-allen.png');
  expect(screen.queryByText('JA')).toBeNull();
});
