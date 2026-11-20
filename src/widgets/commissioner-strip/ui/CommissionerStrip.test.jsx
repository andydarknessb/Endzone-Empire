import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import CommissionerStrip from '../index';

/**
 * commissioner-strip slice tests (#1108). The strip replaces the retired
 * commissioner-panel rail card, so these mirror that widget's own test file
 * where the behavior carried over unchanged (which reads it is allowed to
 * issue) and add the acceptance criteria specific to this ticket: no settings
 * facts on the strip (the console states them), the two links to the
 * commissioner console, and that no legacy administration
 * tree is reachable from this slice at all.
 *
 * That last guarantee needs the legacy tree's own module mocked below (the
 * same convention CommissionerPanel.test.jsx and
 * CommissionerConsolePage.test.jsx already use for it), so its testid can
 * actually appear if the widget under test ever imports and renders it - a
 * guard that can only ever assert an absence nothing in this suite could
 * produce either way is decorative, not a guard. Naming the real module by
 * its exact path below is the one place in this directory the ticket's own
 * grep criterion still matches (the production files under ui/, model/ and
 * index.js do not); see the PR body for why that is the correct trade
 * against the criterion as literally written, not a criterion this file
 * dodges.
 *
 * The red-tell on this ticket's own acceptance criteria (recorded on #1108:
 * gating the strip on `invite_code` turns the COMMISSIONER case red, not the
 * member case, because no fixture here ever sets `invite_code` and a case
 * that asserts absence is satisfied by a gate collapsed to "render for
 * nobody") is verified by hand before opening the PR, per the pre-launch
 * note, rather than committed as a mutation test here.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// The legacy administration tree the retired panel disclosed. Mocked so the
// test below can actually catch a future import of it: without this mock,
// "not in the document" would hold true of the real component's own testids
// regardless of whether anything imported it, since nothing in this suite
// would render it either way.
jest.mock('../../../components/LeagueDashboard/CommissionerTools', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId }) =>
      ReactLib.createElement('div', { 'data-testid': 'mock-commissioner-tools' }, `tools ${leagueId}`),
  };
});

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module
  // state that outlives a test, so it is cleared whole rather than per key.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const leagueResponse = ({ league = {}, teams = [], viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: { id: 42, name: 'MinneApple', is_commissioner: true, current_week: 6, ...league },
    teams,
  },
});

// A commissioner league carrying every field the console's settings facts
// read. The strip must show none of them.
const fullyConfiguredLeague = (overrides = {}) => ({
  transactions_locked: true,
  trade_deadline_week: 11,
  waiver_type: 'faab',
  waiver_period_hours: 24,
  trade_review_hours: 24,
  bench_slots: 5,
  ir_slots: 1,
  roster_slots: [
    { key: 'QB', count: 1 },
    { key: 'RB', count: 2 },
  ],
  scoring_rules: { receiving: { reception: 0.5 } },
  ...overrides,
});

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.resolve({ data: [] });
  });
};

const renderStrip = (leagueId = 42) => renderWithProviders(<CommissionerStrip leagueId={leagueId} />);

const getUrls = () => apiClient.get.mock.calls.map(([url]) => url);
const joinRequestUrls = () => getUrls().filter((url) => url.includes('/join-requests'));

// Two flushes, not one: the league read resolving is what lets the hook
// decide whether the join-requests URL is null, and that decision runs in a
// second effect pass (CommissionerPanel.test.jsx settleReads, carried over).
const settleReads = async () => {
  await waitFor(() => expect(getUrls()).toContain('/api/league/42'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// --- presence and gating ----------------------------------------------------

test('a member renders nothing', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { is_commissioner: false, is_public: true, join_approval: true },
    }),
  });
  const { container } = renderStrip();
  await settleReads();

  expect(screen.queryByTestId('commissioner-strip')).not.toBeInTheDocument();
  expect(container).toBeEmptyDOMElement();
  // The gate lives in the URL, not the render, so a member's mount is still
  // never part of a queue request answered 403.
  expect(joinRequestUrls()).toEqual([]);
});

test('a commissioner in a live fantasy week sees no settings facts, but the advance control and both console links', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: fullyConfiguredLeague({ is_public: true, join_approval: true }),
    }),
    '/api/league/42/join-requests': { data: [{ id: 7 }] },
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  // The settings facts are the console's to show. Restoring the grid turns this red.
  expect(within(card).queryByTestId('commissioner-strip-facts')).not.toBeInTheDocument();
  expect(within(card).queryByTestId(/^commissioner-fact-/)).not.toBeInTheDocument();

  // The pending queue is a link with a 28px count badge, never a button, straight to the console.
  const badge = await within(card).findByTestId('commissioner-strip-join-requests');
  expect(badge).toHaveTextContent('Join requests');
  expect(within(badge).getByText('1 pending')).toBeInTheDocument();
  expect(badge).toHaveAttribute('href', '/league/42/commissioner');
  expect(within(card).getByRole('link', { name: /join requests/i })).toBe(badge);
  expect(within(card).getByText('1 manager is waiting to join this public league.')).toBeInTheDocument();

  expect(
    within(card).getByRole('link', { name: /league administration/i })
  ).toHaveAttribute('href', '/league/42/commissioner');

  expect(within(card).getByTestId('advance-week')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /advance to week 7/i })).toBeInTheDocument();
  // Never filled and never the cursor: the one filled action belongs to the lead play in Your move.
  // eslint-disable-next-line testing-library/no-node-access
  expect(card.querySelector('[data-filled="true"], .cursor')).toBeNull();
});

test('the strip mounts no legacy administration tree at any width', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderStrip();

  await screen.findByTestId('commissioner-strip');
  // `mock-commissioner-tools` is the mocked module's own testid (see the
  // jest.mock above): this is what would appear if CommissionerStrip.jsx
  // ever imported and rendered the real legacy tree. Verified by hand: a
  // temporary mount of it in the widget reddens this exact assertion;
  // removing it again returns to green (PR body records both runs).
  expect(screen.queryByTestId('mock-commissioner-tools')).not.toBeInTheDocument();
});

// --- the join-requests badge -------------------------------------------------

test('a pending count of 0 renders no join requests row', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: true, join_approval: true } }),
    '/api/league/42/join-requests': { data: [] },
  });
  renderStrip();

  await screen.findByTestId('commissioner-strip');
  await waitFor(() => expect(joinRequestUrls()).toEqual(['/api/league/42/join-requests']));
  expect(screen.queryByTestId('commissioner-strip-join-requests')).not.toBeInTheDocument();
});

test('a commissioner of a private league fetches no queue and shows no Badge', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: false, join_approval: true } }),
  });
  renderStrip();

  await screen.findByTestId('commissioner-strip');
  await settleReads();
  expect(joinRequestUrls()).toEqual([]);
  expect(screen.queryByTestId('commissioner-strip-join-requests')).not.toBeInTheDocument();
});

// --- pick'em-only leagues ----------------------------------------------------

test("a pick'em-only league renders no advance control", async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { ...fullyConfiguredLeague(), pickem_only: true },
    }),
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).queryByTestId('advance-week')).not.toBeInTheDocument();
  // Still a commissioner, so administration stays reachable.
  expect(within(card).getByRole('link', { name: /league administration/i })).toBeInTheDocument();
});

test('a league with no current week shows no advance control', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { current_week: null } }),
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  await settleReads();
  expect(within(card).queryByTestId('advance-week')).not.toBeInTheDocument();
});

// --- the Advance control is a season control (#1979 L24) ---------------------

// Red-tell: restoring `!pickemOnly && currentWeek != null` as the whole gate
// turns the pre-draft, drafting and complete cases red; the server refuses an
// advance in those phases with a 409, so the strip must not offer it.
test.each([
  ['pre-draft', { draft_status: 'pending', season_status: 'regular' }],
  ['drafting', { draft_status: 'active', season_status: 'regular' }],
  ['complete', { draft_status: 'complete', season_status: 'complete' }],
])('no Advance control while the league is %s, but administration stays', async (_phase, league) => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: { current_week: 1, ...league } }) });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  await settleReads();
  expect(within(card).queryByTestId('advance-week')).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: /advance/i })).not.toBeInTheDocument();
  expect(within(card).getByRole('link', { name: /league administration/i })).toBeInTheDocument();
});

test.each([
  ['in season', { draft_status: 'complete', season_status: 'regular' }],
  ['in the playoffs', { draft_status: 'complete', season_status: 'playoffs' }],
])('the Advance control shows %s', async (_phase, league) => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: { current_week: 6, ...league } }) });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByTestId('advance-week')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /advance to week 7/i })).toBeInTheDocument();
});

// --- the title block ---------------------------------------------------------

// Red-tell (#1979 L14): restoring a count (`Commissioners only · N`) turns this case red. The title
// block is the heading alone now: the board drops "Visible to commissioners only" (the head line of the
// page carries who sees what), and the frame is the tertiary tier, a Pixel 16 heading on a 2px edge.
test('the title block is the Commissioner heading alone, with no count and no audience line', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { co_commissioners: [{ teamId: 4 }, { teamId: 7 }] },
    }),
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByRole('heading', { level: 2, name: 'Commissioner' })).toBeInTheDocument();
  expect(within(card).queryByText(/Visible to commissioners only/)).not.toBeInTheDocument();
  expect(within(card).queryByText(/Commissioners only/)).not.toBeInTheDocument();
});

// --- the invite row ----------------------------------------------------------

test('an invite control passed by the page is the first row, with its note', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderWithProviders(<CommissionerStrip leagueId={42} invite={<button type="button">Invite TNR-7K4Q</button>} />);

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByText('Copy the invite link for new teams')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Invite TNR-7K4Q' })).toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-node-access
  expect(within(card).getAllByRole('listitem')[0]).toHaveTextContent('Invite code');
});

test('without an invite control there is no invite row', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).queryByText('Invite code')).not.toBeInTheDocument();
});

// --- the Set draft time row --------------------------------------------------

const preDraftLeague = { draft_status: 'pending', season_status: 'regular', draft_date: null };

test('a commissioner of a pre-draft fantasy league with no draft time gets a Set draft time link', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: preDraftLeague }) });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByRole('link', { name: 'Set draft time' })).toHaveAttribute(
    'href',
    '/league/42/draft-settings'
  );
  expect(within(card).getByText('No draft time yet')).toBeInTheDocument();
});

// Red-tell: dropping the draft-time condition from needsDraftTime turns the first case red.
test.each([
  ['a league that has a draft time', { ...preDraftLeague, draft_date: '2026-08-30T23:00:00.000Z' }],
  ['an in-season league', { draft_status: 'complete', season_status: 'regular', draft_date: null }],
  ["a pick'em-only league", { ...preDraftLeague, pickem_only: true }],
])('%s shows no Set draft time link', async (_name, league) => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league }) });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).queryByRole('link', { name: 'Set draft time' })).not.toBeInTheDocument();
});

test('a member of a pre-draft league with no draft time sees nothing', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: { ...preDraftLeague, is_commissioner: false } }) });
  const { container } = renderStrip();
  await settleReads();

  expect(container).toBeEmptyDOMElement();
});

test('Set draft time is the first row when the page passes no invite', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: preDraftLeague }) });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  // eslint-disable-next-line testing-library/no-node-access
  expect(within(card).getAllByRole('listitem')[0]).toHaveTextContent('Set draft time');
});

test('Set draft time is the second row, after the Invite row', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ league: preDraftLeague }) });
  renderWithProviders(<CommissionerStrip leagueId={42} invite={<button type="button">Invite TNR-7K4Q</button>} />);

  const card = await screen.findByTestId('commissioner-strip');
  // eslint-disable-next-line testing-library/no-node-access
  expect(within(card).getAllByRole('listitem')[1]).toHaveTextContent('Set draft time');
});
