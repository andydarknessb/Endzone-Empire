import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import QuickActions from '../index';

/**
 * quick-actions slice tests (T7; rows in two columns #1106). The page-level
 * composition assertions (which cards a league type renders, the group
 * counts, the Set Lineup recommendation round trip) stay in
 * LeagueDashboardPage.test.jsx; what lives here is what only this slice can
 * answer: the row/column layout its groups share, and the copy it prints for
 * a league whose server would refuse the move.
 *
 * Same seam as the sibling slices: the widget reads the league through the
 * shared apiClient (useLeague -> useResource) and its one extra read through
 * useEndpoint, so the whole client is mocked and every GET is answered by the
 * URL-keyed dispatcher below.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module state
  // that outlives a test, so it is cleared whole rather than per key.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const ROSTER_URL = '/api/team/roster?leagueId=1';

const leagueResponse = (league = {}) => ({
  data: {
    viewerTeamId: 1,
    league: {
      id: 1,
      name: 'MinneApple',
      draft_status: 'complete',
      season_status: 'regular',
      current_week: 12,
      is_commissioner: false,
      ...league,
    },
    teams: [{ teamId: 1, id: 1, teamName: 'MyBallsHurts' }],
  },
});

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.resolve({ data: [] });
  });
};

// An empty roster with no `roster_slots` on the league yields no empty-slot
// count and no byes, so nothing in these fixtures is incidentally Recommended
// and the absence assertions below mean what they say.
const renderWidget = (league = {}) => {
  mockGetByUrl({ '/api/league/1': leagueResponse(league), [ROSTER_URL]: { data: [] } });
  return renderWithProviders(<QuickActions leagueId={1} />);
};

// A responsive sx value (the row's breakpoint-scoped min-height) lands inside
// an `@media` rule whose CSSMediaRule carries no selectorText of its own. This
// flattens every rule emitted under the element's generated class across
// breakpoints, exactly as LeagueDashboardPage.test.jsx's `cssFor` does. It
// deliberately loses which breakpoint a declaration came from: use it to prove
// a value is emitted at all, not to prove where.
const cssFor = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let css = '';
  const visit = (rules) => {
    Array.from(rules).forEach((rule) => {
      if (rule.cssRules) { visit(rule.cssRules); return; }
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      css += `${rule.style.cssText};`;
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => visit(sheet.cssRules));
  return css;
};

// The base-breakpoint form: declarations keyed by the selector's tail ('' for
// the element's own, ':hover' for its hover rule), as GameCenterPage.test.jsx
// reads its layout rules.
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

const tile = (key) => screen.getByTestId(`quick-action-${key}`);

// --- rows -------------------------------------------------------------

test('the eleven fantasy actions render as rows under their three h3 headings with hrefs and status copy', async () => {
  renderWidget({ is_commissioner: true });
  await screen.findByTestId('quick-actions');

  expect(screen.getByRole('heading', { level: 3, name: 'Play · 4' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Moves · 2' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'League · 5' })).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(11);

  const expectedRoutes = {
    draft: /\/league\/1\/draft$/,
    lineup: /\/league\/1\/lineup$/,
    'game-center': /\/league\/1\/game-center$/,
    pickem: /\/league\/1\/pickem$/,
    waivers: /\/league\/1\/waivers$/,
    trades: /\/league\/1\/trades$/,
    activity: /\/league\/1\/activity$/,
    'power-rankings': /\/league\/1\/power-rankings$/,
    history: /\/league\/1\/history$/,
    rules: /\/league\/1\/rules$/,
    'draft-settings': /\/league\/1\/draft-settings$/,
  };
  Object.entries(expectedRoutes).forEach(([key, route]) => {
    expect(tile(key).getAttribute('href')).toMatch(route);
  });

  expect(within(tile('draft')).getByText('Draft complete · review the board')).toBeInTheDocument();
  expect(within(tile('waivers')).getByText('Claim free agents and place bids')).toBeInTheDocument();
  expect(within(tile('activity')).getByText('Recent roster and league moves')).toBeInTheDocument();
});

test('the Recommended Badge sits on the recommended row only', async () => {
  renderWidget({ draft_status: 'active', season_status: 'regular' });
  await screen.findByTestId('quick-actions');

  expect(within(tile('draft')).getByText('Recommended')).toBeInTheDocument();
  ['lineup', 'game-center', 'pickem', 'waivers', 'trades', 'activity', 'power-rankings', 'history', 'rules'].forEach(
    (key) => {
      expect(within(tile(key)).queryByText('Recommended')).not.toBeInTheDocument();
    }
  );
});

test('a row is 40px tall at md and up and 48px tall below md, and its icon sits on a raised plate', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  // Flattened across breakpoints (cssFor loses which one a declaration came
  // from, per its own docblock): both heights the responsive sx value emits
  // must be present.
  const css = cssFor(tile('waivers'));
  expect(css).toMatch(/min-height:\s*40px/);
  expect(css).toMatch(/min-height:\s*48px/);

  // The plate is the one thing that stays on `dash-surface2`; the row itself
  // sits flush on the Card's `dash-surface`, so it carries no background of
  // its own.
  expect(rulesUnder(screen.getByTestId('quick-action-plate-waivers'))['']).toMatch(
    /background-color:\s*var\(--dash-surface2\)/
  );
  expect(within(tile('waivers')).getByTestId('quick-action-chevron-waivers')).toBeInTheDocument();
});

// --- columns ----------------------------------------------------------

test('the desktop body groups Play and Moves in the first column and League in the second, by test id', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  const column1 = screen.getByTestId('quick-actions-column-1');
  const column2 = screen.getByTestId('quick-actions-column-2');

  // Red-tell: moving Moves into the second column turns this case red and no
  // other.
  expect(within(column1).getByTestId('quick-actions-group-play')).toBeInTheDocument();
  expect(within(column1).getByTestId('quick-actions-group-moves')).toBeInTheDocument();
  expect(within(column2).getByTestId('quick-actions-group-league')).toBeInTheDocument();
  expect(within(column2).queryByTestId('quick-actions-group-play')).not.toBeInTheDocument();
  expect(within(column2).queryByTestId('quick-actions-group-moves')).not.toBeInTheDocument();
  expect(within(column1).queryByTestId('quick-actions-group-league')).not.toBeInTheDocument();
});

test("a pick'em-only trim still drops the fantasy rows, leaving Play alone in the first column", async () => {
  renderWidget({ pickem_only: true, season_status: 'regular', current_week: 6 });
  await screen.findByTestId('quick-actions');

  expect(screen.getByRole('heading', { level: 3, name: 'Play · 1' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'League · 3' })).toBeInTheDocument();
  expect(screen.queryByText(/^Moves ·/)).not.toBeInTheDocument();
  ['draft', 'lineup', 'game-center', 'waivers', 'trades', 'power-rankings', 'draft-settings'].forEach((key) => {
    expect(screen.queryByTestId(`quick-action-${key}`)).not.toBeInTheDocument();
  });
  expect(screen.getByTestId('quick-action-pickem')).toBeInTheDocument();

  const column1 = screen.getByTestId('quick-actions-column-1');
  const column2 = screen.getByTestId('quick-actions-column-2');
  expect(within(column1).getByTestId('quick-actions-group-play')).toBeInTheDocument();
  expect(within(column1).queryByTestId('quick-actions-group-moves')).not.toBeInTheDocument();
  expect(within(column2).getByTestId('quick-actions-group-league')).toBeInTheDocument();
});

// --- state-aware copy -----------------------------------------------------

test('a locked league names the lock on Waivers and on Trades', async () => {
  // `transactions_locked` is what waiver.service.js:143/177 and
  // trade.service.js:82 answer 409 on, so both cards state it rather than
  // inviting the refusal.
  renderWidget({ transactions_locked: true, trade_deadline_week: 14 });
  await screen.findByTestId('quick-actions');

  expect(
    within(tile('waivers')).getByText('Transactions locked by your commissioner')
  ).toBeInTheDocument();
  expect(
    within(tile('trades')).getByText('Transactions locked by your commissioner')
  ).toBeInTheDocument();
  // The lock is checked BEFORE the deadline on the server, and week 12 is
  // inside a week-14 deadline anyway, so neither card mentions a deadline.
  expect(within(tile('trades')).queryByText(/deadline/i)).not.toBeInTheDocument();
  // A card naming a refusal must never also be the thing the page points at.
  expect(within(tile('waivers')).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(tile('trades')).queryByText('Recommended')).not.toBeInTheDocument();
});

test('a past deadline names the week on Trades and leaves Waivers alone', async () => {
  renderWidget({ current_week: 12, trade_deadline_week: 11 });
  await screen.findByTestId('quick-actions');

  expect(within(tile('trades')).getByText('Trade deadline passed · week 11')).toBeInTheDocument();
  // Waivers are gated on the lock alone; the trade deadline says nothing about
  // them and the card keeps its plain copy.
  expect(within(tile('waivers')).getByText('Claim free agents and place bids')).toBeInTheDocument();
  expect(within(tile('trades')).queryByText('Recommended')).not.toBeInTheDocument();
});

test('the lock wins over the deadline, matching the order the server refuses in', async () => {
  renderWidget({ current_week: 12, trade_deadline_week: 11, transactions_locked: true });
  await screen.findByTestId('quick-actions');

  expect(
    within(tile('trades')).getByText('Transactions locked by your commissioner')
  ).toBeInTheDocument();
  expect(within(tile('trades')).queryByText(/Trade deadline passed/)).not.toBeInTheDocument();
});

test('a null deadline is no deadline, not week 0', async () => {
  // `trade_deadline_week` is nullable and null means "no deadline at all". The
  // guard has to be explicit: `Number(null)` is 0, and every week is past 0.
  renderWidget({ current_week: 12, trade_deadline_week: null });
  await screen.findByTestId('quick-actions');

  expect(within(tile('trades')).getByText('Propose and review trades')).toBeInTheDocument();
  expect(within(tile('trades')).queryByText(/deadline/i)).not.toBeInTheDocument();
});

test('the deadline week itself is still an open week', async () => {
  // The server compares with a strict `>` (trade.service.js:59), so a trade in
  // week 11 of a week-11 deadline is accepted and the card must not refuse it.
  renderWidget({ current_week: 11, trade_deadline_week: 11 });
  await screen.findByTestId('quick-actions');

  expect(within(tile('trades')).getByText('Propose and review trades')).toBeInTheDocument();
  expect(within(tile('trades')).queryByText(/Trade deadline passed/)).not.toBeInTheDocument();
});
