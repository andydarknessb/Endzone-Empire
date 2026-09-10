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
 * issue, which facts it states from a given league row) and add the
 * acceptance criteria specific to this ticket: exactly five fact tiles, the
 * two links to the commissioner console, and that no legacy administration
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

// A commissioner league carrying every field the five-tile fact grid reads
// (plus roster/scoring, which the strip must NOT show - those belong to the
// console).
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

const teamsWithLocks = (n, lockedCount) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Team ${i + 1}`,
    locked: i < lockedCount,
  }));

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

const fact = (key) => screen.getByTestId(`commissioner-fact-${key}`);

// --- presence and gating ----------------------------------------------------

test('a member renders nothing', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { is_commissioner: false, is_public: true, join_approval: true },
      teams: teamsWithLocks(12, 2),
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

test('a commissioner sees five fact tiles, both console links and the advance control for a live fantasy week', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: fullyConfiguredLeague({ is_public: true, join_approval: true }),
      teams: teamsWithLocks(12, 2),
    }),
    '/api/league/42/join-requests': { data: [{ id: 7 }] },
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  const facts = within(card).getByTestId('commissioner-strip-facts');
  expect(within(facts).getAllByTestId(/^commissioner-fact-/)).toHaveLength(5);
  expect(fact('transactions')).toHaveTextContent('Locked');
  expect(fact('teams-locked')).toHaveTextContent('2 of 12');
  expect(fact('trade-deadline')).toHaveTextContent('Week 11');
  expect(fact('waivers')).toHaveTextContent('FAAB · 24h');
  expect(fact('trade-review')).toHaveTextContent('24h');
  // The roster and scoring facts belong to the console, not the strip.
  expect(screen.queryByTestId('commissioner-fact-roster')).not.toBeInTheDocument();
  expect(screen.queryByTestId('commissioner-fact-scoring')).not.toBeInTheDocument();

  const badge = await within(card).findByTestId('commissioner-strip-join-requests');
  expect(badge).toHaveTextContent('Join requests · 1');
  expect(badge).toHaveAttribute('href', '/league/42/commissioner');
  // `clickable` routes the Chip through ButtonBase (not the bare `component`
  // it would otherwise render as), which is what carries the theme's
  // MuiButtonBase keyboard focus-visible ring, hover state and cursor to
  // this link. Without it the class below is absent and the link's focus
  // becomes visually silent.
  expect(badge.className).toMatch(/MuiChip-clickable/);
  // Still a real anchor (implicit `link` role from `href`), reachable the
  // same way as a moment ago, `clickable` only changes what carries it.
  expect(within(card).getByRole('link', { name: /join requests/i })).toBe(badge);

  expect(
    within(card).getByRole('link', { name: /league administration/i })
  ).toHaveAttribute('href', '/league/42/commissioner');

  expect(within(card).getByTestId('advance-week')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /advance to week 7/i })).toBeInTheDocument();
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

test('a pending count of 0 renders no Badge', async () => {
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

test("a pick'em-only league renders no facts and no advance control", async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { ...fullyConfiguredLeague(), pickem_only: true },
      teams: teamsWithLocks(8, 0),
    }),
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).queryByTestId('commissioner-strip-facts')).not.toBeInTheDocument();
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

// --- the commissioner count --------------------------------------------------

test('the title block counts the commissioners instead of claiming the box is private', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { co_commissioners: [{ teamId: 4 }, { teamId: 7 }] },
    }),
  });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByText('Commissioners only · 3')).toBeInTheDocument();
});

test('a league with no grants still counts the creator', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderStrip();

  const card = await screen.findByTestId('commissioner-strip');
  expect(within(card).getByText('Commissioners only · 1')).toBeInTheDocument();
});
