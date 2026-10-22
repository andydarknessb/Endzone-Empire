import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { myTeam } from '../model/decisionContext';
import { ESPN_FACTS } from './decisionCardTestFixtures';

/**
 * The single-player body's three tabs (#2489, spec #2488): Overview, Game log and Stats, as ARIA tabs under
 * the action row. The sections themselves are covered where they always were; this file covers the tablist.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/card?')) return Promise.resolve({ data: { ...ESPN_FACTS, ...CARD } });
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
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
  projectedPoints: 24.3,
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

const season = (year, over = {}) => ({
  season: year,
  games: 10,
  points: 150,
  pointsPerGame: 15,
  posRank: 5,
  posRankOf: 40,
  adp: null,
  weeks: [{ week: 3, kind: 'actual', points: 10 }],
  log: [{ week: 3, opponent: 'KC', statLine: { passYds: 300 }, points: 22 }],
  ...over,
});

// Two seasons, so the Season pick renders; a decision so the strip does.
const CARD = {
  decision: { projWeek: { week: 4, points: 12 } },
  seasonEnd: 17,
  seasons: [season(2026), season(2025)],
};

const OVERVIEW_ONLY = ['decision-card-strip-section', 'weekly-points-bars'];
const OTHER_TABS = ['decision-card-season-summary-section', 'decision-card-season-pick', 'decision-card-gamelog-section'];

function CardHarness({ playerIds }) {
  const [current, setCurrent] = React.useState(1);
  const [open, setOpen] = React.useState(true);
  return (
    <>
      {/* Outside the card so a test can close and reopen it without remounting the harness. */}
      <button type="button" data-testid="toggle-open" onClick={() => setOpen((o) => !o)}>toggle</button>
    <PlayerDecisionCard
      open={open}
      onClose={jest.fn()}
      entry={entry({ playerId: current, name: current === 1 ? 'Josh Allen' : 'Lamar Jackson' })}
      leagueId={1}
      week={4}
      context={myTeam({
        managed: true,
        onSwap: jest.fn(),
        onRequestDrop: jest.fn(),
        canDropEntry: () => true,
        entries: [entry()],
        playerIds,
        onNavigate: setCurrent,
      })}
    />
    </>
  );
}

const renderCard = (props = {}) => renderWithProviders(<CardHarness playerIds={[1, 2]} {...props} />);

const tab = (name) => screen.getByRole('tab', { name });

test('one tablist named "Player card sections" holds Overview, Game log and Stats, Overview selected on open', async () => {
  renderCard();
  const list = await screen.findByRole('tablist', { name: 'Player card sections' });
  expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Game log', 'Stats']);
  expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Game log')).toHaveAttribute('aria-selected', 'false');
  expect(tab('Stats')).toHaveAttribute('aria-selected', 'false');
  // Roving tabindex: only the selected tab is in the tab order.
  expect(tab('Overview')).toHaveAttribute('tabindex', '0');
  expect(tab('Stats')).toHaveAttribute('tabindex', '-1');
});

test('Overview shows the strip and the weekly bars and none of the Game log or Stats sections', async () => {
  renderCard();
  await screen.findByTestId('decision-card-strip-section');
  OVERVIEW_ONLY.forEach((id) => expect(screen.getByTestId(id)).toBeInTheDocument());
  OTHER_TABS.forEach((id) => expect(screen.queryByTestId(id)).not.toBeInTheDocument());
});

test('activating Game log shows the Season pick and the game log; Stats shows the season summary', async () => {
  renderCard();
  await userEvent.click(await screen.findByRole('tab', { name: 'Game log' }));
  expect(screen.getByTestId('decision-card-season-pick')).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-gamelog-section')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-strip-section')).not.toBeInTheDocument();

  await userEvent.click(tab('Stats'));
  expect(await screen.findByTestId('decision-card-season-summary-section')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-gamelog-section')).not.toBeInTheDocument();
});

test('Left, Right, Home and End move and activate the tab and never change the player', async () => {
  renderCard();
  await screen.findByTestId('decision-card-strip-section');
  const title = screen.getByRole('heading', { level: 2 });
  expect(title).toHaveTextContent('Josh Allen');

  tab('Overview').focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(tab('Game log')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Game log')).toHaveFocus();
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Josh Allen');

  await userEvent.keyboard('{End}');
  expect(tab('Stats')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Stats')).toHaveFocus();

  await userEvent.keyboard('{ArrowLeft}');
  expect(tab('Game log')).toHaveAttribute('aria-selected', 'true');

  await userEvent.keyboard('{Home}');
  expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Overview')).toHaveFocus();
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Josh Allen');
});

test('Left and Right off the tablist still walk to the previous and next player', async () => {
  renderCard();
  await screen.findByTestId('decision-card-strip-section');
  await userEvent.keyboard('{ArrowRight}');
  expect(await screen.findByRole('heading', { name: 'Lamar Jackson', level: 2 })).toBeInTheDocument();
});

test('the chosen tab survives Next, and closing then reopening starts on Overview', async () => {
  renderCard();
  await userEvent.click(await screen.findByRole('tab', { name: 'Stats' }));
  await userEvent.click(screen.getByTestId('decision-card-next'));
  expect(await screen.findByRole('heading', { name: 'Lamar Jackson', level: 2 })).toBeInTheDocument();
  expect(tab('Stats')).toHaveAttribute('aria-selected', 'true');

  await userEvent.click(screen.getByTestId('toggle-open'));
  await waitFor(() => expect(screen.queryByRole('tablist')).not.toBeInTheDocument());
  await userEvent.click(screen.getByTestId('toggle-open'));
  expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});

test('compare mode renders no tablist and both compare panels', async () => {
  const a = entry();
  const b = entry({ playerId: 2, name: 'Lamar Jackson' });
  renderWithProviders(
    <PlayerDecisionCard
      open
      onClose={jest.fn()}
      entry={a}
      leagueId={1}
      week={4}
      context={myTeam({
        managed: true,
        onSwap: jest.fn(),
        onRequestDrop: jest.fn(),
        canDropEntry: () => true,
        entries: [a, b],
        compareWith: 2,
      })}
    />
  );
  expect(await screen.findByTestId('decision-card-compare-panel-1')).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-compare-panel-2')).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

test('each tab controls a tabpanel that is labelled by that tab', async () => {
  renderCard();
  await screen.findByRole('tablist', { name: 'Player card sections' });
  const panels = screen.getAllByRole('tabpanel', { hidden: true });
  expect(panels).toHaveLength(3);
  screen.getAllByRole('tab').forEach((t) => {
    const panel = panels.find((p) => p.id === t.getAttribute('aria-controls'));
    expect(panel).toBeDefined();
    expect(panel).toHaveAttribute('aria-labelledby', t.id);
  });
});
