import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import QuickActions from '../index';

/**
 * quick-actions slice tests (T7; one column per group #1993). The page-level
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
  // Pre-draft, so a commissioner is offered Draft Settings as the eleventh row.
  renderWidget({ is_commissioner: true, draft_status: 'pending', season_status: 'pending' });
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

  expect(within(tile('draft')).getByText('Draft has not started yet')).toBeInTheDocument();
  expect(within(tile('waivers')).getByText('Claim free agents and place bids')).toBeInTheDocument();
  expect(within(tile('activity')).getByText('Recent roster and league moves')).toBeInTheDocument();
});

// --- Draft Settings is a draft-time card (#1981 L11) ---------------------------

test.each([
  ['pre-draft', { draft_status: 'pending', season_status: 'pending' }],
  ['drafting', { draft_status: 'active', season_status: 'regular' }],
])('a commissioner is offered Draft Settings %s', async (_phase, league) => {
  renderWidget({ is_commissioner: true, ...league });
  await screen.findByTestId('quick-actions');

  expect(tile('draft-settings')).toBeInTheDocument();
});

test.each([
  ['in season', { draft_status: 'complete', season_status: 'regular' }],
  ['in the playoffs', { draft_status: 'complete', season_status: 'playoffs' }],
  ['complete', { draft_status: 'complete', season_status: 'complete' }],
])('a commissioner is not offered Draft Settings %s', async (_phase, league) => {
  renderWidget({ is_commissioner: true, ...league });
  await screen.findByTestId('quick-actions');

  expect(screen.queryByTestId('quick-action-draft-settings')).not.toBeInTheDocument();
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

// Red-tell (#1993 F2): with one column per group the status line has about a
// third of the card between md (900) and lg (1200), and real copy ("2 empty
// starting slots · 2 starters on bye") does not fit on one line there. It wraps
// at md and only truncates (nowrap + ellipsis) from lg up, and below md, where
// the single column is wide. Leaving it `nowrap` at md turns the first
// assertion red; an ellipsis at md turns the second red.
// cssFor flattens breakpoints, so this reads the declarations per media query.
const declarationsAt = (el, minWidth) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let css = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((media) => {
      if (!media.media || !media.media.mediaText.replace(/\s/g, '').includes(`min-width:${minWidth}px`)) return;
      Array.from(media.cssRules).forEach((rule) => {
        if (rule.selectorText && rule.selectorText.startsWith(`.${cls}`)) css += `${rule.style.cssText};`;
      });
    });
  });
  return css;
};

test('the status line wraps between md and lg and truncates only from lg', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  const status = within(tile('waivers')).getByText('Claim free agents and place bids');
  expect(declarationsAt(status, 900)).toMatch(/white-space:\s*normal/);
  expect(declarationsAt(status, 900)).not.toMatch(/text-overflow:\s*ellipsis/);
  expect(declarationsAt(status, 1200)).toMatch(/white-space:\s*nowrap/);
  expect(declarationsAt(status, 1200)).toMatch(/text-overflow:\s*ellipsis/);
  // xs is emitted as `min-width: 0px`: below md the line still truncates.
  expect(declarationsAt(status, 0)).toMatch(/white-space:\s*nowrap/);
});

// --- columns ----------------------------------------------------------

// Red-tell (#1993): the card spans the dashboard's full width now, so each group
// is its own column at md and up. Putting two groups back in one column (the
// old Play-over-Moves stack) turns the first case red; a track count that does
// not follow the group count turns the second red.
test('the desktop body is one column per group, Play then Moves then League', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  const body = screen.getByTestId('quick-actions-body');
  expect(cssFor(body)).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  expect(
    within(body).getAllByRole('heading', { level: 3 }).map((h) => h.textContent.split(' · ')[0])
  ).toEqual(['Play', 'Moves', 'League']);
  ['play', 'moves', 'league'].forEach((group) => {
    // A direct child of the grid, not wrapped in a shared column.
    // eslint-disable-next-line testing-library/no-node-access
    expect(screen.getByTestId(`quick-actions-group-${group}`).parentElement).toBe(body);
  });
});

test("a pick'em-only trim drops the fantasy rows and the Moves column, leaving two columns", async () => {
  renderWidget({ pickem_only: true, season_status: 'regular', current_week: 6 });
  await screen.findByTestId('quick-actions');

  expect(screen.getByRole('heading', { level: 3, name: 'Play · 1' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'League · 3' })).toBeInTheDocument();
  expect(screen.queryByText(/^Moves ·/)).not.toBeInTheDocument();
  ['draft', 'lineup', 'game-center', 'waivers', 'trades', 'power-rankings', 'draft-settings'].forEach((key) => {
    expect(screen.queryByTestId(`quick-action-${key}`)).not.toBeInTheDocument();
  });
  expect(screen.getByTestId('quick-action-pickem')).toBeInTheDocument();

  const body = screen.getByTestId('quick-actions-body');
  expect(cssFor(body)).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  /* eslint-disable testing-library/no-node-access */
  expect(screen.getByTestId('quick-actions-group-play').parentElement).toBe(body);
  expect(screen.getByTestId('quick-actions-group-league').parentElement).toBe(body);
  /* eslint-enable testing-library/no-node-access */
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

