import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import RecentActivity from '../index';

/**
 * recent-activity slice tests (ticket #1105). The widget's one read is the
 * league transactions endpoint, via `entities/activity`'s
 * `useLeagueTransactions`, itself over the shared `useEndpoint` -
 * `apiClient.get` is the whole seam to mock (mirrors
 * useLeagueTransactions.test.js and every other widget slice test).
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// useMediaQuery needs window.matchMedia, which jsdom does not implement.
// `mobile` flips the one 'max-width' query the widget's `down('md')` check
// resolves to; every other query (e.g. prefers-reduced-motion, read by MUI
// internals) answers false. Mirrors ScoringFeed.test.jsx's own mock.
let mobile;
beforeEach(() => {
  mobile = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query) ? mobile : false,
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
  jest.clearAllMocks();
});

const NOW = new Date('2026-09-09T18:00:00.000Z').getTime();

// An 8-row fixture spanning every badge-bearing type plus a commissioner
// (team-less) row, each with a distinct, assertable sentence and timestamp.
const row = (overrides) => ({
  id: overrides.id,
  type: overrides.type,
  // `'team' in overrides`, not `??`: a commissioner fixture passes
  // `team: null` deliberately (a row with no Team), and `??` would silently
  // replace that null with the default.
  team_name: 'team' in overrides ? overrides.team : 'MyBallsHurts',
  player_name: overrides.player ?? 'Justin Jefferson',
  detail: overrides.detail ?? {},
  created_at: new Date(NOW - overrides.agoMs).toISOString(),
});

const EIGHT_ROWS = [
  row({ id: 1, type: 'add', team: 'MyBallsHurts', player: 'Tank Bigsby', agoMs: 2 * 60 * 60 * 1000 }),
  row({ id: 2, type: 'drop', team: 'Terrific T', player: 'Kenny Pickett', agoMs: 3 * 60 * 60 * 1000 }),
  row({
    id: 3,
    type: 'waiver',
    team: 'Sunday Scaries',
    player: 'Rashid Shaheed',
    detail: { bid: 12, droppedPlayerId: 9, },
    agoMs: 5 * 60 * 60 * 1000,
  }),
  row({
    id: 4,
    type: 'trade',
    team: 'Lakeshore Lions',
    detail: {
      proposingTeamId: 3,
      receivingTeamName: 'Iron Curtain',
      items: [
        { fromTeamId: 3, toTeamId: 4, playerName: 'Josh Jacobs', playerId: 11 },
        { fromTeamId: 4, toTeamId: 3, playerName: 'David Montgomery', playerId: 12 },
      ],
    },
    agoMs: 26 * 60 * 60 * 1000,
  }),
  row({ id: 5, type: 'commissioner', team: null, agoMs: 30 * 60 * 60 * 1000 }),
  row({ id: 6, type: 'add', team: 'Iron Curtain', player: 'Minnesota Vikings D/ST', agoMs: 4 * 24 * 60 * 60 * 1000 }),
  row({ id: 7, type: 'waiver', team: 'Prime Time', player: 'J.K. Dobbins', agoMs: 5 * 24 * 60 * 60 * 1000 }),
  row({ id: 8, type: 'drop', team: 'End Zone Elite', player: 'Zach Wilson', agoMs: 6 * 24 * 60 * 60 * 1000 }),
];

const mockGet = (result) => {
  apiClient.get.mockImplementation(() => {
    if (result && result.reject) return Promise.reject(result.reject);
    if (result && result.pending) return new Promise(() => {});
    return Promise.resolve(result);
  });
};

const renderWidget = (props = {}) => renderWithProviders(<RecentActivity leagueId={42} now={NOW} {...props} />);

test('the loading state holds eight skeleton rows and marks the card busy', async () => {
  mockGet({ pending: true });
  renderWidget();

  const card = await screen.findByTestId('recent-activity');
  expect(card).toHaveAttribute('aria-busy', 'true');
  expect(await screen.findAllByTestId('recent-activity-skeleton-row')).toHaveLength(8);
});

test('an eight-row fixture renders eight rows with the correct Badge variant per type, Team names and sentences', async () => {
  mockGet({ data: EIGHT_ROWS });
  renderWidget();

  const card = await screen.findByTestId('recent-activity');
  await screen.findAllByTestId('recent-activity-row');
  expect(card).toHaveAttribute('aria-busy', 'false');

  const rows = screen.getAllByTestId('recent-activity-row');
  expect(rows).toHaveLength(8);
  expect(screen.getByText('8')).toBeInTheDocument(); // the card's count

  const byVariant = {
    add: 'success',
    drop: 'danger',
    trade: 'live',
    waiver: 'neutral',
  };

  Object.entries(byVariant).forEach(([type, variant]) => {
    const typeRow = rows.find((r) => r.getAttribute('data-type') === type);
    expect(within(typeRow).getByTestId('badge')).toHaveAttribute('data-variant', variant);
  });

  // Team names and sentences render verbatim from the entity's read model.
  expect(within(rows[0]).getByTestId('recent-activity-team')).toHaveTextContent('MyBallsHurts');
  expect(within(rows[0]).getByTestId('recent-activity-sentence')).toHaveTextContent('added Tank Bigsby');
  expect(within(rows[1]).getByTestId('recent-activity-sentence')).toHaveTextContent('dropped Kenny Pickett');
});

test('a commissioner row reads "Commissioner" and the warning variant', async () => {
  mockGet({ data: EIGHT_ROWS });
  renderWidget();

  const rows = await screen.findAllByTestId('recent-activity-row');
  const commissionerRow = rows.find((r) => r.getAttribute('data-type') === 'commissioner');

  expect(within(commissionerRow).getByTestId('recent-activity-team')).toHaveTextContent('Commissioner');
  const badge = within(commissionerRow).getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'warning');
  expect(badge).toHaveTextContent('Settings');
});

test('a row\'s relative time follows the widget\'s own helper (2h ago / Yesterday)', async () => {
  mockGet({ data: EIGHT_ROWS });
  renderWidget();

  const rows = await screen.findAllByTestId('recent-activity-row');
  const addRow = rows.find((r) => r.getAttribute('data-type') === 'add' && within(r).queryByText('added Tank Bigsby'));
  expect(within(addRow).getByTestId('recent-activity-time')).toHaveTextContent('2h ago');

  const commissionerRow = rows.find((r) => r.getAttribute('data-type') === 'commissioner');
  expect(within(commissionerRow).getByTestId('recent-activity-time')).toHaveTextContent('Yesterday');
});

test('the heading level follows headingLevel (ADR 0021)', async () => {
  mockGet({ data: EIGHT_ROWS });
  renderWidget({ headingLevel: 3 });

  await screen.findAllByTestId('recent-activity-row');
  expect(screen.getByRole('heading', { level: 3, name: 'Recent activity' })).toBeInTheDocument();
});

test('the tail links to /league/42/activity', async () => {
  mockGet({ data: EIGHT_ROWS });
  renderWidget();

  await screen.findAllByTestId('recent-activity-row');
  expect(screen.getByRole('link', { name: 'All activity' })).toHaveAttribute('href', '/league/42/activity');
});

test('below the md breakpoint the card shows five rows, not eight', async () => {
  mobile = true;
  mockGet({ data: EIGHT_ROWS });
  renderWidget();

  await screen.findAllByTestId('recent-activity-row');
  expect(screen.getAllByTestId('recent-activity-row')).toHaveLength(5);
  expect(screen.getByText('5')).toBeInTheDocument(); // the card's count follows what's shown
});

test('below the md breakpoint the loading skeleton also caps at five rows, not eight', async () => {
  // The skeleton follows the same breakpoint cap as the loaded rows (should-
  // fix from the formal review on PR #1121): 8 placeholders collapsing to 5
  // real rows the instant a mobile read lands would itself be the re-flow
  // the card's docblock says this design avoids.
  mobile = true;
  mockGet({ pending: true });
  renderWidget();

  expect(await screen.findAllByTestId('recent-activity-skeleton-row')).toHaveLength(5);
});

test('an empty response renders the empty-state sentence', async () => {
  mockGet({ data: [] });
  renderWidget();

  expect(await screen.findByTestId('recent-activity-empty')).toHaveTextContent('No moves yet this season.');
  expect(screen.queryByTestId('recent-activity-row')).not.toBeInTheDocument();
});

// #1134: `recap` is a league-wide row, teamless like commissioner, but must
// not read as "Commissioner" - its Team column stays empty.
test('a recap row renders the recap sentence, the Recap chip, and an empty Team column', async () => {
  mockGet({
    data: [row({ id: 9, type: 'recap', team: null, detail: { season: 2026, week: 4 }, agoMs: 60 * 60 * 1000 })],
  });
  renderWidget();

  const rows = await screen.findAllByTestId('recent-activity-row');
  expect(rows).toHaveLength(1);
  const recapRow = rows[0];

  expect(within(recapRow).getByTestId('recent-activity-sentence')).toHaveTextContent(
    'Week 4 recap published'
  );
  expect(within(recapRow).getByTestId('recent-activity-team')).toHaveTextContent('');
  const badge = within(recapRow).getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'neutral');
  expect(badge).toHaveTextContent('Recap');
});

// #1144: a stat_correction row is a teamless NFL data correction, not a
// commissioner action - ratifying #1134's own generalisation with the
// pinning test it shipped without. Reads `teamLabel` off the entity's read
// model; the widget makes no transaction-type decision of its own.
test('a teamless stat_correction row renders a blank Team column, not "Commissioner"', async () => {
  mockGet({
    data: [
      row({
        id: 10,
        type: 'stat_correction',
        team: null,
        detail: { week: 4, changes: [{ matchupId: 9 }] },
        agoMs: 60 * 60 * 1000,
      }),
    ],
  });
  renderWidget();

  const rows = await screen.findAllByTestId('recent-activity-row');
  expect(rows).toHaveLength(1);
  const statCorrectionRow = rows[0];

  expect(within(statCorrectionRow).getByTestId('recent-activity-team')).toHaveTextContent('');
  const badge = within(statCorrectionRow).getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'neutral');
  expect(badge).toHaveTextContent('Stat correction');
});

test('a failed read renders one compact alert sentence and no rows', async () => {
  mockGet({ reject: { response: { status: 500 } } });
  renderWidget();

  const alert = await screen.findByTestId('recent-activity-error');
  expect(alert).toHaveAttribute('role', 'alert');
  expect(alert).toHaveTextContent('We could not load recent activity right now.');
  expect(screen.queryByTestId('recent-activity-row')).not.toBeInTheDocument();
});
