import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import QuickActions from '../index';

/**
 * quick-actions slice tests (T7). The page-level composition assertions (which
 * cards a league type renders, the group counts, the Set Lineup recommendation
 * round trip) stay in LeagueDashboardPage.test.jsx; what lives here is what
 * only this slice can answer: the track definition its groups share, and the
 * copy it prints for a league whose server would refuse the move.
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

// The grid tracks are breakpoint-scoped, and a responsive sx value lands inside
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

const grid = (label) => screen.getByTestId(`quick-actions-grid-${label}`);
const tile = (key) => screen.getByTestId(`quick-action-${key}`);

// --- tracks ---------------------------------------------------------------

test('a two-card group keeps the shared tile width', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  // Moves holds two cards, Play four. The whole point of the track definition
  // is that this difference costs nothing: both groups lay their cards on the
  // SAME repeating 180px-minimum track, so a tile is one width everywhere on
  // the band.
  expect(within(grid('moves')).getAllByRole('link')).toHaveLength(2);
  expect(within(grid('play')).getAllByRole('link')).toHaveLength(4);

  // auto-FILL, not auto-fit. auto-fit collapses the tracks a group has no card
  // for and distributes their space among the cards it does have, which would
  // stretch Moves' two tiles to half the band each while Play's four stayed
  // narrow. Red-tell: swapping this one keyword back to auto-fit turns this
  // case red and no other.
  const track = /repeat\(auto-fill,\s*minmax\(180px,\s*1fr\)\)/;
  expect(cssFor(grid('moves'))).toMatch(track);
  expect(cssFor(grid('play'))).toMatch(track);
  expect(cssFor(grid('moves'))).not.toMatch(/auto-fit/);

  // And the track is not a fixed count keyed to the group, which is what it
  // replaced: three fixed tracks meant Play wrapped onto two rows while Moves
  // left a third of its row empty.
  expect(cssFor(grid('moves'))).not.toMatch(/repeat\(\s*\d/);
});

// --- surface --------------------------------------------------------------

test('a tile is a card on the ground with its icon on a raised plate', async () => {
  renderWidget();
  await screen.findByTestId('quick-actions');

  const own = rulesUnder(tile('waivers'))[''];
  // Promoted from `dash-surface2` to `dash-surface` at the full card radius:
  // both foregrounds it carries (ink title, dim status) are registered over
  // `dash-surface` in tokens.contrast.test.js, so this composes no new pairing.
  expect(own).toMatch(/background-color:\s*var\(--dash-surface\)/);
  expect(own).toMatch(/border-radius:\s*var\(--dash-radius\)/);
  // The plate is the one thing that stays on the tile surface.
  expect(rulesUnder(screen.getByTestId('quick-action-plate-waivers'))['']).toMatch(
    /background-color:\s*var\(--dash-surface2\)/
  );

  // Motion is tokenised: no hard-coded millisecond literal survives, and the
  // hover lifts as the artboard's `.action:hover` does.
  expect(own).toMatch(/var\(--transition-fast\)/);
  expect(own).not.toMatch(/120ms/);
  expect(rulesUnder(tile('waivers'))[':hover']).toMatch(/translateY\(-2px\)/);
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