// --- Set Lineup before the season (#1979 L25) -----------------------------------

// Before the draft the roster is empty, so every starting slot reads empty. That
// is not a nag to send: lineups open once the draft is done.
const STANDARD_SLOTS = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
];
const lineupUrl = (week) => `/api/team/lineup?leagueId=1&week=${week}`;
const emptyLineup = (week) => ({ data: { week, season: 2026, teamId: 1, entries: [] } });

test.each([
  ['pre-draft', { draft_status: 'pending', season_status: 'pending' }],
  ['drafting', { draft_status: 'active', season_status: 'regular' }],
])('Set Lineup is not recommended %s and says lineups open after the draft', async (_phase, league) => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ...league, current_week: 1, roster_slots: STANDARD_SLOTS }),
    [lineupUrl(1)]: emptyLineup(1),
  });
  renderWithProviders(<QuickActions leagueId={1} />);
  await screen.findByTestId('quick-actions');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(within(tile('lineup')).getByText('Lineups open after the draft')).toBeInTheDocument();
  expect(within(tile('lineup')).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(tile('lineup')).queryByText(/empty starting slot/)).not.toBeInTheDocument();
});

test('in season an empty starting slot is still recommended with its count', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ current_week: 3, roster_slots: STANDARD_SLOTS }),
    [lineupUrl(3)]: emptyLineup(3),
  });
  renderWithProviders(<QuickActions leagueId={1} />);
  await screen.findByTestId('quick-actions');

  expect(await within(tile('lineup')).findByText('Recommended')).toBeInTheDocument();
  expect(within(tile('lineup')).getByText('5 empty starting slots')).toBeInTheDocument();
});

// Red-tell: removing the `seasonLive &&` guard from the Set Lineup branch turns
// this case red, since a completed season's empty slots would read Recommended.
test('a completed season does not recommend Set Lineup for empty slots', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({
      draft_status: 'complete',
      season_status: 'complete',
      current_week: 3,
      roster_slots: STANDARD_SLOTS,
    }),
    [lineupUrl(3)]: emptyLineup(3),
  });
  renderWithProviders(<QuickActions leagueId={1} />);
  await screen.findByTestId('quick-actions');
  // The lineup read must have landed, or the absence below proves nothing.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(lineupUrl(3)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(within(tile('lineup')).getByText('Set your Week 3 lineup')).toBeInTheDocument();
  expect(within(tile('lineup')).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(tile('lineup')).queryByText(/empty starting slot/)).not.toBeInTheDocument();
});
