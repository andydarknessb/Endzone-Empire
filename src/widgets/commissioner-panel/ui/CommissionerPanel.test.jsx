import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import CommissionerPanel from '../index';

/**
 * commissioner-panel slice tests (T9). The page-level composition assertions
 * (the panel's presence, the advance-week round trip, the disclosure's
 * aria wiring) stay in LeagueDashboardPage.test.jsx; what lives here is what
 * only this slice can answer: which facts it states from a given league row,
 * which reads it is allowed to issue, and the shape of its own controls.
 *
 * The widget reads the league through the shared apiClient (useLeague ->
 * useResource), so the whole client is mocked and every GET is answered by the
 * URL-keyed dispatcher below - the same seam the page test uses.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// The legacy commissioner tools are composed as-is behind the disclosure and
// have their own test file. Mocked here for the same reason the page test mocks
// them, plus one specific to this ticket: the real tree fetches the join queue
// itself, and a second copy of that request would make this file's "which reads
// does the panel issue" assertions meaningless.
jest.mock('../../../components/LeagueDashboard/CommissionerTools', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId }) =>
      ReactLib.createElement('div', { 'data-testid': 'mock-commissioner-tools' }, `tools ${leagueId}`),
  };
});

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module state
  // that outlives a test, so it is cleared whole rather than per key.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const leagueResponse = ({ league = {}, teams = [], viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: { id: 1, name: 'MinneApple', is_commissioner: true, ...league },
    teams,
  },
});

// A commissioner league carrying every field the fact grid reads: 9 starters
// across six slots, a bench, an IR slot, half-PPR reception, a FAAB waiver
// window and a trade deadline.
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
    { key: 'WR', count: 3 },
    { key: 'TE', count: 1 },
    { key: 'FLEX', count: 1 },
    { key: 'K', count: 1 },
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

const renderPanel = (leagueId = 1) => renderWithProviders(<CommissionerPanel leagueId={leagueId} />);

const getUrls = () => apiClient.get.mock.calls.map(([url]) => url);
const joinRequestUrls = () => getUrls().filter((url) => url.includes('/join-requests'));

// Let every effect a resolved read could start actually start, for the cases
// that assert a request was NOT made.
// Two flushes, not one: the league read resolving is what lets the hook decide
// whether the join-requests URL is null, and that decision runs in a second
// effect pass. A single flush would let an absence assertion pass before the
// request it is looking for could have been made.
const settleReads = async () => {
  await waitFor(() => expect(getUrls()).toContain('/api/league/1'));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class
// (GameCenterPage.test.jsx reads its layout rules the same way). This gathers
// the declarations of every rule whose selector starts with that class, keyed
// by the selector's tail ('' for the element's own).
const rulesUnder = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = {};
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      const tail = rule.selectorText.slice(`.${cls}`.length).replace(/\s+/g, '');
      found[tail] = `${found[tail] || ''}${rule.style.cssText};`;
    });
  });
  return found;
};

const fact = (key) => screen.getByTestId(`commissioner-fact-${key}`);

// --- reads ----------------------------------------------------------------

test('a member fetches no commissioner reads', async () => {
  // The league is public AND screens joins, so the ONLY thing standing between
  // this member and a 403 from the commissioner queue is the is_commissioner
  // clause in the URL gate. The panel itself returns null for a member, but the
  // model hook runs before that return, which is why the gate lives in the URL
  // and not in the render.
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: { is_commissioner: false, is_public: true, join_approval: true },
      teams: teamsWithLocks(12, 2),
    }),
  });
  renderPanel();
  await settleReads();

  expect(screen.queryByTestId('commissioner-panel')).not.toBeInTheDocument();
  expect(joinRequestUrls()).toEqual([]);
  // The league row itself is the one read a member's mount is allowed to be
  // part of, and it was already on the wire for the page.
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a commissioner of a public league that screens joins states the pending count', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: { is_public: true, join_approval: true },
    }),
    '/api/league/1/join-requests': { data: [{ id: 7 }, { id: 8 }] },
  });
  renderPanel();

  const badge = await screen.findByTestId('commissioner-panel-join-requests');
  expect(badge).toHaveTextContent('Join requests · 2');
  // A real control, not a decorated div: the count is how a commissioner gets
  // to the queue, so it has to be reachable from the keyboard.
  expect(badge).toHaveAttribute('role', 'button');
  expect(badge).toHaveAttribute('tabindex', '0');
  // And it clears the 44px touch floor the island holds every control to.
  expect(rulesUnder(badge)['']).toMatch(/min-height: 44px/);
  expect(joinRequestUrls()).toEqual(['/api/league/1/join-requests']);

  // The count's action is the disclosure, not a second Approve/Deny surface:
  // the decide mutation lives in the legacy tools and owns the list it edits.
  expect(screen.queryByTestId('commissioner-panel-administration')).not.toBeInTheDocument();
  await userEvent.click(badge);
  expect(await screen.findByTestId('commissioner-panel-administration')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
});

test('a commissioner of a private league fetches no queue', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ league: { is_public: false, join_approval: true } }),
  });
  renderPanel();

  await screen.findByTestId('commissioner-panel');
  await settleReads();
  expect(joinRequestUrls()).toEqual([]);
  expect(screen.queryByTestId('commissioner-panel-join-requests')).not.toBeInTheDocument();
});

test('an empty queue states nothing rather than a zero', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ league: { is_public: true, join_approval: true } }),
    '/api/league/1/join-requests': { data: [] },
  });
  renderPanel();

  await screen.findByTestId('commissioner-panel');
  await waitFor(() => expect(joinRequestUrls()).toEqual(['/api/league/1/join-requests']));
  expect(screen.queryByTestId('commissioner-panel-join-requests')).not.toBeInTheDocument();
});

// --- facts ----------------------------------------------------------------

test('the fact grid states the league it was given, with no request of its own', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: fullyConfiguredLeague(),
      teams: teamsWithLocks(12, 2),
    }),
  });
  renderPanel();

  await screen.findByTestId('commissioner-panel-facts');
  expect(fact('transactions')).toHaveTextContent('Locked');
  expect(fact('teams-locked')).toHaveTextContent('2 of 12');
  expect(fact('trade-deadline')).toHaveTextContent('Week 11');
  expect(fact('waivers')).toHaveTextContent('FAAB · 24h');
  expect(fact('trade-review')).toHaveTextContent('24h');
  expect(fact('roster')).toHaveTextContent('9 starters · 5 bench · 1 IR');
  expect(fact('scoring')).toHaveTextContent('Half PPR');
  // Everything above rode on the league payload the page had already read.
  expect(getUrls()).toEqual(['/api/league/1']);
});

test('an unlocked league reads Open, and a null deadline reads None', async () => {
  // `trade_deadline_week` is the one nullable source behind a fact: null is the
  // answer, not an absence, and it must not read as week 0 (`Number(null)`).
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: fullyConfiguredLeague({ transactions_locked: false, trade_deadline_week: null }),
      teams: teamsWithLocks(12, 0),
    }),
  });
  renderPanel();

  await screen.findByTestId('commissioner-panel-facts');
  expect(fact('transactions')).toHaveTextContent('Open');
  expect(fact('trade-deadline')).toHaveTextContent('None');
  expect(fact('trade-deadline')).not.toHaveTextContent('Week 0');
  expect(fact('teams-locked')).toHaveTextContent('0 of 12');
});

test('a payload that carries none of the source fields renders no facts at all', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse({ teams: [{ teamId: 1, id: 1 }] }) });
  renderPanel();

  await screen.findByTestId('commissioner-panel');
  expect(screen.queryByTestId('commissioner-panel-facts')).not.toBeInTheDocument();
  expect(screen.queryByTestId('commissioner-fact-transactions')).not.toBeInTheDocument();
  expect(screen.queryByTestId('commissioner-fact-roster')).not.toBeInTheDocument();
});

test("a pick'em-only league states no fantasy facts", async () => {
  // Transactions, roster freezes, waivers, trades, lineup slots and scoring are
  // all fantasy concepts; the legacy tools hide every one of them for a
  // pick'em-only league, and so does the grid.
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: fullyConfiguredLeague({ pickem_only: true }),
      teams: teamsWithLocks(20, 3),
    }),
  });
  renderPanel();

  await screen.findByTestId('commissioner-panel');
  expect(screen.queryByTestId('commissioner-panel-facts')).not.toBeInTheDocument();
});

// --- copy -----------------------------------------------------------------

test('the pill counts the commissioners instead of claiming the box is private', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      league: { co_commissioners: [{ teamId: 4 }, { teamId: 7 }] },
    }),
  });
  renderPanel();

  const card = await screen.findByTestId('commissioner-panel');
  // The creator plus two grants. Never "Only you see this": is_commissioner is
  // the viewer's effective role, so a co-commissioner reads this same box.
  expect(within(card).getByText('Commissioners only · 3')).toBeInTheDocument();
  expect(within(card).queryByText('Only you see this')).not.toBeInTheDocument();
  // The neutral chip, not the island's viewer-row identity marker.
  expect(within(card).getByTestId('badge')).toHaveAttribute('data-variant', 'neutral');
});

test('a league with no grants still counts the creator', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse() });
  renderPanel();

  const card = await screen.findByTestId('commissioner-panel');
  expect(within(card).getByText('Commissioners only · 1')).toBeInTheDocument();
});

test('a commissioner who did not create the league is told why co-commissioners are missing', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse({ league: { ownerTeamId: 9 }, viewerTeamId: 1 }) });
  renderPanel();

  const card = await screen.findByTestId('commissioner-panel');
  const sentence = 'Only the league creator can add or remove co-commissioners.';
  // Stated beside the tools, so it explains an absence the viewer can see.
  expect(within(card).queryByText(sentence)).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: /league administration/i }));
  expect(await within(card).findByText(sentence)).toBeInTheDocument();
});

test('the creator is not told about a control they can see', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse({ league: { ownerTeamId: 1 }, viewerTeamId: 1 }) });
  renderPanel();

  const card = await screen.findByTestId('commissioner-panel');
  await userEvent.click(within(card).getByRole('button', { name: /league administration/i }));
  await screen.findByTestId('mock-commissioner-tools');
  expect(
    within(card).queryByText('Only the league creator can add or remove co-commissioners.')
  ).not.toBeInTheDocument();
});

// --- the disclosure control ----------------------------------------------

test('the disclosure is a full-width band on the island, at the touch floor', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse() });
  renderPanel();

  const toggle = await screen.findByRole('button', { name: /league administration/i });
  const rules = rulesUnder(toggle)[''];
  // The 44px floor plus horizontal hit slop: a band, not a tall line of text.
  expect(rules).toMatch(/min-height: 44px/);
  expect(rules).toMatch(/padding-left: 10px/);
  expect(rules).toMatch(/padding-right: 10px/);
  expect(rules).toMatch(/width: 100%/);
  // Painted from the island's own tokens, never a literal.
  expect(rules).toMatch(/background-color: var\(--dash-surface2\)/);
  expect(rules).toMatch(/border: 1px solid var\(--dash-line\)/);
});

test('the chevron eases on the shared motion token, not a literal', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse() });
  renderPanel();

  const toggle = await screen.findByRole('button', { name: /league administration/i });
  // eslint-disable-next-line testing-library/no-node-access -- the chevron is decorative and aria-hidden, so no Testing Library query reaches it
  const chevron = toggle.querySelector('svg');
  expect(rulesUnder(chevron)['']).toMatch(/transition: transform var\(--transition-fast\) ease/);
});
