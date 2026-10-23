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

// #2491: the Game log tab's 18-week table and the Stats tab's season totals.
describe('Game log table and Season totals (#2491)', () => {
  const RUSH = [35, 64, 74, 48, 52, 76];
  const PTS = [3.4, 6.5, 9.6, 11.0, 5.2, 7.6];
  const played = (week) => ({ week, kind: 'actual', points: PTS[week - 1], opponent: 'DEN' });
  const weeks = Array.from({ length: 18 }, (_, i) => {
    const week = i + 1;
    if (week <= 6) {
      return {
        ...played(week),
        ...(week === 1 ? { projected: 9.13 } : null),
        ...(week === 3 ? { opponentRankVsPosition: { rank: 29, of: 32 } } : null),
      };
    }
    if (week === 9) return { week, kind: 'bye' };
    if (week === 11) return { week, kind: 'unavailable', reason: 'out' };
    return { week, kind: 'projected', points: 12, opponent: 'MIA' };
  });
  const log = RUSH.map((rushingYards, i) => ({
    week: i + 1,
    opponent: i === 1 ? 'LAC' : 'DEN',
    points: PTS[i],
    statLine: { rushingYards, usageCarries: 10 + i, usageTargets: 2 },
  }));
  const gameLogCard = (over = {}) => ({
    decision: { projWeek: { week: 7, points: 12 } },
    seasonEnd: 17,
    seasons: [season(2026, { weeks, log, ...over })],
  });
  const showCard = (card) => {
    apiClient.get.mockImplementation((url) => (
      url.includes('/card?') ? Promise.resolve({ data: { ...ESPN_FACTS, ...card } }) : Promise.reject(new Error(url))
    ));
    renderCard();
  };
  const openLog = async (card) => {
    showCard(card);
    await userEvent.click(await screen.findByRole('tab', { name: 'Game log' }));
    return screen.findByTestId('decision-card-game-log');
  };
  const bodyRows = (table) => within(table).getAllByRole('row').slice(1);
  const headers = (table) => within(table).getAllByRole('columnheader').map((h) => h.textContent);
  // Wk is the row header, so a column's cell index is one less than its header's.
  const cell = (table, row, label) => within(row).getAllByRole('cell')[headers(table).indexOf(label) - 1];

  test('draws one row per week, 1 to 18, with the stat columns after FPTS', async () => {
    const table = await openLog(gameLogCard());
    expect(headers(table)).toEqual(['Wk', 'Opp', 'Proj', 'FPTS', 'Rush Att', 'Tgt', 'Rush Yds']);
    const rows = bodyRows(table);
    expect(rows).toHaveLength(18);
    expect(rows.map((r) => Number(within(r).getByRole('rowheader').textContent))).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1)
    );
  });

  test('a bye row reads Bye and an unavailable row its reason label', async () => {
    const table = await openLog(gameLogCard());
    const rows = bodyRows(table);
    expect(cell(table, rows[8], 'Opp')).toHaveTextContent('Bye');
    expect(cell(table, rows[10], 'Opp')).toHaveTextContent('out');
  });

  test('Opp prefers the log row, shows the rank, and a line under the table words the rank', async () => {
    const table = await openLog(gameLogCard());
    const rows = bodyRows(table);
    expect(cell(table, rows[1], 'Opp')).toHaveTextContent('LAC');
    expect(cell(table, rows[2], 'Opp')).toHaveTextContent('DEN (29th)');
    expect(cell(table, rows[6], 'Opp')).toHaveTextContent('MIA');
    expect(screen.getByText('Opp rank: 1st allows the fewest points to QBs')).toBeInTheDocument();
  });

  test('Proj reads projected on an actual row, points on a projected one, and a dash otherwise', async () => {
    const table = await openLog(gameLogCard());
    const rows = bodyRows(table);
    expect(cell(table, rows[0], 'Proj')).toHaveTextContent('9.13');
    expect(cell(table, rows[1], 'Proj')).toHaveTextContent('-');
    expect(cell(table, rows[7], 'Proj')).toHaveTextContent('12.00');
    expect(cell(table, rows[7], 'FPTS')).toHaveTextContent('-');
  });

  test('Rush Att and Tgt read the usage keys', async () => {
    const table = await openLog(gameLogCard());
    expect(cell(table, bodyRows(table)[2], 'Rush Att')).toHaveTextContent('12');
    expect(cell(table, bodyRows(table)[2], 'Tgt')).toHaveTextContent('2');
  });

  test('without carries or targets in any row the two columns are left out', async () => {
    const bare = log.map((l) => ({ ...l, statLine: { rushingYards: l.statLine.rushingYards } }));
    const table = await openLog(gameLogCard({ log: bare }));
    expect(headers(table)).toEqual(['Wk', 'Opp', 'Proj', 'FPTS', 'Rush Yds']);
  });

  test('an above-average cell says so to a screen reader, and the legend renders', async () => {
    const table = await openLog(gameLogCard());
    const rows = bodyRows(table);
    expect(cell(table, rows[2], 'FPTS')).toHaveTextContent("above this player's average");
    expect(cell(table, rows[0], 'FPTS')).toHaveTextContent("below this player's average");
    expect(cell(table, rows[1], 'FPTS')).not.toHaveTextContent('average');
    expect(cell(table, rows[2], 'Proj')).not.toHaveTextContent('average');
    expect(screen.getByText("Compared to this player's average")).toBeInTheDocument();
  });

  test('the current week of the current season carries the Current week arrow', async () => {
    const table = await openLog(gameLogCard());
    const mark = within(table).getByRole('img', { name: 'Current week' });
    expect(within(bodyRows(table)[6]).getByRole('rowheader')).toContainElement(mark);
  });

  test('Season totals sums each stat column over the season\'s log rows', async () => {
    showCard(gameLogCard({ log: [log[0], log[1]] }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Stats' }));
    const table = await screen.findByTestId('decision-card-seasons');
    expect(screen.getByRole('heading', { name: 'Season totals' })).toBeInTheDocument();
    expect(headers(table)).toEqual(['Season', 'G', 'FPTS', 'FPTS/G', 'Pos rank', 'ADP', 'Rush Att', 'Tgt', 'Rush Yds']);
    const row = bodyRows(table)[0];
    expect(within(row).getByRole('rowheader')).toHaveTextContent('2026to date');
    expect(cell(table, row, 'Rush Yds')).toHaveTextContent('99');
    expect(cell(table, row, 'G')).toHaveTextContent('10');
    expect(cell(table, row, 'FPTS/G')).toHaveTextContent('15.0');
  });
});
