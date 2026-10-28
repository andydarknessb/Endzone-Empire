import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { invalidate, read } from '../../lib/resourceCache';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';
import LeagueDashboardPage from './index';
import QuickActions from '../../widgets/quick-actions';
import MyTeamSummary from '../../widgets/my-team-summary';
import LeagueHistoryPage from '../league-history';
import LeagueTrophiesPage from '../league-trophies';

// The page reads the league through the shared apiClient (via useLeague ->
// useResource), so the whole client is mocked and every GET is answered by the
// URL-keyed dispatcher below. This is the ONE test seam the six later dashboard
// tickets extend: they add their endpoints to `mockGetByUrl` and their payload
// shapes to the fixture builders, without editing the tests already here.
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  // createDraftSocket (reached through the real chat panel's socket.js) subscribes to token refreshes.
  onTokenRefreshed: jest.fn(),
}));

// The legacy chat panel the cutover (#645) composes "as-is" is a lightweight
// stand-in: it has its own dedicated test file and carries its own socket and
// self-fetching machinery, and is composed here only for its presence. Mocking
// it keeps this page test on the ONE apiClient seam above (no socket mock) and
// isolates what the page adds: the composition gating and its own chat
// launcher/badge markup, which stay real below. The recap, the trophies and the
// pick'em standings are NOT mocked: the dashboard renders its own Play-select
// views over their reads, so they are answered through the apiClient seam.
//
// The chat panel stand-in reports `mockChatUnread` up through onUnreadChange on
// mount, so a test can drive the launcher's badge without reaching into the
// closed persistent drawer (whose paper MUI hides while closed).
let mockChatUnread = 0;
jest.mock('../../components/ChatPanel/ChatPanel', () => {
  const ReactLib = require('react');
  function MockChatPanel({ onUnreadChange }) {
    ReactLib.useEffect(() => {
      if (onUnreadChange) onUnreadChange(mockChatUnread);
    }, [onUnreadChange]);
    return ReactLib.createElement('div', { 'data-testid': 'mock-chat-panel' });
  }
  return { __esModule: true, default: MockChatPanel };
});

// The emulated viewport width, in px, that every useMediaQuery on this page
// resolves against (the chat drawer's `sm` switch and the commissioner panel's
// `md` placement). Desktop by default, so a test that says nothing about width
// gets the layout the page has always been tested at; a test that cares sets it
// before rendering.
let viewport = 1440;

beforeEach(() => {
  // Clear ALL shared resource caches (ADR 0004), not the league alone: the
  // dashboard widgets read cached resources that are module state and outlive a
  // test (useLeague, and since #641 the week-keyed useStandings both widgets
  // share), so without a blanket clear a later test is served an earlier test's
  // row. A whole-store invalidate covers every cached read a widget adds without
  // this setup needing to name each one.
  invalidate(undefined, { reload: false });
  viewport = 1440;
  // jsdom's own matchMedia answers false to everything, which silently pins the
  // page to its desktop branches. This answers the theme's breakpoint queries
  // against `viewport` instead, so `down('sm')` and `down('md')` can disagree
  // (a tablet is compact for the commissioner panel and not for the chat
  // drawer); anything that is neither a min- nor a max-width query stays false.
  window.matchMedia = jest.fn().mockImplementation((query) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    let matches = false;
    if (max) matches = viewport <= Number(max[1]);
    else if (min) matches = viewport >= Number(min[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
  });
  // The copy-invite feature writes to the clipboard; jsdom has none by default.
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  // The chat stand-in reports no unread by default; the badge test opts in.
  mockChatUnread = 0;
});

afterEach(() => {
  jest.clearAllMocks();
});

// A `teams[]` of length n. Widgets in later tickets add the per-team fields they
// read (record, points, avatar); the page shell reads only the count.
const buildTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({ teamId: i + 1, id: i + 1, name: `Team ${i + 1}` }));

/**
 * The GET /api/league/:id payload: the league row (carrying `is_commissioner`
 * and, for a commissioner, `invite_code`), its teams, and the viewer's own team
 * id at the response root (#112). Later tickets extend `league`/`teams` here.
 */
const leagueDetail = ({ league = {}, teams, viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: {
      id: 1,
      name: 'MinneApple',
      draft_status: 'pending',
      season_status: 'regular',
      is_commissioner: false,
      ...league,
    },
    teams: teams ?? buildTeams(1),
  },
});

// Phase presets, each derived by the client League-phase helper from the raw
// columns, never a stored status field.
const inSeasonLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3, ...overrides },
    teams: buildTeams(12),
  });

const preDraftLeague = (overrides = {}) =>
  leagueDetail({ league: { draft_status: 'pending', ...overrides }, teams: buildTeams(8) });

const pickemOnlyLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      pickem_only: true,
      draft_status: 'pending',
      season_status: 'regular',
      current_week: 6,
      ...overrides,
    },
    teams: buildTeams(20),
  });

/**
 * Build a URL-keyed apiClient.get mock. `overrides` maps a URL (matched exactly
 * or as a trailing path segment via endsWith) to a resolved value, a
 * `{ reject: <error> }` marker, or a `{ pending: true }` marker for a request
 * that stays on the wire for the rest of the test. Unmatched URLs fall back to
 * an empty response. Exact/suffix matching (not a loose `includes`) keeps a key
 * like '/api/league/1' from also matching a nested '/api/league/1/...' request.
 * This mirrors the legacy dashboard test's dispatcher so the two read the same.
 */
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        if (value && value.reject) return Promise.reject(value.reject);
        if (value && value.pending) return new Promise(() => {}); // never settles
        return Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

const renderPage = (leagueId = 1) =>
  renderWithProviders(<LeagueDashboardPage />, {
    path: '/league/:leagueId',
    route: `/league/${leagueId}`,
  });

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class.
// This gathers the declarations of every rule whose selector starts with that
// class, keyed by the selector's tail ('' for the element's own), exactly as
// GameCenterPage.test.jsx:168 does.
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

// The same class, but flattened across breakpoints: a responsive sx value lands
// inside an `@media` rule, and a CSSMediaRule carries no selectorText of its
// own, so `rulesUnder` above never sees it. This page's grid tracks are
// breakpoint-scoped, so their assertions read this instead. It deliberately
// loses which breakpoint a declaration came from: use it to prove a value is
// emitted at all, not to prove where.
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

// True when `a` comes before `b` in the document. The commissioner panel's
// placement is a DOM-order claim (WCAG 1.3.2/2.4.3), and DOM order is the one
// thing jsdom can answer about layout, so it is asserted directly.
const precedes = (a, b) =>
  // eslint-disable-next-line no-bitwise, testing-library/no-node-access
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// --- loading + error ------------------------------------------------------

test('shows a loading placeholder until the league arrives', () => {
  mockGetByUrl({ '/api/league/1': { pending: true } });
  renderPage();
  const loading = screen.getByTestId('dashboard-loading');
  expect(loading).toBeInTheDocument();
  // The loading region owns the league read, so it is the one that announces
  // it (Skeleton.jsx: the shapes stay aria-hidden, the owning region speaks).
  expect(loading).toHaveAttribute('aria-busy', 'true');
});

test('a failed league read renders a titled dead end, one alert, and a control that re-fires it', async () => {
  mockGetByUrl({
    '/api/league/1': { reject: { response: { data: { error: 'league not found' } } } },
  });
  renderPage();

  // The route still has an h1: a page whose only content was a line of error
  // text had no heading at all, so nothing named the screen a reader landed on.
  expect(
    await screen.findByRole('heading', { level: 1, name: 'League unavailable' })
  ).toBeInTheDocument();

  // One alerted sentence, and it is the page's own. The server's string is
  // deliberately NOT on screen: useResource collapses the server's `error`
  // field and the transport's `err.message` into one value, so rendering it
  // would put an axios internal in front of a manager on a network failure.
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('We could not load this league right now.');
  expect(screen.queryByText('league not found')).not.toBeInTheDocument();

  // Try again re-fires the read (refetch invalidates the shared league key, so
  // this is a real second GET, not a re-render).
  const before = apiClient.get.mock.calls.filter(([url]) => url === '/api/league/1').length;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([url]) => url === '/api/league/1').length
    ).toBeGreaterThan(before)
  );
});

// --- page shell geometry ---------------------------------------------------

test("page shell: pick'em standings do not widen the document", async () => {
  // 360px: the width at which the pick'em body used to lay itself out 560px
  // wide inside a 328px Container, leaving the right of every card on the app
  // background and the whole document panning sideways.
  viewport = 360;
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The shell is a column flex container, NOT a grid. That is the whole fix:
  // the grid it replaced had one implicit `auto` track, so the widest
  // min-content anywhere inside set the document's width. In a column flex
  // container the automatic minimum applies to the block axis, so every child
  // resolves to a zero inline minimum with no per-child `minWidth: 0`.
  // Red-tell: putting `display: grid` back on the shell turns this case red.
  const shellEl = screen.getByTestId('dashboard-shell');
  const shell = rulesUnder(shellEl)[''];
  expect(shell).toMatch(/display:\s*flex/);
  expect(shell).toMatch(/flex-direction:\s*column/);
  // The stacking rhythm: 24px on a phone, 32px from sm (the canvas boards).
  expect(cssFor(shellEl)).toMatch(/gap:\s*24px/);
  expect(cssFor(shellEl)).toMatch(/gap:\s*32px/);
  // The fixed chat button (56px tall, at bottom: 24) was landing on the last
  // card because the empty rows below it were the only thing keeping it clear.
  // This is the clearance that replaces them (96px under the content at every width;
  // the geometry is guarded in tests/e2e/league-dashboard-playselect.spec.ts).
  expect(cssFor(shellEl)).toMatch(/padding-bottom:\s*96px/);
  // The page paints the Play-select ground on a `.ps-root` element, which also
  // scopes the focus ring, the cursor blink and the hover rules.
  // eslint-disable-next-line testing-library/no-node-access
  const root = shellEl.parentElement;
  expect(root).toHaveClass('ps-root');
  expect(rulesUnder(root)['']).toMatch(/background-color:\s*var\(--ps-field\)/);

  // The pool standings are the primary content of this league type, so they are
  // a named region with a real heading rather than a bare section.
  expect(
    screen.getByRole('heading', { level: 2, name: "Pick'em Standings" })
  ).toBeInTheDocument();
});

test('page shell: both main-grid tracks have a zero minimum, so a wide table cannot push the document', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const main = cssFor(screen.getByTestId('dashboard-main'));
  // A bare `1fr` track still floors at its item's min-content width, which is
  // what let a wide table push the document. The standings and the activity
  // frame both sit on `minmax(0, ...)` tracks: the table scrolls inside its own
  // named region instead (the standings widget's own test pins that box).
  expect(main).toMatch(/minmax\(0,\s*1\.55fr\)\s+minmax\(0,\s*1fr\)/);
  expect(main).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  // The grid item needs its own zero minimum too.
  expect(rulesUnder(screen.getByTestId('slot-standings'))['']).toMatch(/min-width:\s*0/);
});

test('page shell: a member\'s null-rendering wrappers collapse instead of buying a gap', async () => {
  // A member's commissioner slot renders an empty wrapper (the strip returns
  // null for a non-commissioner, CommissionerStrip.jsx's own gate). In the
  // shell's 22px stack an empty wrapper still takes a turn, which is where the
  // blank bands came from.
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const slot = screen.getByTestId('slot-commissioner-strip');
  expect(slot).toBeEmptyDOMElement();
  expect(rulesUnder(slot)[':empty']).toMatch(/display:\s*none/);
});

test('page shell: a viewer with no team of their own loses the hero column, not just the card', async () => {
  // A viewer who owns no Team (a commissioner who never joined): viewerTeamId
  // is the per-viewer field that answers it (#112), not a scan of teams[].
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
      teams: buildTeams(12),
      viewerTeamId: null,
    }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The slot is gone, not merely empty: leaving it in place kept 5/12 of the
  // hero as bare page beside a lone matchup card.
  expect(screen.queryByTestId('slot-my-team')).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-matchup-preview')).toBeInTheDocument();
  expect(cssFor(screen.getByTestId('dashboard-hero'))).not.toMatch(/1\.2fr/);
});

// Game day opens on the matchup: it is first in the DOM (the top of a phone's
// one column) and the wide left track at md, with My team in the right track
// spanning both rows so the Pick'em panel can sit under the matchup.
test('hero: the matchup comes first in the DOM and takes the wide left track at md', async () => {
  mockGetByUrl({
    '/api/league/1': inSeasonLeague(),
    '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
  });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The panel arrives with the pick'em settings read; the areas are read once it has.
  await screen.findByTestId('slot-pickem-panel');
  const hero = screen.getByTestId('dashboard-hero');
  const matchup = within(hero).getByTestId('slot-matchup-preview');
  const myTeam = within(hero).getByTestId('slot-my-team');
  expect(precedes(matchup, myTeam)).toBe(true);
  expect(cssFor(hero)).toMatch(/minmax\(0,\s*1\.2fr\)\s+minmax\(0,\s*1fr\)/);
  expect(cssFor(hero)).not.toMatch(/minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.2fr\)/);
  // The phone column stays a single track, in the order matchup, My team, Pick'em.
  expect(cssFor(hero)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  expect(cssFor(hero)).toMatch(/grid-template-areas:\s*"v" "m" "p"/);
  expect(cssFor(hero)).toMatch(/grid-template-areas:\s*"v m" "p m"/);
});

// With no Pick'em panel the grid has no "p" row at all: an empty track would add a 24px gap under the
// phone column and soak up half the stretch beside My team at md, leaving the matchup card short.
test("hero: with no Pick'em panel the areas hold only the matchup and My team", async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const css = cssFor(screen.getByTestId('dashboard-hero'));
  expect(css).toMatch(/grid-template-areas:\s*"v" "m";/);
  expect(css).toMatch(/grid-template-areas:\s*"v m";/);
  expect(css).not.toMatch(/"p"/);
});

// --- header chips (derived from the League-phase helper) -------------------

// Red-tell (#1979 L12): rendering either chip unconditionally again turns the
// in-season cases red. While the season is live the phase chip is the header's
// news; the team count and the finished draft are background.
test('in-season: h1 league name with the Week/phase chip only, no team count or Draft Complete', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'MinneApple' })).toBeInTheDocument();
  // The phase label is the helper's own (LEAGUE_PHASE_META), never a parallel
  // in-page derivation; the week rides in front of it while the season is live.
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
  expect(screen.queryByText('12 Teams')).not.toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

test('playoffs: the season is still live, so the count and Draft Complete chips stay hidden', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ season_status: 'playoffs' }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.getByText('Week 3 · Playoffs')).toBeInTheDocument();
  expect(screen.queryByText('12 Teams')).not.toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

test('season complete: the phase chip, team count and Draft Complete chip all show', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ season_status: 'complete' }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.getByText('Complete')).toBeInTheDocument();
  expect(screen.getByText('12 Teams')).toBeInTheDocument();
  expect(screen.getByText('Draft Complete')).toBeInTheDocument();
});

test('pre-draft: shows the pre-draft phase label and team count and no Draft Complete chip', async () => {
  mockGetByUrl({ '/api/league/1': preDraftLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.getByText('Pre-draft')).toBeInTheDocument();
  expect(screen.getByText('8 Teams')).toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

test("pick'em-only: in season it shows the live week chip alone, with no team count and no draft chip", async () => {
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // A pick'em-only league is in season from creation, so the live week chip
  // renders and, being live, the count chip is gone; it has no draft, so the
  // draft chip never renders.
  expect(screen.getByText('Week 6 · In season')).toBeInTheDocument();
  expect(screen.queryByText('20 Teams')).not.toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

// --- copy-invite feature slice --------------------------------------------

test('commissioner (invite_code present): the Invite button copies the join link and confirms', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ invite_code: 'abc123' }) });
  renderPage();

  const inviteButton = await screen.findByRole('button', { name: /invite/i });
  // The accessible name carries the code so a screen-reader user hears which
  // league they are sharing.
  expect(inviteButton).toHaveAccessibleName(/abc123/);
  expect(screen.getByText('abc123')).toBeInTheDocument();

  await userEvent.click(inviteButton);

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/#/league/join?code=abc123`
  );
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  // The success is announced to assistive tech through a polite live region,
  // not left to the (inconsistently announced) button-name swap alone.
  expect(screen.getByRole('status')).toHaveTextContent('Invite link copied');
});

test('non-commissioner (no invite_code): no Invite button is rendered', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
});

// --- grid frame -----------------------------------------------------------

test('lays out the hero and main grid regions as empty landmarks', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The frame the widget tickets fill: two layout regions, each holding the
  // slots the widget tickets composed their own widgets into.
  expect(screen.getByTestId('dashboard-hero')).toBeInTheDocument();
  expect(screen.getByTestId('dashboard-main')).toBeInTheDocument();
});

// --- v2 composition and layout (#1110) --------------------------------------

// A fantasy in-season commissioner league: exercises every top-level slot at
// once (the strip renders content for a commissioner, unlike the plain-member
// fixtures above), so the DOM-order chain below is a real ordering claim, not
// an accident of several slots being absent.
const layoutV2League = (overrides = {}) =>
  leagueDetail({
    league: {
      draft_status: 'complete',
      season_status: 'regular',
      current_week: 3,
      is_commissioner: true,
      ...overrides,
    },
    teams: buildTeams(12),
    viewerTeamId: 1,
  });

test('v2 slot order: strip, hero, recap, around-the-league, main, quick actions, trophy', async () => {
  mockGetByUrl({ '/api/league/1': layoutV2League() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const strip = await screen.findByTestId('slot-commissioner-strip');
  const recap = screen.getByTestId('slot-recap');
  const hero = screen.getByTestId('dashboard-hero');
  const aroundTheLeague = screen.getByTestId('slot-around-the-league');
  const main = screen.getByTestId('dashboard-main');
  const quickActionsSection = screen.getByTestId('dashboard-quick-actions');
  const trophy = screen.getByTestId('slot-trophy-case');

  expect(precedes(strip, hero)).toBe(true);
  expect(precedes(hero, recap)).toBe(true);
  expect(precedes(recap, aroundTheLeague)).toBe(true);
  expect(precedes(aroundTheLeague, main)).toBe(true);
  expect(precedes(main, quickActionsSection)).toBe(true);
  expect(precedes(quickActionsSection, trophy)).toBe(true);

  // Main holds the standings beside a rail of Recent activity only.
  const standings = within(main).getByTestId('slot-standings');
  const recentActivity = within(main).getByTestId('slot-recent-activity');
  expect(precedes(standings, recentActivity)).toBe(true);
});

// `n` raw transaction rows, newest first.
const transactionRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: 100 - i,
    type: 'add',
    team_name: 'Team 1',
    player_name: `Player ${i + 1}`,
    detail: {},
    created_at: new Date(Date.UTC(2026, 8, 8, 20 - i)).toISOString(),
  }));

// Red-tell (#1993): Draft Grades is gone from the dashboard (product ruling on
// #1993), and the rail holds Recent activity in every fantasy phase. Putting
// Draft Grades back anywhere, or swapping the rail's occupant for the live
// season (the #1979 L5 composition), turns every case red. The rail is no
// longer sticky: on the Play-select boards the two frames stretch to one height.
test.each([
  ['pre-draft', () => layoutV2League({ draft_status: 'pending' })],
  ['drafting', () => layoutV2League({ draft_status: 'active' })],
  ['in season', () => layoutV2League()],
  ['playoffs', () => layoutV2League({ season_status: 'playoffs' })],
  ['season complete', () => layoutV2League({ season_status: 'complete' })],
])('rail occupant, %s: Recent activity rides the rail beside the standings and there is no Draft Grades', async (_phase, build) => {
  mockGetByUrl({ '/api/league/1': build() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const rail = screen.getByTestId('dashboard-rail');
  expect(within(rail).getByTestId('slot-recent-activity')).toBeInTheDocument();
  expect(screen.queryByTestId('slot-draft-grades')).not.toBeInTheDocument();
  expect(screen.queryByTestId('draft-grades')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Draft Grades' })).not.toBeInTheDocument();
  expect(cssFor(rail)).not.toMatch(/position:\s*sticky/);
});

// Red-tell (#1993): the rail tracks the standings. A Play-select standings row measures 44px
// and a two-line activity row about 59px (3:4), so the card shows ceil(teams * 3 / 4) rows.
// One row per Team (an earlier `min(teams, 12)`) turns every case red; the old
// `min(8, teams)` turns the 12 and 20-team cases red; a cap above the 17 rows a
// 20-team league needs turns the 25-team case red; rounding instead of ceil
// turns the 10-team case red (8 rows, not 7).
test.each([
  [6, 5],
  [10, 8],
  [12, 9],
  [20, 15],
  [25, 17],
])('the rail card shows ceil(teams * 3 / 4) rows at md, at most 17: %i teams, %i rows', async (teams, rows) => {
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
      teams: buildTeams(teams),
    }),
    '/api/league/1/transactions': { data: transactionRows(20) },
  });
  renderPage();

  const rail = await screen.findByTestId('dashboard-rail');
  await within(rail).findAllByTestId('recent-activity-row');
  expect(within(rail).getAllByTestId('recent-activity-row')).toHaveLength(rows);
});

// Red-tell (#1998): at md the standings and Recent activity sit side by side only
// when the feed fills the rail (ceil(12 * 3 / 4) = 9 rows at 12 teams). A feed
// that resolved shorter (zero rows and a failed read included) stacks them: one
// full-width column. Moving the threshold down one row turns the 8-row case red,
// up one turns the 9-row case red; the other cases bind the stack existing at
// all. The feed is read once per load.
const mainColumns = () => cssFor(screen.getByTestId('dashboard-main'));

test.each([
  ['an empty feed', { data: [] }],
  ['a failed read', { reject: new Error('boom') }],
  ['3 rows', { data: transactionRows(3) }],
  ['8 rows', { data: transactionRows(8) }],
])('a short feed stacks Recent activity under the standings: %s', async (_name, feed) => {
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
      teams: buildTeams(12),
    }),
    '/api/league/1/transactions': feed,
  });
  renderPage();

  const main = await screen.findByTestId('dashboard-main');
  // The base (xs) rule is one column already, so the 1.55fr md rule going away is
  // what shows the stack.
  await waitFor(() => expect(cssFor(main)).not.toMatch(/1\.55fr/));
});

test('a feed that fills the rail keeps the standings beside it (9 rows at 12 teams)', async () => {
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
      teams: buildTeams(12),
    }),
    '/api/league/1/transactions': { data: transactionRows(9) },
  });
  renderPage();

  const rail = await screen.findByTestId('dashboard-rail');
  await within(rail).findAllByTestId('recent-activity-row');
  expect(mainColumns()).toMatch(/1\.55fr/);
});

test('while the feed is loading the main row stays two columns', async () => {
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
      teams: buildTeams(12),
    }),
    '/api/league/1/transactions': { pending: true },
  });
  renderPage();

  await screen.findByTestId('dashboard-main');
  expect(mainColumns()).toMatch(/1\.55fr/);
});

// Red-tell (#1993): Quick Actions is alone under the main row, so it spans the
// shell's full content width, in a fantasy league and a pick'em-only one alike,
// mounted once. Re-pairing it in a two-track grid (the old second row), or
// keeping the pick'em-only duplicate mount beside the fantasy one, turns it red.
test.each([
  ['fantasy', () => layoutV2League()],
  ["pick'em-only", () => pickemOnlyLeague()],
])('%s: Quick Actions is one full-width section under the shell, with no grid pairing', async (_kind, build) => {
  mockGetByUrl({ '/api/league/1': build() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const section = screen.getByTestId('dashboard-quick-actions');
  expect(screen.getAllByTestId('dashboard-quick-actions')).toHaveLength(1);
  expect(screen.queryByTestId('dashboard-second-row')).not.toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-node-access
  expect(section.parentElement).toBe(screen.getByTestId('dashboard-shell'));
  expect(cssFor(section)).not.toMatch(/grid-template-columns/);
  expect(await within(section).findByTestId('quick-actions')).toBeInTheDocument();
});

test("a member renders no strip slot content and the wrapper collapses", async () => {
  mockGetByUrl({ '/api/league/1': layoutV2League({ is_commissioner: false }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const strip = screen.getByTestId('slot-commissioner-strip');
  expect(strip).toBeEmptyDOMElement();
  expect(screen.queryByTestId('commissioner-strip')).not.toBeInTheDocument();
});

test("pick'em-only branch mounts the strip, pick'em standings and Quick Actions, and none of the fantasy slots", async () => {
  mockGetByUrl({
    '/api/league/1': pickemOnlyLeague({ is_commissioner: true }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The strip renders for the commissioner even on a pick'em-only league
  // (CommissionerStrip's own scope: it states no fantasy facts there, but it
  // still mounts).
  expect(await screen.findByTestId('commissioner-strip')).toBeInTheDocument();
  expect(screen.getByTestId('dashboard-pickem-standings')).toBeInTheDocument();
  expect(screen.getByTestId('quick-actions')).toBeInTheDocument();

  // None of the fantasy-only slots mount.
  expect(screen.queryByTestId('dashboard-hero')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-around-the-league')).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-main')).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-second-row')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-recent-activity')).not.toBeInTheDocument();
});

test("pick'em-only: one Pick'em Standings heading names the card and no second Standings heading stacks under it", async () => {
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const region = screen.getByTestId('dashboard-pickem-standings');
  expect(within(region).getAllByRole('heading', { name: "Pick'em Standings" })).toHaveLength(1);
  expect(within(region).queryByRole('heading', { name: 'Standings' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: "Pick'em Standings" })).toHaveLength(1);
});

// Red-tell (pre-launch ruling #3): the hero-rule assertion below is the one
// this ticket adds since none bound `align-items` before it. Measured by
// hand: dropping `alignItems: 'stretch'` from the hero grid's sx turns this
// ONE test red (`npm test -- src/pages/league-dashboard`: 1 failed, 66
// passed, 67 total) and no other - restoring it returns the suite to green
// (67 passed, 67 total). Bound the same way the existing "zero minimum" tests
// bind a grid-track rule (cssFor + a regex over the emitted declaration), per
// the ruling.
test('hero grid binds align-items: stretch so My Team and the matchup card share the row height', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(cssFor(screen.getByTestId('dashboard-hero'))).toMatch(/align-items:\s*stretch/);
});

// ==========================================================================
// my-team-summary widget (#639), the hero-left slot. Each later widget ticket
// (#640-#643) appends its own section like this one: add the endpoints it reads
// to `mockGetByUrl` (a per-test `overrides` map, so no shared setup changes)
// and its own fixture builders, without editing the seam above.
//
// SCOPE EVERY VALUE ASSERTION to the widget under test with within(card): a
// grade letter, a roster value and a Team name are all rendered by sibling
// widgets on this same page (#640/#641 render the viewer's Team name, #642 a
// grade + roster value per team), and get*/find* throw on multiple matches, so
// a page-wide getByText for one of those turns green here but hard-fails in a
// sibling's PR. Page-level chrome (the header chips) stays page-scoped on
// purpose; only the per-widget values are scoped.
// ==========================================================================

// The viewer (teamId 1) plus one opponent. `teamName` is the canonical Team
// identity field (teamIdentity.js), distinct from the league name
// ('MinneApple') so a test can prove the card reads the viewer's Team from
// teams[], not the league or a user payload.
const myTeams = [
  { teamId: 1, id: 1, teamName: 'MyBallsHurts' },
  { teamId: 2, id: 2, teamName: 'Terrific T' },
];

// An in-season league whose viewer owns a named Team. Overrides pass straight
// through to leagueDetail (league columns, teams, viewerTeamId).
const myTeamLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: myTeams,
    viewerTeamId: 1,
    ...overrides,
  });

// GET /api/scoring/league/:id/standings - the widget's spine. Each row carries
// the record fields and a rank; `viewerRow` overrides the teamId-1 row.
const standingsResponse = (viewerRow = {}) => ({
  data: {
    standings: [
      { teamId: 1, name: 'MyBallsHurts', wins: 3, losses: 1, ties: 0, rank: 2, ...viewerRow },
      { teamId: 2, name: 'Terrific T', wins: 1, losses: 3, ties: 0, rank: 8 },
    ],
  },
});

// GET /api/league/:id/draft-grades - the viewer's grade + roster value.
const draftGradesResponse = (viewerRow = {}) => ({
  data: {
    computedAt: '2026-09-01T00:00:00.000Z',
    grades: [
      { teamId: 1, name: 'MyBallsHurts', grade: 'C', rosterValue: 1284, rank: 5, ...viewerRow },
      { teamId: 2, name: 'Terrific T', grade: 'A', rosterValue: 1620, rank: 1 },
    ],
  },
});

// GET /api/scoring/league/:id/power-rankings - the viewer's projected finish.
const powerRankingsResponse = (viewerRank = 6) => ({
  data: {
    season: 2026,
    week: 3,
    viewerTeamId: 1,
    data: {
      computedAt: '2026-09-01T00:00:00.000Z',
      rankings: [
        { teamId: 1, name: 'MyBallsHurts', rank: viewerRank },
        { teamId: 2, name: 'Terrific T', rank: viewerRank === 1 ? 2 : 1 },
      ],
    },
  },
});

// GET /api/team/lineup?leagueId=1&week=3 (#1101's starters section). Kept
// empty here: this block's own tests exercise the tile row only, and the
// starters section's content is covered in full by the widget's own suite
// (src/widgets/my-team-summary). An empty fixture still wires the endpoint
// into every test below so the widget's new read is never left to the
// dispatcher's unmatched-URL default.
const lineupResponse = () => ({ data: { week: 3, season: 2026, teamId: 1, entries: [] } });

test('my-team card shows the viewer Team name from teams[] with a You tag', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // The name is the viewer's Team (teamId 1), not the league name or any account
  // identifier: the one heading that names the frame.
  expect(within(card).getByRole('heading', { level: 2, name: 'MyBallsHurts' })).toBeInTheDocument();
  expect(within(card).getByText('You')).toBeInTheDocument();
});

test('my-team card: draft-grades fixture fills the grade and roster-value tiles', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': draftGradesResponse(),
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // Scoped to the card: #642 renders a grade letter for every team, so a
  // page-wide query would match many.
  expect(await within(card).findByText('C')).toBeInTheDocument();
  expect(within(card).getByText('1,284')).toBeInTheDocument();
});

// Week 1 of a season: the server sends the grade with rosterValue null (no
// projections exist yet). Number(null) is 0, which is exactly the "0 roster
// value" production showed; the tile must not render at all (#1979 L13).
test('my-team card: a null roster value drops the tile, not a 0 or a dash, while the grade still shows', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': draftGradesResponse({ rosterValue: null }),
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  expect(await within(card).findByText('C')).toBeInTheDocument();
  expect(within(card).queryByTestId('stat-roster-value')).not.toBeInTheDocument();
  expect(within(card).queryByText('Not available')).not.toBeInTheDocument();
});

test('my-team card: a 404 from draft-grades drops the grade and value tiles rather than dashing them', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': { reject: { response: { status: 404 } } },
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // The card settles (aria-busy clears) once the draft-grades read has failed;
  // only then is an absent tile an answer rather than a read still in flight.
  await waitFor(() => expect(card).toHaveAttribute('aria-busy', 'false'));
  expect(within(card).queryByTestId('stat-draft-grade')).not.toBeInTheDocument();
  expect(within(card).queryByTestId('stat-roster-value')).not.toBeInTheDocument();
  expect(within(card).queryByText('Not available')).not.toBeInTheDocument();
});

test('my-team card: no Proj. finish tile until power-rankings has been computed (404)', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/power-rankings': { reject: { response: { status: 404 } } },
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // Give the rejected read a tick to settle before asserting absence: the card
  // stops being busy once the standings spine and the draft-grades read land.
  await waitFor(() => expect(card).toHaveAttribute('aria-busy', 'false'));
  expect(screen.queryByTestId('stat-proj-finish')).not.toBeInTheDocument();
  expect(screen.queryByText('Proj. finish')).not.toBeInTheDocument();
});

test('my-team card: a power-rankings fixture placing the viewer 6th reads "6th"', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/power-rankings': powerRankingsResponse(6),
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  const projTile = await screen.findByTestId('stat-proj-finish');
  expect(projTile).toHaveTextContent('6th');
});

test('my-team card: the record and the standing line show once games have been played', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': standingsResponse({ wins: 3, losses: 1, ties: 0, rank: 2 }),
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  const record = await screen.findByTestId('my-team-record');
  expect(record).toHaveTextContent('3-1');
  // The standing line sits in the frame head: "2nd of 2" (this fixture has two teams).
  expect(screen.getByTestId('my-team-rank')).toHaveTextContent('2nd of 2');
});

test('my-team card: preseason (no games played) omits the secondary record line', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague({ league: { draft_status: 'complete', season_status: 'regular' } }),
    '/api/scoring/league/1/standings': standingsResponse({ wins: 0, losses: 0, ties: 0, rank: 1 }),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // The card is present and the standings read has resolved (it is no longer
  // busy), but with no games played there is no record line.
  await waitFor(() => expect(card).toHaveAttribute('aria-busy', 'false'));
  expect(screen.queryByTestId('my-team-record')).not.toBeInTheDocument();
});

test('my-team card: while standings are pending the card holds its layout with skeletons', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': { pending: true },
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  // The league resolves and the card mounts; its identity is up while the
  // standings spine is still in flight, so the data region is skeletons.
  const card = await screen.findByTestId('my-team-summary');
  expect(within(card).getAllByTestId('my-team-skeleton').length).toBeGreaterThan(0);
  // The card (the region that owns the fetch) announces the loading state to
  // assistive tech, since the skeleton shapes themselves are aria-hidden.
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('my-team card: a standings 500 shows one danger panel in the card while the page header chips still render', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500, data: { error: 'boom' } } } },
    '/api/team/lineup?leagueId=1&week=3': lineupResponse(),
  });
  renderPage();

  // The error is self-contained in the card's own slot, with a way to retry. The failed state is a
  // different element from the loading one, so the slot is queried again once it lands.
  await waitFor(() => expect(within(screen.getByTestId('my-team-summary')).getByRole('alert'))
    .toHaveTextContent('We could not load your team summary right now.'));
  expect(within(screen.getByTestId('my-team-summary')).getByRole('button', { name: 'Try loading your team summary again' })).toBeInTheDocument();
  // The rest of the page is untouched: the league header chips (page-level
  // chrome, so page-scoped on purpose) still render.
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
});

// ==========================================================================
// standings-table widget (#641), the main-grid slot-standings card. Appended
// after the my-team-summary section, which it shares the standings read with:
// both widgets read the same week-keyed useStandings entry, so the page issues
// ONE standings GET between them (AC4 below pins that count).
//
// Every identifier this section adds is slug-prefixed (`standingsTable*`,
// `standings-table-*`) so a sibling ticket appending its own section here can
// never collide silently with one of ours. Per-widget value assertions are
// scoped with within(card): the viewer's Team name and avatar are rendered by
// my-team-summary too, so a page-wide query would match more than one.
// ==========================================================================

// teams[] carrying the canonical `teamName` (teamIdentity.js) plus the raw
// avatar columns the league route serializes. The names are distinct from the
// standings rows' off-contract `name` column below, so a test can prove the
// card reads identity from teams[] and never from the standings row.
const standingsTableTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Squad ${i + 1}`,
    avatar_url: null,
    avatar_static_url: null,
  }));

// GET /api/scoring/league/:id/standings rows, in standings order (rank = the
// position). `name` is the raw, off-contract column the endpoint leaks beside
// identity; it is deliberately NOT the teams[] teamName, so a test can catch a
// widget that reads it. In-season values: distinct records and points per row.
const standingsTableRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    name: `RAW ${i + 1}`,
    wins: n - i,
    losses: i,
    ties: 0,
    pf: 1200 - i * 7.3,
    pa: 1000 + i * 3.1,
    rank: i + 1,
  }));

// Preseason rows: every team present, zero games played.
const standingsTablePreseasonRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1, name: `RAW ${i + 1}`, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, rank: i + 1,
  }));

const standingsTableResponse = (rows) => ({
  data: { league: { current_week: 3, season_status: 'regular' }, standings: rows },
});

// An in-season league whose viewer (teamId 1) owns a named Team in teams[].
const standingsTableLeague = (leagueOverrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3, ...leagueOverrides },
    teams: standingsTableTeams(12),
    viewerTeamId: 1,
  });

// A pre-draft league (phase before in-season): the honest empty state.
const standingsTablePreseasonLeague = () =>
  leagueDetail({
    league: { draft_status: 'pending' },
    teams: standingsTableTeams(8),
    viewerTeamId: 1,
  });

// The dispatcher's call count for the scoring-standings URL, the AC4 property.
const standingsTableGetCount = () =>
  apiClient.get.mock.calls.filter(
    ([url]) => typeof url === 'string' && /\/api\/scoring\/league\/\d+\/standings$/.test(url)
  ).length;

test('standings-table: in-season renders the full table, a team count, names from teams[], and one You badge', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  // Wait for the standings read to resolve (the card is present while it loads).
  await within(card).findByText('Squad 1');
  // Column headers: the board's six (rank, team, W-L-T, PF, PA, STRK).
  expect(within(card).getByText('Rank')).toBeInTheDocument();
  expect(within(card).getByText('Team')).toBeInTheDocument();
  expect(within(card).getByText('W-L-T')).toBeInTheDocument();
  expect(within(card).getByText('PF')).toBeInTheDocument();
  expect(within(card).getByText('PA')).toBeInTheDocument();
  expect(within(card).getByText('STRK')).toBeInTheDocument();
  // The header count of teams.
  expect(within(card).getByTestId('standings-table-count')).toHaveTextContent('12');
  // Each Team name comes from teams[] (teamName), never the standings row's raw
  // `name`: Squad 1 and Squad 12 render; RAW 1 does not.
  expect(within(card).getByText('Squad 1')).toBeInTheDocument();
  expect(within(card).getByText('Squad 12')).toBeInTheDocument();
  expect(within(card).queryByText('RAW 1')).not.toBeInTheDocument();
  // Exactly one You tag, in the viewer's own row - this already proves the
  // tag is absent from every non-viewer row, not just present on the
  // viewer's.
  const youBadges = within(card).getAllByText('You');
  expect(youBadges).toHaveLength(1);
  const youRow = within(card).getByTestId('standings-table-you-row');
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  expect(within(youRow).getByText('Squad 1')).toBeInTheDocument();
  // The row contract (#671): every row-shaped viewer mark carries
  // data-viewer-team, in addition to the visible You tag.
  expect(youRow).toHaveAttribute('data-viewer-team', 'true');
  // Exclusivity, checked directly (not just inferred from the tag count):
  // a non-viewer row carries neither half of the marker. Row 0 is the header;
  // row 1 is the viewer (Squad 1); row 2 is the first non-viewer row (Squad 2).
  const tableRows = within(card).getAllByRole('row');
  const otherRow = tableRows[2];
  expect(within(otherRow).getByText('Squad 2')).toBeInTheDocument();
  expect(otherRow).not.toHaveAttribute('data-viewer-team');
  expect(within(otherRow).queryByText('You')).not.toBeInTheDocument();
});

test('standings-table: in-season renders the viewer record as W-L (no ties) and points to one decimal', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // Viewer is row 0: 12 wins, 0 losses, 0 ties, pf 1200, pa 1000. Record is
  // conditional (#958): a tie-less Team never prints the zero tie part.
  expect(within(youRow).getByText('12-0')).toBeInTheDocument();
  expect(within(youRow).queryByText('12-0-0')).not.toBeInTheDocument();
  expect(within(youRow).getByText('1200.0')).toBeInTheDocument();
  expect(within(youRow).getByText('1000.0')).toBeInTheDocument();
});

test('standings-table: preseason masks records and points and shows the after-Week-1 note', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTablePreseasonLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTablePreseasonRows(8)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  // The table still renders its teams and ranks (wait for the read to resolve)...
  await within(card).findByText('Squad 1');
  // ...but no 0-0-0 record text anywhere, and the record/points cells are
  // placeholders (a screen-reader "Not available").
  expect(within(card).queryByText('0-0-0')).not.toBeInTheDocument();
  expect(within(card).getAllByText('Not available').length).toBeGreaterThan(0);
  // The honest empty-state note.
  const note = within(card).getByTestId('standings-table-preseason-note');
  expect(note).toHaveTextContent(/after Week 1/i);
});

test('standings-table: pending standings shows one skeleton row per team and marks the card busy', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  // eslint-disable-next-line testing-library/no-node-access -- skeleton rows are aria-hidden placeholders, so they are counted as elements
  expect(card.querySelectorAll('tbody tr')).toHaveLength(12);
  // The card owns the fetch, so it (not each aria-hidden skeleton) reports busy.
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('standings-table: a standings 500 shows one danger panel while the page header still renders', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  await waitFor(() => expect(within(screen.getByTestId('standings-table')).getByRole('alert'))
    .toHaveTextContent('We could not load the standings right now.'));
  expect(within(screen.getByTestId('standings-table')).getByRole('button', { name: 'Try loading the standings again' })).toBeInTheDocument();
  // The page header still renders beside the error.
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
});

test('standings-table: advancing the league current week causes a second standings GET (1 -> 2)', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague({ current_week: 3 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // One GET for the page: my-team-summary and standings-table share the read.
  expect(standingsTableGetCount()).toBe(1);

  // The week advances. Re-point the league mock and invalidate the shared league
  // cache so the mounted page re-reads it; the standings key is week-scoped, so
  // week 4 is a new entry and a second GET.
  mockGetByUrl({
    '/api/league/1': standingsTableLeague({ current_week: 4 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  act(() => {
    clearLeagueCache(1);
  });
  await waitFor(() => expect(standingsTableGetCount()).toBe(2));
});

// ==========================================================================
// matchup-preview widget (#640), the hero-right slot. Same seam as the
// sections above: this ticket registers its own endpoints on `mockGetByUrl`
// and its own fixture builders without editing anything already here.
//
// SCOPE EVERY VALUE ASSERTION with within(card): the viewer's Team name and
// avatar are rendered by my-team-summary (hero-left) too, so a page-wide query
// for 'MyBallsHurts' would throw on multiple matches. Page-level chrome (the
// header chips) stays page-scoped on purpose.
//
// This widget makes a CHAINED read the earlier sections did not: a matchups
// list read, then a detail read for the matchup it selects. The detail URL
// depends on the first response, so the tests below prove the second read never
// fires with a null id, and that the list read happens exactly once.
// ==========================================================================

// teamId 3 is the viewer, 7 the opponent. `teamName` is the canonical Team
// identity field (teamIdentity.js), kept distinct from the league name
// ('MinneApple') so a test can prove the card reads teams[], not the league.
const mpTeams = [
  { teamId: 3, id: 3, teamName: 'MyBallsHurts', avatar_url: null, avatar_static_url: null },
  { teamId: 7, id: 7, teamName: 'Terrific T', avatar_url: null, avatar_static_url: null },
];

// A week-1 in-season league whose viewer (id 3) owns a named Team. Overrides
// pass straight through to leagueDetail (league columns, teams, viewerTeamId).
const mpLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 1 },
    teams: mpTeams,
    viewerTeamId: 3,
    ...overrides,
  });

// GET /api/league/:id/matchups?week=N - a BARE ARRAY (the real endpoint's
// shape), carrying the raw matchups.* columns the pairing reads (id +
// home/away_team_id). `attachExpectedFinals` also rides on the real row as
// `home_expected_final` / `away_expected_final`, which the widget now prefers
// (#670). `mpViewerPaired` below deliberately omits both fields (`undefined`,
// which the widget's `!= null` check treats the same as `null`): that is what
// keeps the pre-existing tests below on the chained detail-read path. The
// #670 tests that exercise the list-preferred path build their own row via
// `{ ...mpViewerPaired[0], home_expected_final: ..., away_expected_final: ... }`
// rather than adding the fields here.
const mpMatchupsList = (rows) => ({ data: rows });

// A week-1 list pairing the viewer (home, Team 3) against Team 7 as matchup 55,
// plus one unrelated matchup so the pick is a real find, not the only row.
const mpViewerPaired = [
  { id: 55, week: 1, season: 2026, home_team_id: 3, away_team_id: 7, final: false },
  { id: 56, week: 1, season: 2026, home_team_id: 5, away_team_id: 9, final: false },
];

// A week-1 list in which the viewer (Team 3) appears nowhere.
const mpViewerUnpaired = [
  { id: 56, week: 1, season: 2026, home_team_id: 5, away_team_id: 9, final: false },
  { id: 57, week: 1, season: 2026, home_team_id: 8, away_team_id: 2, final: false },
];

// GET /api/league/:id/matchups/:matchupId - detail. The widget reads only each
// side's `expectedFinal` here (the field the matchup detail page renders under
// a "Projected" label); names + avatars come from teams[], never the detail's
// off-contract `name` column, so the fixture's names are deliberately wrong.
const mpMatchupDetail = ({ homeFinal = 112.4, awayFinal = 118.9 } = {}) => ({
  data: {
    viewerTeamId: 3,
    matchup: { id: 55, week: 1, season: 2026, home_team_id: 3, away_team_id: 7 },
    home: { teamId: 3, name: 'WRONG home name', expectedFinal: homeFinal, starters: [], bench: [] },
    away: { teamId: 7, name: 'WRONG away name', expectedFinal: awayFinal, starters: [], bench: [] },
  },
});

const MP_LIST_URL = '/api/league/1/matchups?week=1';
const MP_DETAIL_URL = '/api/league/1/matchups/55';

// The dashboard's own Play-select view of this read (ui/VersusPanel): a framed
// versus panel before kickoff, the Board-black scoreboard once started. The
// model underneath is the matchup-preview widget's, unchanged.
const viewerFigure = (card) => within(card).getByTestId('matchup-figure-viewer');
// The loading, pre-kickoff and scoreboard states are different elements, so a card grabbed while the
// read is in flight goes stale: wait for the state under test, then take the card.
const findStartedMatchup = async () => {
  await screen.findByTestId('matchup-versus');
  return screen.getByTestId('matchup-preview');
};
const opponentFigure = (card) => within(card).getByTestId('matchup-figure-opponent');

test('matchup card: heading, both Team names from teams[], and each projected total beside a Proj label', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(within(card).getByRole('heading', { level: 2, name: 'Week 1 Matchup' })).toBeInTheDocument();
  // Names come from teams[] (teamName), matched by id, NOT the detail's name.
  const versus = await within(card).findByTestId('matchup-versus');
  expect(within(versus).getByRole('heading', { level: 3, name: 'MyBallsHurts' })).toBeInTheDocument();
  expect(within(versus).getByRole('heading', { level: 3, name: 'Terrific T' })).toBeInTheDocument();
  // The projected totals arrive on the chained detail read, each under a "Proj" label.
  expect(await within(card).findByText('112.4')).toBeInTheDocument();
  expect(viewerFigure(card)).toHaveTextContent('112.4');
  expect(opponentFigure(card)).toHaveTextContent('118.9');
  expect(within(versus).getAllByText('Proj')).toHaveLength(2);
  // Before kickoff the panel is framed, not Board black, and says it is scheduled only when the
  // server says so (these rows carry no status, so it asserts neither state).
  expect(card).not.toHaveAttribute('data-state');
  expect(within(card).queryByText('Live')).not.toBeInTheDocument();
});

// Viewer first (spec #2402): an away viewer's Team is drawn first and carries its own figure.
test('matchup card: an away viewer sees their own Team first, with their own projected total', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([{ id: 55, week: 1, season: 2026, home_team_id: 7, away_team_id: 3, final: false }]),
    [MP_DETAIL_URL]: {
      data: {
        viewerTeamId: 3,
        matchup: { id: 55, week: 1, season: 2026, home_team_id: 7, away_team_id: 3 },
        home: { teamId: 7, name: 'WRONG home name', expectedFinal: 118.9, starters: [], bench: [] },
        away: { teamId: 3, name: 'WRONG away name', expectedFinal: 112.4, starters: [], bench: [] },
      },
    },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const versus = await within(card).findByTestId('matchup-versus');
  const names = within(versus).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(names).toEqual(['MyBallsHurts', 'Terrific T']);
  expect(await within(card).findByText('112.4')).toBeInTheDocument();
  expect(viewerFigure(card)).toHaveTextContent('112.4');
  expect(opponentFigure(card)).toHaveTextContent('118.9');
});

test('matchup card: the Matchup link goes to the matchup detail page and is named for both teams', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const link = await within(card).findByRole('link', { name: 'Matchup, MyBallsHurts against Terrific T' });
  // The matchup id (55) rides on the href (#1979 L4: the lineup link is not here;
  // My team and the Playbook carry it).
  expect(link.getAttribute('href')).toMatch(/\/league\/1\/matchups\/55$/);
  expect(within(card).queryByRole('link', { name: 'Set Lineup' })).not.toBeInTheDocument();
  // The one label for this destination: no "Compare rosters".
  expect(within(card).queryByRole('link', { name: 'Compare rosters' })).not.toBeInTheDocument();
});

test('matchup card: with no matchup for the viewer this week, the card reads "No matchup this week" and has no links', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerUnpaired),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(await within(card).findByText('No matchup this week')).toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  // The chained detail read must NOT fire with a null id when there is no pick.
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

test('matchup card: a 500 from the matchups list shows one danger panel in the card while my-team and the header still render', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  await waitFor(() => expect(within(screen.getByTestId('matchup-preview')).getByRole('alert'))
    .toHaveTextContent("We could not load this week's matchup right now."));
  expect(within(screen.getByTestId('matchup-preview')).getByRole('button', { name: 'Try loading the matchup again' })).toBeInTheDocument();
  // The failed read is self-contained: the sibling widget and the page header
  // chips (page-level chrome, so page-scoped on purpose) still render.
  expect(screen.getByTestId('my-team-summary')).toBeInTheDocument();
  expect(screen.getByText('Week 1 · In season')).toBeInTheDocument();
});

test('matchup card: exactly one matchups-list GET is made, and it carries the current week', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  // Wait for the chained detail read to land so any re-render that would double
  // the list request has already had its chance before we count. The page's own
  // read of the week (the head's live count) is the same shared cache entry, so
  // it is the same one request.
  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByText('112.4');
  const listGets = apiClient.get.mock.calls.filter(([u]) => u.includes('/matchups?week='));
  expect(listGets).toHaveLength(1);
  expect(listGets[0][0]).toContain('week=1');
});

test('matchup card: with no current week the card reads "No matchup this week" and requests no week-scoped matchups list', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague({
      league: { draft_status: 'complete', season_status: 'regular', current_week: null },
    }),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(await within(card).findByText('No matchup this week')).toBeInTheDocument();
  // No week, so the null-url convention keeps THIS widget's own week-scoped
  // spine read from ever firing. Scoped to the `?week=` list URL, not a bare
  // '/matchups' substring: around-the-league (#1103, composed on this page
  // since #1110) reads every week unconditionally through its own entity hook
  // and is unaffected by this league having no current week, so a bare
  // substring match would catch its GET too and assert something untrue of
  // this card.
  expect(
    apiClient.get.mock.calls.some(([u]) => typeof u === 'string' && u.includes('/matchups?week='))
  ).toBe(false);
});

test('matchup card: while the matchups list is pending the card holds layout with skeletons and is aria-busy', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(within(card).getAllByTestId('matchup-skeleton').length).toBeGreaterThan(0);
  // The card (the region that owns the fetch) announces the loading state; the
  // skeleton shapes themselves are aria-hidden.
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('matchup card: while the detail read is pending the pairing shows with skeletoned totals and stays aria-busy', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  // Identity is up from the list + teams[] while the projected totals wait on
  // the chained read, so the card is still layout-busy.
  expect(await within(card).findByRole('heading', { level: 3, name: 'MyBallsHurts' })).toBeInTheDocument();
  expect(within(viewerFigure(card)).getByTestId('matchup-skeleton')).toBeInTheDocument();
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('matchup card: a failed detail read degrades the projected totals to a placeholder without erroring the card', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: { reject: { response: { status: 500 } } },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const versus = await within(card).findByTestId('matchup-versus');
  // The pairing (from the list + teams[]) still renders: the spine is fine, so a
  // failed detail read degrades only the number, it does not error the card.
  expect(within(versus).getByRole('heading', { level: 3, name: 'MyBallsHurts' })).toBeInTheDocument();
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  // The projected total is a placeholder: no digits, a real "Not available" for
  // a screen reader, and the "Proj" label is not left pointing at nothing.
  await within(viewerFigure(card)).findByText('Not available');
  expect(viewerFigure(card).textContent).not.toMatch(/\d/);
  expect(within(versus).getAllByText('Proj')).toHaveLength(2);
  // The detail read has settled, so the card is no longer busy.
  await waitFor(() => expect(card).toHaveAttribute('aria-busy', 'false'));
});

// #670: the list row already carries `home_expected_final` /
// `away_expected_final` (attachExpectedFinals). The widget now prefers those
// over the detail read, and falls back to the detail only when either side is
// null there (never on a bare falsy check: a legitimate 0 is a value).
test('matchup card: list row with both expected finals present renders them and never reads the detail', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: 101.2, away_expected_final: 97.5 },
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByTestId('matchup-versus');
  expect(viewerFigure(card)).toHaveTextContent('101.2');
  expect(opponentFigure(card)).toHaveTextContent('97.5');
  expect(card).toHaveAttribute('aria-busy', 'false');
  // The list already answered both sides, so the detail read must never fire.
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

test('matchup card: list row with one side null falls back to the detail read and renders its values', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: null, away_expected_final: 97.5 },
      mpViewerPaired[1],
    ]),
    [MP_DETAIL_URL]: mpMatchupDetail({ homeFinal: 112.4, awayFinal: 118.9 }),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByTestId('matchup-versus');
  // Both sides come from the detail response once the fallback fires, not a mix
  // of the list's non-null side and the detail's: the fallback is all-or-nothing.
  expect(await within(card).findByText('112.4')).toBeInTheDocument();
  expect(opponentFigure(card)).toHaveTextContent('118.9');
  expect(apiClient.get.mock.calls.some(([u]) => u === MP_DETAIL_URL)).toBe(true);
});

test('matchup card: a list value of 0 is a real value, not a trigger for the detail read', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: 0, away_expected_final: 45.6 },
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByTestId('matchup-versus');
  expect(await within(card).findByText('0.0')).toBeInTheDocument();
  expect(opponentFigure(card)).toHaveTextContent('45.6');
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

// #688: a best-ball league's list row is null on both sides by design
// (attachExpectedFinals short-circuits on league.best_ball), and the matchup
// detail route short-circuits on the very same flag through the very same
// producer (expectedFinalsForWeek), so the detail read can never answer
// either. The widget must not fire it: both sides settle straight to the
// placeholder once the list resolves, with no detail round trip and no
// aria-busy hang (a null detail URL would otherwise park that read on
// 'loading' forever).
test('matchup card: a best-ball league skips the detail read, rendering both placeholders once the list resolves', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 1,
        best_ball: true,
      },
    }),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: null, away_expected_final: null },
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByTestId('matchup-versus');
  expect(await within(viewerFigure(card)).findByText('Not available')).toBeInTheDocument();
  expect(within(opponentFigure(card)).getByText('Not available')).toBeInTheDocument();
  expect(card).toHaveAttribute('aria-busy', 'false');
  // The detail URL must never be requested: neither read can answer for a
  // best-ball league, so paying for the round trip buys nothing.
  expect(apiClient.get.mock.calls.some(([u]) => u === MP_DETAIL_URL)).toBe(false);
});

// Once the matchup has started the panel is the Board-black scoreboard (the
// dashboard's view of the live state): the score block is one link, the margin
// sits under the viewer's score, and a polite live region carries the sentence.
const mpLiveRow = (overrides = {}) => ({
  ...mpViewerPaired[0],
  status: 'live',
  home_score: '61.0',
  away_score: '58.9',
  home_expected_final: 112.4,
  away_expected_final: 108.1,
  home_players_remaining: 7,
  away_players_remaining: 9,
  ...overrides,
});

test('matchup card: a live matchup is the Board-black scoreboard, with the margin under the viewer, a live chip and a polite sentence', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([mpLiveRow(), mpViewerPaired[1]]),
  });
  renderPage();

  const card = await findStartedMatchup();
  expect(card).toHaveAttribute('data-state', 'live');
  expect(rulesUnder(card)['']).toMatch(/background-color:\s*var\(--ps-board\)/);
  expect(rulesUnder(card)['']).toMatch(/border:\s*6px double var\(--ps-board-dim\)/);
  expect(within(card).getByText('Live')).toBeInTheDocument();
  expect(viewerFigure(card)).toHaveTextContent('61.0');
  expect(opponentFigure(card)).toHaveTextContent('58.9');
  // The viewer leads by 2.1: the margin sits directly under the viewer's score; the Expected final
  // and the players remaining ride per side.
  expect(within(card).getByText('Up 2.1')).toBeInTheDocument();
  expect(within(card).getByText('7 players remaining')).toBeInTheDocument();
  expect(within(card).getByText('9 players remaining')).toBeInTheDocument();
  expect(within(card).getByText('112.4')).toBeInTheDocument();
  // The score block is one link whose name states the whole score.
  const link = within(card).getByRole('link', { name: /^Matchup: MyBallsHurts lead Terrific T 61\.0 to 58\.9, expected final 112\.4 to 108\.1, \d+% MyBallsHurts win probability\. PMR, players remaining: 7 for MyBallsHurts and 9 for Terrific T$/ });
  expect(link.getAttribute('href')).toMatch(/\/league\/1\/matchups\/55$/);
  // A visually hidden polite region carries the score sentence.
  const region = within(card).getByTestId('matchup-live-region');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('MyBallsHurts 61.0, Terrific T 58.9');
  // The live odds bar is the one place green sits on this panel, and the board stays flash-free at rest.
  expect(within(card).getByRole('img', { name: /^MyBallsHurts win probability \d+%$/ })).toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-node-access
  expect(card.querySelector('.scored')).toBeNull();
});

test('matchup card: a trailing viewer reads "Down" and the opponent is the leader', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([mpLiveRow({ home_score: '40.0', away_score: '44.5' }), mpViewerPaired[1]]),
  });
  renderPage();

  const card = await findStartedMatchup();
  expect(within(card).getByText('Down 4.5')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: /MyBallsHurts trail Terrific T 40\.0 to 44\.5/ })).toBeInTheDocument();
});

test('matchup card: a final matchup is a result on Board black, not a live screen', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      mpLiveRow({ status: 'final', final: true, home_score: '118.4', away_score: '96.2' }),
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await findStartedMatchup();
  expect(card).toHaveAttribute('data-state', 'settled');
  expect(within(card).getByText('Final')).toBeInTheDocument();
  expect(within(card).queryByText('Live')).not.toBeInTheDocument();
  expect(within(card).getByText('Won by 22.2')).toBeInTheDocument();
  expect(within(card).queryByText(/players remaining/)).not.toBeInTheDocument();
  expect(within(card).queryByText('Expected final')).not.toBeInTheDocument();
});

// ==========================================================================
// quick-actions widget (#643), the full-width section below the main grid.
// Same seam as the sections above: this ticket registers its own endpoint
// (the viewer roster) on `mockGetByUrl` and its own fixture builders without
// editing anything already here.
//
// Every identifier this section adds is slug-prefixed (`quickActions*`,
// `quick-action(s)-*`) so a sibling ticket appending its own section here can
// never collide silently with one of ours. Per-widget value assertions are
// scoped with within(card) (the widget's own `quick-actions` card) or
// within(tile) (one action link): "Set Lineup" is also rendered as a link by
// matchup-preview above, and "Recommended" would collide across cards, so a
// page-wide query for either would throw on multiple matches. The one
// deliberately page-wide assertion is AC2's negative ("no Recommended anywhere
// on an in-season member page"), which is exactly a page-level claim.
//
// AC5 scope note: a pick'em-only league still renders the my-team, matchup,
// standings cards today (their pick'em gating is #645's
// cutover job, not this ticket). "Shows only Pick'em, Activity, History and
// League Rules" is a claim about THIS widget's own card list, so it is scoped
// with within(card).
// ==========================================================================

// The viewer (teamId 1) plus one opponent, carrying the canonical `teamName`.
const quickActionsTeams = [
  { teamId: 1, id: 1, teamName: 'MyBallsHurts' },
  { teamId: 2, id: 2, teamName: 'Terrific T' },
];

// An in-season fantasy league whose viewer (teamId 1) owns a Team. Overrides
// pass straight through to leagueDetail (league columns, teams, viewerTeamId).
const quickActionsLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: quickActionsTeams,
    viewerTeamId: 1,
    ...overrides,
  });

// The standard 9-starter roster shape, as the league row's `roster_slots`
// jsonb. #1210 deleted lineupAttention's client-side default starter order
// (ADR 0029's sibling concern: a default guesses at a fantasy-standard shape
// that mis-places IDP starters), so every assertion below that needs a
// starting slot to exist - empty-slot AND bye alike - now supplies this.
const quickActionsStandardSlots = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];

// GET /api/team/lineup?leagueId=1&week=3 - the lineup envelope. Quick Actions
// and My Team read this ONE wire (#1981), so the Set Lineup recommendation reads
// each entry's `slot` and the server's own `onBye` verdict (annotateLineupEntries).
const quickActionsLineupResponse = (entries) => ({
  data: { leagueId: 1, teamId: 1, season: 2026, week: 3, currentWeek: 3, entries },
});

// A full standard starting lineup: one player per starting slot instance of
// quickActionsStandardSlots. Nobody is on the CURRENT week's bye. DEF One
// deliberately carries an OFF-week bye (bye_week 5, so `onBye` false, as the
// server annotates it for week 3): a widget that read `bye_week` instead of the
// entry's `onBye` would flag it, so its presence in the no-current-week-bye
// cases pins the read to the server's verdict.
const quickActionsFullRoster = () => [
  { id: 11, name: 'QB One', slot: 'QB', bye_week: null, onBye: false },
  { id: 12, name: 'RB One', slot: 'RB', bye_week: null, onBye: false },
  { id: 13, name: 'RB Two', slot: 'RB', bye_week: null, onBye: false },
  { id: 14, name: 'WR One', slot: 'WR', bye_week: null, onBye: false },
  { id: 15, name: 'WR Two', slot: 'WR', bye_week: null, onBye: false },
  { id: 16, name: 'TE One', slot: 'TE', bye_week: null, onBye: false },
  { id: 17, name: 'FLEX One', slot: 'FLEX', bye_week: null, onBye: false },
  { id: 18, name: 'K One', slot: 'K', bye_week: null, onBye: false },
  { id: 19, name: 'DEF One', slot: 'DEF', bye_week: 5, onBye: false },
];

const QUICK_ACTIONS_LINEUP_URL = '/api/team/lineup?leagueId=1&week=3';

// Two trophies of the 2026 season (the weekly awards a league has handed out so far).
const quickActionsTrophies = () => ({
  data: [
    { id: 1, season: 2026, week: 1, type: 'weekly_high', label: 'Weekly High', team_id: 2, team_name: 'Terrific T' },
    { id: 2, season: 2026, week: 2, type: 'closest_game', label: 'Closest Game', team_id: 1, team_name: 'MyBallsHurts' },
  ],
});

// The Playbook says each destination once (DESIGN.md "Say it once"): in season it is one line of links
// that ends in the trophy case, and it drops every tile another frame on the page already links.
test('quick-actions: in season the Playbook is one link row ending in the trophy case, and drops what the page shows elsewhere', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague(),
    '/api/league/1/trophies': quickActionsTrophies(),
  });
  renderPage();

  const nav = await screen.findByRole('navigation', { name: 'Playbook' });
  await within(nav).findByRole('link', { name: 'Trophy case (2)' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
    "Pick'em", 'Power Rankings', 'History', 'League Rules', 'Trophy case (2)',
  ]);
  expect(within(nav).getByRole('link', { name: 'Trophy case (2)' }).getAttribute('href')).toBe('/league/1/trophies');
  // Dropped: the Draft Room (the draft is over), Set Lineup, Waivers and Trades (My team links them),
  // Game Center (Around the league), Activity (Recent activity).
  ['draft', 'lineup', 'waivers', 'trades', 'game-center', 'activity'].forEach((key) => {
    expect(within(nav).queryByTestId(`quick-action-${key}`)).not.toBeInTheDocument();
  });
  // The trophy case is not a second row.
  expect(screen.queryByTestId('trophy-link')).not.toBeInTheDocument();
  expect(screen.queryByText('Trophy room')).not.toBeInTheDocument();
});

// The count above is the live season's `useTrophies` read, so its link has to
// open a destination that shows that same read. League History is the season
// archive (CONTEXT.md "Season archive"), and clicking through to it renders
// "The Hall of Fame is empty." with the weekly awards nowhere on screen.
test('quick-actions: the trophy link opens the live trophy case, not the empty archive', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague(),
    '/api/league/1/trophies': quickActionsTrophies(),
  });
  renderWithProviders(<LeagueDashboardPage />, {
    path: '/league/:leagueId',
    route: '/league/1',
    routes: (
      <>
        <Route path="/league/:leagueId/history" element={<LeagueHistoryPage />} />
        <Route path="/league/:leagueId/trophies" element={<LeagueTrophiesPage />} />
      </>
    ),
  });

  const nav = await screen.findByRole('navigation', { name: 'Playbook' });
  await userEvent.click(await within(nav).findByRole('link', { name: 'Trophy case (2)' }));

  expect(await screen.findByTestId('league-trophies')).toBeInTheDocument();
  const room = await screen.findByTestId('trophy-case');
  expect(within(room).getByText('Weekly High')).toBeInTheDocument();
  expect(within(room).getByText('Closest Game')).toBeInTheDocument();
  expect(screen.queryByText('The Hall of Fame is empty.')).not.toBeInTheDocument();
});

test('quick-actions: a pre-draft commissioner fixture adds Draft Settings and the League group holds the four league tiles', async () => {
  mockGetByUrl({ '/api/league/1': quickActionsLeague({ league: { draft_status: 'pending', season_status: 'pending', current_week: 3, is_commissioner: true } }) });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  // Pre-draft the Playbook is the frame: Power Rankings, History, League Rules and Draft Settings
  // (Activity is Recent activity's link, Waivers and Trades are My team's).
  expect(within(card).getByText('League · 4')).toBeInTheDocument();
  const draftSettings = within(card).getByTestId('quick-action-draft-settings');
  expect(draftSettings.getAttribute('href')).toMatch(/\/league\/1\/draft-settings$/);
  expect(within(card).queryByTestId('quick-action-waivers')).not.toBeInTheDocument();
  expect(within(card).queryByText(/^Moves ·/)).not.toBeInTheDocument();
});

// The lineup recommendation and its agreement with My team are properties of the two widgets' shared
// lineup read, not of the page, and the page drops the Set Lineup tile in season (My team links it).
// So these cases mount the two widgets side by side on the same seam instead.
const renderPlaybookAndMyTeam = () =>
  renderWithProviders(
    <>
      <QuickActions leagueId="1" />
      <MyTeamSummary leagueId="1" />
    </>
  );

test('quick-actions: two starters on a current-week bye mark Set Lineup Recommended with the bye copy', async () => {
  const roster = quickActionsFullRoster().map((row) =>
    row.slot === 'QB' || row.id === 12 ? { ...row, bye_week: 3, onBye: true } : row
  );
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 3,
        roster_slots: quickActionsStandardSlots,
      },
    }),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(roster),
  });
  renderPlaybookAndMyTeam();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // The recommendation lands once the lineup read resolves.
  expect(await within(tile).findByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('2 starters on bye · fix before Sunday')).toBeInTheDocument();
});

test('quick-actions: a full roster with no current-week byes shows no Recommended anywhere', async () => {
  // roster_slots is supplied so the empty-slot half of the recommendation is
  // LIVE here, not inert: with the required slots known, an empty roster would
  // read 9 empty slots and recommend. A full roster is therefore the reason
  // there is no recommendation, not a coincidence of missing config. The full
  // roster also carries DEF One's off-week bye (bye_week 5 vs current_week 3),
  // so this asserts the widget counts current-week byes only.
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 3,
        roster_slots: quickActionsStandardSlots,
      },
    }),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(quickActionsFullRoster()),
  });
  renderPlaybookAndMyTeam();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // Wait for the lineup read to resolve into the plain Set Lineup copy, so the
  // absence assertion below is not merely racing an unresolved read.
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
});

test('quick-actions: a starter missing from a slot the league requires marks Set Lineup Recommended and names the empty-slot count', async () => {
  // Standard slots require two WRs; drop one so a single WR fills the slot.
  const roster = quickActionsFullRoster().filter((row) => row.id !== 15);
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 3,
        roster_slots: quickActionsStandardSlots,
      },
    }),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(roster),
  });
  renderPlaybookAndMyTeam();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  expect(await within(tile).findByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('1 empty starting slot')).toBeInTheDocument();
});

test('quick-actions: a 500 from the lineup read leaves every card rendered and none in an error state', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague(),
    [QUICK_ACTIONS_LINEUP_URL]: { reject: { response: { status: 500 } } },
  });
  renderPlaybookAndMyTeam();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // Set Lineup renders its plain copy (the recommendation is best effort), and
  // the failed read never surfaces an error.
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  expect(within(tile).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  // Every group's cards still render.
  ['draft', 'lineup', 'game-center', 'pickem', 'waivers', 'trades', 'activity', 'power-rankings', 'history', 'rules'].forEach((key) => {
    expect(within(card).getByTestId(`quick-action-${key}`)).toBeInTheDocument();
  });
});

// One lineup answer (#1981 L3): Quick Actions and My Team read the SAME
// /api/team/lineup wire through the shared cache, so they cannot disagree about
// an empty slot or a spent one, and the page pays one request for both.
const quickActionsAgreementLeague = () =>
  quickActionsLeague({
    league: {
      draft_status: 'complete',
      season_status: 'regular',
      current_week: 3,
      roster_slots: quickActionsStandardSlots,
    },
  });

const lineupGets = () =>
  apiClient.get.mock.calls.filter(([url]) => String(url).startsWith('/api/team/lineup'));

test('quick-actions: with a full lineup, Quick Actions and My Team agree it is set, off one lineup request', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsAgreementLeague(),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(quickActionsFullRoster()),
  });
  renderPlaybookAndMyTeam();

  const tile = within(await screen.findByTestId('quick-actions')).getByTestId('quick-action-lineup');
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  const myTeam = await screen.findByTestId('my-team-summary');
  expect(await within(myTeam).findByText(/Lineup set/)).toBeInTheDocument();
  expect(screen.queryByText(/empty starting slot/)).not.toBeInTheDocument();
  expect(lineupGets()).toHaveLength(1);
});

test('quick-actions: with an empty starting slot, Quick Actions and My Team both report it', async () => {
  const entries = quickActionsFullRoster().filter((row) => row.id !== 15);
  mockGetByUrl({
    '/api/league/1': quickActionsAgreementLeague(),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(entries),
  });
  renderPlaybookAndMyTeam();

  const tile = within(await screen.findByTestId('quick-actions')).getByTestId('quick-action-lineup');
  expect(await within(tile).findByText('1 empty starting slot')).toBeInTheDocument();
  const myTeam = await screen.findByTestId('my-team-summary');
  expect(await within(myTeam).findByText(/Lineup incomplete · 8 of 9/)).toBeInTheDocument();
  expect(lineupGets()).toHaveLength(1);
});

test('quick-actions: a spent starting slot counts as filled in Quick Actions and My Team alike', async () => {
  // FLEX One has left the roster: the lineup wire keeps his settled row
  // (`spent`, original slot), which /api/team/roster would have dropped.
  const entries = quickActionsFullRoster().map((row) =>
    row.slot === 'FLEX' ? { ...row, spent: true, onBye: false } : row
  );
  mockGetByUrl({
    '/api/league/1': quickActionsAgreementLeague(),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(entries),
  });
  renderPlaybookAndMyTeam();

  const tile = within(await screen.findByTestId('quick-actions')).getByTestId('quick-action-lineup');
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  const myTeam = await screen.findByTestId('my-team-summary');
  expect(await within(myTeam).findByText(/Lineup set · 9 of 9/)).toBeInTheDocument();
  expect(within(tile).queryByText('Recommended')).not.toBeInTheDocument();
  expect(lineupGets()).toHaveLength(1);
});

test('quick-actions: the page never reads /api/team/roster', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsAgreementLeague(),
    [QUICK_ACTIONS_LINEUP_URL]: quickActionsLineupResponse(quickActionsFullRoster()),
  });
  renderPage();

  await screen.findByTestId('quick-actions');
  await screen.findByText(/Lineup set/);
  expect(apiClient.get.mock.calls.some(([url]) => String(url).includes('/api/team/roster'))).toBe(false);
});

test('quick-actions: a drafting-phase fixture marks Draft Room Recommended', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({ league: { draft_status: 'active', season_status: 'regular', current_week: 3 } }),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-draft');
  expect(within(tile).getByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('Draft is live now · make your picks')).toBeInTheDocument();
});

test("quick-actions: a pick'em-only in-season fixture shows only Pick'em, Activity, History and League Rules and marks Pick'em Recommended", async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: { pickem_only: true, draft_status: 'pending', season_status: 'regular', current_week: 6 },
    }),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  // The only cards in this widget's list are the four non-fantasy ones.
  expect(within(card).getByTestId('quick-action-pickem')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-activity')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-history')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-rules')).toBeInTheDocument();
  // The fantasy-only cards (and the Moves group) are gone.
  ['draft', 'lineup', 'game-center', 'waivers', 'trades', 'power-rankings', 'draft-settings'].forEach((key) => {
    expect(within(card).queryByTestId(`quick-action-${key}`)).not.toBeInTheDocument();
  });
  expect(within(card).getByText('Play · 1')).toBeInTheDocument();
  expect(within(card).getByText('League · 3')).toBeInTheDocument();
  expect(within(card).queryByText(/^Moves ·/)).not.toBeInTheDocument();
  // Pick'em carries the highlight a pick'em-only in-season league gives it.
  const pickemTile = within(card).getByTestId('quick-action-pickem');
  expect(within(pickemTile).getByText('Recommended')).toBeInTheDocument();
});

// ==========================================================================
// Route cutover + parity (#645), the ninth slice. This section proves the
// composition the cutover adds: the four legacy surfaces (chat launcher, recap,
// trophy case, pick'em standings) mount under the same conditions the legacy
// page used, the fantasy vs pick'em-only bodies differ, live team identity
// writes through to every widget, and a widget's failed read never blanks the
// page. The four legacy surfaces are the mocked stand-ins declared at the top
// of this file; the widget slices and the page's own chat launcher markup are
// real. Fixtures are slugged `cutover*` (namespace fence, #643 addendum).
// ==========================================================================

// Count of GETs to the shared league detail URL: AC4's "no second league GET".
const cutoverLeagueGetCount = () =>
  apiClient.get.mock.calls.filter(([url]) => url === '/api/league/1').length;

// GETs that only a fantasy slice makes: scoring standings, matchups, or draft
// grades. AC3 requires a pick'em-only page to fire none of them.
const cutoverFantasyGets = () =>
  apiClient.get.mock.calls
    .map(([url]) => url)
    .filter(
      (url) =>
        typeof url === 'string' &&
        (/\/api\/scoring\/league\/\d+\/standings/.test(url) ||
          /\/api\/league\/\d+\/matchups(\?|\/|$)/.test(url) ||
          /\/api\/league\/\d+\/draft-grades/.test(url))
    );

test('cutover: a fantasy member composes the chat launcher, recap and trophy case alongside the widget slices', async () => {
  // inSeasonLeague() is a member (is_commissioner false, no invite_code) with a
  // draft-complete, in-season, 12-team league.
  mockGetByUrl({
    '/api/league/1': inSeasonLeague(),
    '/api/scoring/league/1/recap': {
      data: { season: 2026, week: 2, data: { generatedAt: '2026-10-13T14:00:00.000Z', narrative: 'A recap.', facts: {} } },
    },
    '/api/league/1/trophies': {
      data: [{ id: 1, season: 2026, week: 2, type: 'weekly_high', label: 'Weekly High', team_id: 1, team_name: 'Team 1' }],
    },
  });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // Every fantasy widget slot renders for a member; the commissioner strip
  // mounts under the header but returns null for a non-commissioner
  // (CommissionerStrip.jsx's own gate), so its own card is absent.
  expect(screen.getByTestId('slot-my-team')).toBeInTheDocument();
  expect(screen.getByTestId('slot-matchup-preview')).toBeInTheDocument();
  expect(screen.getByTestId('slot-around-the-league')).toBeInTheDocument();
  expect(screen.getByTestId('slot-standings')).toBeInTheDocument();
  expect(screen.queryByTestId('slot-draft-grades')).not.toBeInTheDocument();
  expect(screen.getByTestId('dashboard-quick-actions')).toBeInTheDocument();
  expect(screen.getByTestId('slot-recent-activity')).toBeInTheDocument();
  expect(screen.queryByTestId('commissioner-strip')).not.toBeInTheDocument();

  // The dashboard's own views of the legacy surfaces: the recap panel, and
  // in season the trophy case is a link in the Playbook line (the full trophy
  // room is the completed season's).
  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Trophy case (1)' })).toBeInTheDocument();
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
  // Pick'em standings never mount on a fantasy league.
  expect(screen.queryByTestId('pickem-standings')).not.toBeInTheDocument();

  // The chat launcher renders for every member, with no unread badge yet.
  expect(screen.getByRole('button', { name: 'Open league chat' })).toBeInTheDocument();
});

test('cutover: the chat launcher carries the unread count the chat panel reports', async () => {
  // The chat stand-in reports this on mount, standing in for messages that
  // arrived while the drawer was closed.
  mockChatUnread = 3;
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  // The launcher's accessible name carries the count (so a screen-reader user
  // hears it without opening the drawer) and the badge shows it.
  const launcher = await screen.findByRole('button', {
    name: 'Open league chat, 3 unread messages',
  });
  expect(within(launcher).getByText('3')).toBeInTheDocument();
});

test('chat drawer: modal below sm', async () => {
  // At 390px the paper is the whole viewport, so it has to behave like a
  // dialog. `temporary` is the only MUI variant that renders a Modal, and the
  // Modal is what brings the backdrop, the focus trap, Escape and focus
  // restore; the role and aria-modal are the page's own, because the Modal
  // supplies none. Red-tell: hard-coding the variant back to 'persistent'
  // turns this case red (the dialog semantics are derived from it).
  viewport = 390;
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  const launcher = await screen.findByRole('button', { name: 'Open league chat' });
  expect(launcher).toHaveAttribute('aria-expanded', 'false');
  // keepMounted means the paper is in the DOM before the first open, so the
  // launcher's aria-controls names something from the first render rather than
  // dangling while the drawer is closed (the #694 wiring rule).
  // eslint-disable-next-line testing-library/no-node-access
  expect(document.getElementById(launcher.getAttribute('aria-controls'))).toBeInTheDocument();

  await userEvent.click(launcher);
  expect(launcher).toHaveAttribute('aria-expanded', 'true');

  // Reached by the id the launcher points at, so a drifting id fails here
  // rather than leaving aria-controls dangling.
  // eslint-disable-next-line testing-library/no-node-access
  const paper = document.getElementById(launcher.getAttribute('aria-controls'));
  expect(paper).toHaveAttribute('role', 'dialog');
  expect(paper).toHaveAttribute('aria-modal', 'true');
  expect(paper).toHaveAttribute('aria-label', 'League chat');

  // The Modal's Escape handling reaches the page's onClose, and its focus
  // restore puts the caret back on the launcher rather than at the top of the
  // document.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(launcher).toHaveAttribute('aria-expanded', 'false'));
  await waitFor(() => expect(launcher).toHaveFocus());
});

test('chat drawer: at sm and up it stays the docked panel, with no dialog claim', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  const launcher = await screen.findByRole('button', { name: 'Open league chat' });
  await userEvent.click(launcher);

  // A docked panel traps nothing and leaves the page live, so claiming
  // aria-modal here would tell a screen reader the dashboard is inert when it
  // is not. The paper is still mounted and still named by aria-controls.
  // eslint-disable-next-line testing-library/no-node-access
  const paper = document.getElementById('league-chat-drawer');
  expect(paper).toBeInTheDocument();
  expect(paper).not.toHaveAttribute('role');
  expect(paper).not.toHaveAttribute('aria-modal');
});

test('chat drawer: the unread count survives an open and a close', async () => {
  // keepMounted is what makes this true below sm: without it the temporary
  // variant tears ChatPanel down on close, and the socket-owned unread count
  // restarts from zero on the next open.
  viewport = 390;
  mockChatUnread = 3;
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  const launcher = await screen.findByRole('button', {
    name: 'Open league chat, 3 unread messages',
  });
  await userEvent.click(launcher);
  await userEvent.click(screen.getByRole('button', { name: 'Close chat' }));

  await waitFor(() => expect(launcher).toHaveAttribute('aria-expanded', 'false'));
  expect(screen.getAllByTestId('mock-chat-panel')).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Open league chat, 3 unread messages' })
  ).toBeInTheDocument();
});

test("cutover: a pick'em-only member shows pick'em standings and the Pick'em action, omits every fantasy slice, and fires no fantasy read", async () => {
  // pickemOnlyLeague() is a member, pickem_only, in season at week 6.
  mockGetByUrl({
    '/api/league/1': pickemOnlyLeague(),
    '/api/league/1/trophies': {
      data: [{ id: 1, season: 2026, week: 0, type: 'pickem_champion', label: "Pick'em Champion", team_id: 1, team_name: 'Team 1' }],
    },
  });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // The pick'em body stands in for the fantasy hero/main grid.
  expect(screen.getByTestId('pickem-standings')).toBeInTheDocument();
  // The Pick'em action, from the quick-actions widget (which trims itself to
  // the pick'em surfaces).
  const quickActions = screen.getByTestId('quick-actions');
  expect(within(quickActions).getByTestId('quick-action-pickem')).toBeInTheDocument();
  // The trophy case is common to both league kinds: a completed pick'em season
  // earns a pickem_champion trophy, so gating it on fantasy would drop it. A
  // pick'em-only league has no Playbook line to fold it into, so it is its own link row.
  expect(await screen.findByTestId('trophy-link')).toHaveAttribute('href', '/league/1/trophies');

  // No fantasy slices, no fantasy layout regions, no recap, no advance control.
  expect(screen.queryByTestId('dashboard-hero')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-around-the-league')).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-main')).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-second-row')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-my-team')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-matchup-preview')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-standings')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-draft-grades')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-recent-activity')).not.toBeInTheDocument();
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /advance to week/i })).not.toBeInTheDocument();
  // Quick Actions still renders, full width and on its own, as it does for a
  // fantasy league.
  expect(screen.getByTestId('dashboard-quick-actions')).toBeInTheDocument();

  // The dispatcher recorded no scoring-standings, matchups or draft-grades GET.
  expect(cutoverFantasyGets()).toEqual([]);
});

// A 12-team fantasy league whose teams[] the standings table reads (it joins its
// response rows to teams[] by teamId and renders teamName). Team 7 is
// 'Skattebo Stans' until a profile update renames it. `name` is the raw column
// the league route also leaks, a decoy distinct from `teamName`.
const cutoverIdentityTeams = [
  'Terrific T',
  'Mike Mike Mike',
  'Nanagoat',
  'Lo Expectations',
  'Fourth and Slong',
  'MyBallsHurts',
  'Skattebo Stans',
  'Bussin Team',
  'Team Ramrod',
  'Keep My Team Name',
  'Hank Da Tank',
  'Bigpapa6',
].map((teamName, i) => {
  // Team ids run 2..7 for the first six rows, 1 for the viewer in sixth place.
  const teamId = [2, 3, 4, 5, 6, 1, 7, 8, 9, 10, 11, 12][i];
  return { teamId, id: teamId, teamName, name: `raw-${teamId}` };
});
const cutoverIdentityLeague = () =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: cutoverIdentityTeams,
    viewerTeamId: 1,
  });
const cutoverLiveIdentityMocks = {
  '/api/league/1': cutoverIdentityLeague(),
  '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
};

test('cutover: a team-profile rename writes through to the standings rows with no second league GET', async () => {
  mockGetByUrl(cutoverLiveIdentityMocks);
  renderPage();

  const standingsCard = await screen.findByTestId('standings-table');
  // Team 7's canonical name renders from teams[].
  await within(standingsCard).findByText('Skattebo Stans');

  // The single league GET that fed every widget (they dedupe on the shared
  // useLeague entry).
  expect(cutoverLeagueGetCount()).toBe(1);

  // Another manager's session publishes a rename for Team 7.
  act(() => {
    publishTeamProfileUpdate({ leagueId: 1, teamId: 7, name: 'Renamed Seven' });
  });

  // The row re-renders with the new name, from the shared teams[] write-through.
  await within(standingsCard).findByText('Renamed Seven');
  expect(within(standingsCard).queryByText('Skattebo Stans')).not.toBeInTheDocument();

  // The write-through made no request: still exactly one league GET.
  expect(cutoverLeagueGetCount()).toBe(1);
});

// The sibling test above proves the write-through's `teamName` half (what
// THIS page's own widgets render). This test proves the other half: the raw
// `name` column, which nothing on this page renders any more (ADR 0034
// retired the only widget that did, the commissioner panel, in this same
// ticket) but which is still patched by the SAME subscription
// (LeagueDashboardPage.jsx's `withRawName` call, the first of the two
// `applyTeamProfileUpdate` calls) and is still read on a DIFFERENT page:
// `pages/commissioner-console/model/useCommissionerConsole.js` reads the
// identical shared `useLeague` cache entry (its own docblock: "the same
// entry"), and `components/LeagueDashboard/CommissionerTools.jsx` renders
// that raw `name` in its removable-teams list. Dropping the `withRawName`
// call leaves that console list stale after a live rename with nothing in
// this repo turning red - this test is what closes that gap. It reads the
// shared cache entry directly (`resourceCache`'s own `read`, the same module
// `useLeague.js` itself calls) rather than mounting CommissionerTools here,
// since that mount is gone from this page for good.
test('cutover: a team-profile rename also patches the raw name column in the shared league cache (read by the commissioner console on a different page, #1107)', async () => {
  mockGetByUrl(cutoverLiveIdentityMocks);
  renderPage();

  await screen.findByTestId('standings-table');
  // Team 7's raw `name` column starts as the fixture's own decoy value,
  // distinct from its canonical `teamName` ('Skattebo Stans').
  const teamsInCache = () => read(['league', 1])?.data?.teams ?? [];
  expect(teamsInCache().find((t) => t.teamId === 7)?.name).toBe('raw-7');

  // Another manager's session publishes a rename for Team 7.
  act(() => {
    publishTeamProfileUpdate({ leagueId: 1, teamId: 7, name: 'Renamed Seven' });
  });

  // The shared cache entry's raw `name` column is patched too, with no
  // second league GET (the write-through, like its teamName sibling, makes
  // no request).
  await waitFor(() => {
    expect(teamsInCache().find((t) => t.teamId === 7)?.name).toBe('Renamed Seven');
  });
  expect(cutoverLeagueGetCount()).toBe(1);
});

test('cutover: a standings 500 errors the my-team card while matchup, recent activity, quick actions and the header render', async () => {
  // Everything resolves except the shared standings read, which 500s. Per #641
  // that one read feeds both my-team and the standings table, so both surface an
  // error; AC5 only claims the other four surfaces stay normal, which they do.
  // The matchups list is left to the dispatcher's empty fallback, so matchup
  // preview settles on its own honest empty state, not an error.
  mockGetByUrl({
    '/api/league/1': cutoverIdentityLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500 } } },
    '/api/league/1/transactions': { data: transactionRows(3) },
  });
  renderPage();

  // Header renders normally.
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // The my-team card shows its own compact error.
  await waitFor(() => expect(within(screen.getByTestId('my-team-summary')).getByRole('alert'))
    .toHaveTextContent('We could not load your team summary right now.'));

  // Matchup preview renders (no error) rather than being blanked by the
  // standings failure.
  const matchup = screen.getByTestId('matchup-preview');
  expect(within(matchup).queryByRole('alert')).not.toBeInTheDocument();

  // Recent activity renders its rail rows (no error).
  const recentActivity = screen.getByTestId('recent-activity');
  expect(await within(recentActivity).findAllByTestId('recent-activity-row')).toHaveLength(3);
  expect(within(recentActivity).queryByRole('alert')).not.toBeInTheDocument();

  // Quick actions render.
  expect(screen.getByTestId('quick-actions')).toBeInTheDocument();
});

// A pre-draft fantasy league with a scheduled draft. draft_status 'pending'
// derives to the pre-draft phase; draft_date is a far-future instant so the
// countdown never expires mid-test.
const cutoverPreDraftLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      draft_status: 'pending',
      draft_date: '2099-09-01T18:00:00.000Z',
      draft_timezone: 'America/New_York',
      ...overrides,
    },
    teams: buildTeams(8),
  });

test('cutover: a pre-draft fantasy league with a draft_date renders the draft countdown; nothing else does', async () => {
  mockGetByUrl({ '/api/league/1': cutoverPreDraftLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const countdown = screen.getByTestId('slot-draft-countdown');
  // It is the real Countdown in its full variant, not an empty box: the
  // add-to-calendar control renders because leagueId and leagueName are passed.
  expect(within(countdown).getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument();
  // On a pre-draft league this is the first block under the h1, so it is a
  // named region: unwrapped it was an unlabelled section whose only text was a
  // ticker.
  expect(
    within(countdown).getByRole('heading', { level: 2, name: 'Draft Day' })
  ).toBeInTheDocument();
});

test('cutover: the Draft Day card links to the Draft Room', async () => {
  mockGetByUrl({ '/api/league/1': cutoverPreDraftLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const countdown = screen.getByTestId('slot-draft-countdown');
  const link = within(countdown).getByRole('link', { name: 'Draft Room' });
  expect(link).toHaveAttribute('href', '/league/1/draft');
  // Red-tell: dropping MIN_TOUCH_TARGET_SX from the button turns this red.
  expect(cssFor(link)).toMatch(/min-height:\s*44px/);
});

test('cutover: no draft countdown once the draft_date is absent, past pre-draft, or pick\'em-only', async () => {
  // Pre-draft but no date set: the surface is gated off (matches legacy).
  mockGetByUrl({ '/api/league/1': preDraftLeague() });
  const { unmount } = renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
  unmount();

  // In season (past pre-draft): gated off even with a date present.
  invalidate(undefined, { reload: false });
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ draft_date: '2099-09-01T18:00:00.000Z' }) });
  const { unmount: unmount2 } = renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
  unmount2();

  // Pick'em-only: no draft at all.
  invalidate(undefined, { reload: false });
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague({ draft_date: '2099-09-01T18:00:00.000Z' }) });
  renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
});

// ==========================================================================
// The Play-select states (ADR 0067 wave 1b, #2330): every board of the approved
// canvas (docs/design/league/) has its page state pinned below. The widgets'
// own looks are pinned in their suites; what lives here is the composition:
// which pieces mount in which phase, in what order, and the one cursor and one
// filled action per page.
// ==========================================================================

// The cursor and the filled foot are CSS classes and data attributes with no role.
/* eslint-disable testing-library/no-node-access */
const cursorCount = () => document.querySelectorAll('.cursor').length;
const filledCount = () => document.querySelectorAll('[data-filled="true"]').length;
/* eslint-enable testing-library/no-node-access */

// A fantasy league on game day: the viewer (Team 3) is mid-game against Team 7, the other pairing live
// and a third final, in a 12-team league whose standings put the viewer fourth.
const gameDayTeams = Array.from({ length: 12 }, (_, i) => ({
  teamId: i + 1, id: i + 1, teamName: `Squad ${i + 1}`, avatar_url: null, avatar_static_url: null,
}));
const gameDayLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      draft_status: 'complete', season_status: 'regular', current_week: 1, is_commissioner: true, invite_code: 'abc123', ...overrides,
    },
    teams: gameDayTeams,
    viewerTeamId: 3,
  });
const gameDayRows = () => [
  mpLiveRow({ home_team_id: 3, away_team_id: 7 }),
  { id: 56, week: 1, season: 2026, status: 'live', home_team_id: 5, away_team_id: 9, home_score: '20.0', away_score: '15.0', home_expected_final: 100, away_expected_final: 90, final: false },
  { id: 57, week: 1, season: 2026, status: 'final', home_team_id: 1, away_team_id: 2, home_score: '110.0', away_score: '90.0', final: true },
  { id: 58, week: 1, season: 2026, status: 'live', home_team_id: 4, away_team_id: 6, home_score: '30.0', away_score: '33.0', home_expected_final: 100, away_expected_final: 101, final: false },
  { id: 59, week: 1, season: 2026, status: 'scheduled', home_team_id: 8, away_team_id: 10, home_expected_final: 100, away_expected_final: 99, final: false },
  { id: 60, week: 1, season: 2026, status: 'scheduled', home_team_id: 11, away_team_id: 12, home_expected_final: 100, away_expected_final: 99, final: false },
];
const gameDayStandings = () => ({
  data: {
    league: { current_week: 1 },
    standings: gameDayTeams.map((t, i) => ({
      teamId: t.teamId, name: `RAW ${t.teamId}`, wins: 12 - i, losses: i, ties: 0, pf: 1200 - i * 7, pa: 1000 + i * 3, rank: i + 1, streak: 'W1',
    })),
  },
});
const gameDayMocks = (extra = {}) => ({
  '/api/league/1': gameDayLeague(),
  [MP_LIST_URL]: mpMatchupsList(gameDayRows()),
  '/api/league/1/matchups': mpMatchupsList(gameDayRows()),
  '/api/scoring/league/1/standings': gameDayStandings(),
  '/api/league/1/transactions': { data: transactionRows(20) },
  ...extra,
});

describe('game day (the viewer\'s matchup is live)', () => {
  test('the head says how many matchups are live, in the Live chip', async () => {
    mockGetByUrl(gameDayMocks());
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
    expect(await screen.findByText('3 matchups live')).toBeInTheDocument();
    expect(screen.getByText('Week 1 · In season')).toBeInTheDocument();
  });

  test('order: the scoreboard leads, then My team at full width, the Pick\'em panel, the strip, the recap, around the league and the main grid', async () => {
    mockGetByUrl(gameDayMocks({
      '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
      '/api/scoring/league/1/recap': {
        data: { season: 2026, week: 0, data: { generatedAt: '2026-10-13T14:00:00.000Z', narrative: 'A recap.', facts: {} } },
      },
    }));
    renderPage();

    const matchup = await screen.findByTestId('slot-matchup-preview');
    await within(matchup).findByTestId('matchup-versus');
    expect(within(matchup).getByTestId('matchup-preview')).toHaveAttribute('data-state', 'live');
    const myTeam = screen.getByTestId('slot-my-team');
    const pickem = await screen.findByTestId('slot-pickem-panel');
    const strip = screen.getByTestId('slot-commissioner-strip');
    const recap = screen.getByTestId('slot-recap');
    const around = screen.getByTestId('slot-around-the-league');
    const main = screen.getByTestId('dashboard-main');
    expect(precedes(matchup, myTeam)).toBe(true);
    expect(precedes(myTeam, pickem)).toBe(true);
    expect(precedes(pickem, strip)).toBe(true);
    expect(precedes(strip, recap)).toBe(true);
    expect(precedes(recap, around)).toBe(true);
    expect(precedes(around, main)).toBe(true);
    // Game day is not the two-column hero: the same three pieces run full width, one under the other, in
    // the same wrapper (so a widget is not remounted when the page learns the matchup has started).
    const hero = screen.getByTestId('dashboard-hero');
    expect(within(hero).getByTestId('slot-matchup-preview')).toBe(matchup);
    expect(within(hero).getByTestId('slot-my-team')).toBe(myTeam);
    expect(cssFor(hero)).toMatch(/flex-direction:\s*column/);
    expect(precedes(hero, strip)).toBe(true);
  });

  test('Around the league folds to the viewer\'s three rival games and Recent activity to three rows', async () => {
    mockGetByUrl(gameDayMocks());
    renderPage();

    const around = await screen.findByTestId('around-the-league');
    // The viewer (Squad 3) is third: the games of Squad 2's, 4's and 5's neighbourhood come first.
    await waitFor(() => expect(within(around).getAllByTestId('around-the-league-tile')).toHaveLength(3));
    expect(within(around).getByText(/3 rival matchups/)).toBeInTheDocument();
    expect(within(around).getByRole('link', { name: 'All matchups in Game Center' })).toBeInTheDocument();
    const activity = await screen.findByTestId('recent-activity');
    expect(await within(activity).findAllByTestId('recent-activity-row')).toHaveLength(3);
    expect(within(activity).getByRole('link', { name: 'All activity' })).toBeInTheDocument();
  });

  test('on a phone the Invite control leaves the head for the commissioner strip', async () => {
    viewport = 390;
    mockGetByUrl(gameDayMocks());
    renderPage();

    const strip = await screen.findByTestId('commissioner-strip');
    expect(await within(strip).findByRole('button', { name: /invite/i })).toBeInTheDocument();
    expect(within(strip).getByText('Copy the invite link for new teams')).toBeInTheDocument();
    // One Invite control on the page, and it is in the strip, not the head.
    expect(screen.getAllByRole('button', { name: /invite/i })).toHaveLength(1);
    expect(within(screen.getByTestId('dashboard-head')).queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  test('on a desktop the Invite control stays in the head', async () => {
    mockGetByUrl(gameDayMocks());
    renderPage();

    await screen.findByTestId('commissioner-strip');
    expect(within(screen.getByTestId('dashboard-head')).getByRole('button', { name: /invite/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('commissioner-strip')).queryByText('Copy the invite link for new teams')).not.toBeInTheDocument();
  });
});

describe('before kickoff the hero is the matchup, My team and the Pick\'em panel', () => {
  const pickemStandings = (extra = {}) => ({
    data: {
      season: 2026,
      mode: 'straight',
      viewerTeamId: 1,
      standings: [
        { teamId: 2, teamName: 'Squad 2', rank: 1, previousRank: 1, points: 105, correct: 12, incorrect: 2, pushes: 0, pending: 0, made: 14, weekly: { 6: 12 }, ...extra },
        { teamId: 1, teamName: 'Squad 1', rank: 2, previousRank: 3, points: 94, correct: 10, incorrect: 4, pushes: 0, pending: 0, made: 14, weekly: { 6: 9, 7: 4 } },
      ],
    },
  });
  const scheduledLeague = () => leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 7 },
    teams: gameDayTeams,
    viewerTeamId: 1,
  });

  test('a fantasy plus pick\'em league shows the panel with the viewer\'s rank, points, week and gap to the leader', async () => {
    mockGetByUrl({
      '/api/league/1': scheduledLeague(),
      '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
      '/api/pickem/league/1/standings': pickemStandings(),
    });
    renderPage();

    const panel = await screen.findByTestId('pickem-panel');
    expect(within(panel).getByRole('heading', { level: 2, name: "Pick'em" })).toBeInTheDocument();
    expect(await within(panel).findByTestId('pickem-panel-rank')).toHaveTextContent('2nd');
    expect(within(panel).getByTestId('pickem-panel-points')).toHaveTextContent('94');
    expect(within(panel).getByTestId('pickem-panel-week')).toHaveTextContent('Wk 74');
    expect(within(panel).getByTestId('pickem-panel-behind')).toHaveTextContent('11 pts');
    expect(within(panel).getByRole('link', { name: "Pick'em picks, Week 7" })).toHaveAttribute('href', '/league/1/pickem');
    // The panel sits in the hero's left column, under the matchup.
    expect(within(screen.getByTestId('dashboard-hero')).getByTestId('slot-pickem-panel')).toBeInTheDocument();
    expect(cssFor(screen.getByTestId('slot-pickem-panel'))).toMatch(/grid-area:\s*p/);
  });

  test('a tied rank reads T-n', async () => {
    mockGetByUrl({
      '/api/league/1': scheduledLeague(),
      '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
      '/api/pickem/league/1/standings': pickemStandings({ rank: 2 }),
    });
    renderPage();

    expect(await screen.findByTestId('pickem-panel-rank')).toHaveTextContent('T-2');
  });

  test('a fantasy-only league has no Pick\'em panel, and reads no pick\'em standings', async () => {
    mockGetByUrl({
      '/api/league/1': scheduledLeague(),
      '/api/pickem/league/1/settings': { data: { enabled: false, mode: 'straight' } },
      '/api/pickem/league/1/standings': pickemStandings(),
    });
    renderPage();

    await screen.findByTestId('dashboard-hero');
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/1/settings'));
    expect(screen.queryByTestId('pickem-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-pickem-panel')).not.toBeInTheDocument();
    expect(apiClient.get.mock.calls.some(([url]) => String(url).includes('/api/pickem/league/1/standings'))).toBe(false);
  });

  test('the panel appears in season only: a pre-draft league with pick\'em on has none', async () => {
    mockGetByUrl({
      '/api/league/1': leagueDetail({ league: { draft_status: 'pending' }, teams: buildTeams(8), viewerTeamId: 1 }),
      '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
    expect(screen.queryByTestId('pickem-panel')).not.toBeInTheDocument();
  });

  test('a panel whose viewer has no row yet renders nothing, and its wrapper collapses', async () => {
    mockGetByUrl({
      '/api/league/1': scheduledLeague(),
      '/api/pickem/league/1/settings': { data: { enabled: true, mode: 'straight' } },
      '/api/pickem/league/1/standings': { data: { season: 2026, mode: 'straight', viewerTeamId: 1, standings: [] } },
    });
    renderPage();

    await screen.findByTestId('dashboard-hero');
    await waitFor(() => expect(screen.getByTestId('slot-pickem-panel')).toBeEmptyDOMElement());
  });
});

describe('a completed season', () => {
  const completeLeague = () => inSeasonLeague({ season_status: 'complete' });
  const champion = {
    id: 9, season: 2026, week: 0, type: 'champion', label: '2026 League Champion', team_id: 2, team_name: 'Terrific T',
  };
  const trophies = () => ({
    data: [
      champion,
      { id: 10, season: 2026, week: 6, type: 'weekly_high', label: 'Weekly High', team_id: 3, team_name: 'Squad 3' },
      { id: 11, season: 2026, week: 5, type: 'closest_game', label: 'Closest Game', team_id: 1, team_name: 'Squad 1' },
    ],
  });

  test('opens on the trophy room, with no matchup, My team or Around the league, and keeps the Playbook frame', async () => {
    mockGetByUrl({ '/api/league/1': completeLeague(), '/api/league/1/trophies': trophies() });
    renderPage();

    const room = await screen.findByTestId('trophy-case');
    expect(within(room).getByRole('heading', { level: 2, name: 'Trophy room' })).toBeInTheDocument();
    const hero = within(room).getByTestId('trophy-champion');
    expect(within(hero).getByRole('heading', { level: 3, name: '2026 League Champion' })).toBeInTheDocument();
    expect(within(hero).getByText('Terrific T')).toBeInTheDocument();
    // The awards: one row per award with the week, never an invented figure.
    expect(within(room).getByTestId('trophy-10')).toHaveTextContent('Weekly High');
    expect(within(room).getByTestId('trophy-10')).toHaveTextContent('Squad 3 · Week 6');
    expect(screen.queryByTestId('dashboard-hero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-around-the-league')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-matchup-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-my-team')).not.toBeInTheDocument();
    // The trophy room precedes the standings; the Playbook is the frame with its three groups.
    expect(precedes(room, screen.getByTestId('dashboard-main'))).toBe(true);
    const playbook = screen.getByTestId('quick-actions');
    expect(within(playbook).getByText('Moves · 2')).toBeInTheDocument();
    expect(screen.queryByTestId('trophy-link')).not.toBeInTheDocument();
    // The head: the phase chip, the team count and Draft Complete.
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Draft Complete')).toBeInTheDocument();
  });

  test('a completed league with no trophies has no trophy room', async () => {
    mockGetByUrl({ '/api/league/1': completeLeague(), '/api/league/1/trophies': { data: [] } });
    renderPage();

    await screen.findByTestId('dashboard-main');
    expect(screen.queryByRole('heading', { name: 'Trophy room' })).not.toBeInTheDocument();
    expect(screen.getByTestId('slot-trophy-case')).toBeEmptyDOMElement();
  });

  test('the award list is capped at six, with one toggle that opens the rest', async () => {
    const many = [champion, ...Array.from({ length: 8 }, (_, i) => ({
      id: 20 + i, season: 2026, week: i + 1, type: 'weekly_high', label: 'Weekly High', team_id: 2, team_name: 'Terrific T',
    }))];
    mockGetByUrl({ '/api/league/1': completeLeague(), '/api/league/1/trophies': { data: many } });
    renderPage();

    const room = await screen.findByTestId('trophy-case');
    expect(within(room).getAllByRole('heading', { level: 3, name: 'Weekly High' })).toHaveLength(6);
    await userEvent.click(within(room).getByRole('button', { name: 'Show all 8 awards' }));
    expect(within(room).getAllByRole('heading', { level: 3, name: 'Weekly High' })).toHaveLength(8);
    expect(within(room).getByRole('button', { name: 'Show fewer awards' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the recap panel', () => {
  const recap = (overrides = {}) => ({
    data: {
      season: 2026,
      week: 6,
      data: {
        generatedAt: '2026-10-13T14:00:00.000Z',
        narrative: 'Blitz Brigade went off for the week\'s top score.',
        facts: {
          highestScorer: { team: 'Blitz Brigade', points: 141.7 },
          benchBlunder: { team: 'Sunday Scaries', pointsLeftOnBench: 18.4 },
          waiverSteal: { player: 'Woody Marks', team: 'Darkness Falls', points: 22.6 },
          closestMatchup: { home: 'Gridiron Ghosts', away: 'Hail Mary Club', margin: 0.8 },
        },
        ...overrides,
      },
    },
  });

  test('is a tertiary frame labelled as a recap, with its narrative, fact rows in the product\'s order and the time it was generated', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), '/api/scoring/league/1/recap': recap() });
    renderPage();

    const card = await screen.findByTestId('recap-card');
    expect(within(card).getByRole('heading', { level: 2, name: 'Week 6 recap' })).toBeInTheDocument();
    expect(within(card).getByText(/^Generated /)).toBeInTheDocument();
    expect(within(card).getByText("Blitz Brigade went off for the week's top score.")).toBeInTheDocument();
    const labels = within(card).getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['High score', 'Bench blunder', 'Waiver steal', 'Closest game']);
    expect(within(card).getByText('Blitz Brigade · 141.7')).toBeInTheDocument();
    expect(cssFor(card)).toMatch(/border:\s*2px solid var\(--ps-frame-2\)/);
    // Never a Projection, and a member has no rebuild control.
    expect(within(card).queryByText(/projection/i)).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Rebuild recap' })).not.toBeInTheDocument();
  });

  test('a commissioner of the current season can rebuild it, and the rebuilt recap replaces the one on screen', async () => {
    apiClient.post.mockResolvedValue(recap({ narrative: 'Rebuilt narrative.' }));
    mockGetByUrl({
      '/api/league/1': inSeasonLeague({ is_commissioner: true, current_season: 2026 }),
      '/api/scoring/league/1/recap': recap(),
    });
    renderPage();

    const card = await screen.findByTestId('recap-card');
    await userEvent.click(await within(card).findByRole('button', { name: 'Rebuild recap' }));
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/recap', { week: 6, season: 2026 });
    expect(await within(card).findByText('Rebuilt narrative.')).toBeInTheDocument();
  });

  test('no recap yet, no panel: the wrapper collapses', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), '/api/scoring/league/1/recap': { reject: { response: { status: 404 } } } });
    renderPage();

    await screen.findByTestId('dashboard-main');
    await waitFor(() => expect(screen.getByTestId('slot-recap')).toBeEmptyDOMElement());
  });
});

describe('the pick\'em-only body', () => {
  const standings = () => ({
    data: {
      season: 2026,
      mode: 'straight',
      viewerTeamId: 1,
      standings: [
        { teamId: 2, teamName: 'Terrific T', rank: 1, previousRank: 1, points: 105, correct: 12, incorrect: 2, pushes: 0, pending: 1, made: 15, weekly: { 5: 11, 6: 12 } },
        { teamId: 1, teamName: 'MyBallsHurts', rank: 2, previousRank: 3, points: 94, correct: 10, incorrect: 4, pushes: 0, pending: 0, made: 14, weekly: { 5: 9, 6: 15 } },
      ],
    },
  });

  test('is the pool standings in a primary frame: the viewer strip, then the table with the viewer\'s row on Play blue', async () => {
    mockGetByUrl({ '/api/league/1': pickemOnlyLeague(), '/api/pickem/league/1/standings': standings() });
    renderPage();

    const card = await screen.findByTestId('pickem-standings');
    const you = await within(card).findByTestId('pickem-standings-you-row');
    expect(within(you).getByText('MyBallsHurts')).toBeInTheDocument();
    expect(within(you).getByText('You')).toBeInTheDocument();
    expect(you).toHaveAttribute('aria-current', 'true');
    expect(cssFor(within(you).getAllByRole('cell')[0])).toMatch(/background-color:\s*var\(--ps-play\)/);
    expect(within(card).getByTestId('pickem-standings-your-rank')).toHaveTextContent('2nd');
    expect(within(card).getByTestId('pickem-standings-behind-leader')).toHaveTextContent('11 pts');
    expect(within(card).getByTestId('pickem-standings-your-accuracy')).toHaveTextContent('71%');
    expect(within(card).getByTestId('pickem-standings-best-week')).toHaveTextContent('Wk 6');
    expect(within(card).getByTestId('pickem-standings-count')).toHaveTextContent('2 teams');
    // The weekly heat strip: eighteen weeks per row, the best week marked.
    expect(within(you).getAllByTestId('pickem-standings-heat-cell')).toHaveLength(18);
    expect(within(you).getAllByTestId('pickem-standings-heat-cell').filter((cell) => cell.hasAttribute('data-best'))).toHaveLength(1);
  });

  test('wears no cursor and no filled action of its own', async () => {
    mockGetByUrl({ '/api/league/1': pickemOnlyLeague(), '/api/pickem/league/1/standings': standings() });
    renderPage();

    const card = await screen.findByTestId('pickem-standings');
    await within(card).findByTestId('pickem-standings-you-row');
    // eslint-disable-next-line testing-library/no-node-access
    expect(card.querySelector('.cursor, [data-filled="true"]')).toBeNull();
  });
});

// Your move (ADR 0067 ruling 3, ACs 2 to 4 and 7 of #2330): this league's items from
// GET /api/user/action-items, grouped by the Action item entity (one card per shared lock) and drawn by
// ui/YourMove. The page's one cursor and one filled action are the lead card's.
const ACTION_URL = `/api/user/action-items?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
const IN_MINUTES = (n) => new Date(Date.now() + n * 60 * 1000).toISOString();
const item = (type, key, over = {}) => ({
  id: [type, 1, key].filter((part) => part !== null).join(':'),
  type,
  leagueId: 1,
  leagueName: 'MinneApple',
  title: 'Item',
  detail: null,
  severity: 'timed',
  deadlineAt: null,
  cta: { label: 'Open', to: '/league/1' },
  progress: null,
  ...over,
});
const lineupItem = (deadlineAt) => item('lineup_problem', null, {
  title: 'Set your lineup', detail: '1 empty starting slot', deadlineAt, cta: { label: 'Set lineup', to: '/league/1/lineup' },
});
const picksItem = (deadlineAt) => item('picks_open', '2026-3', {
  title: 'Week 3 picks', detail: '9 of 14 picks made', deadlineAt, cta: { label: 'Make picks', to: '/league/1/pickem' },
});
const actionItems = (items) => ({ [ACTION_URL]: { data: { generatedAt: new Date().toISOString(), counts: { total: items.length, dueToday: 0 }, partial: [], items } } });

describe('Your move', () => {
  test('two items with the same deadline are one card with two feet, the badge equals the cards, and one cursor and one filled foot', async () => {
    const lock = IN_MINUTES(6 * 60);
    mockGetByUrl({
      '/api/league/1': inSeasonLeague(),
      ...actionItems([
        lineupItem(lock),
        picksItem(lock),
        item('waiver_claims', null, {
          title: 'Waivers', detail: '1 claim pending', severity: 'info', deadlineAt: IN_MINUTES(3 * 24 * 60), cta: { label: 'View claims', to: '/league/1/waivers' },
        }),
      ]),
    });
    renderPage();

    const section = await screen.findByTestId('your-move');
    const group = await within(section).findByRole('group', { name: 'Lineup and picks' });
    expect(within(group).getAllByRole('link').map((link) => link.textContent)).toEqual(['Set lineup', 'Make picks']);
    // One Play: the pending waiver claims are sideline (info), never a Play, so the badge says one.
    expect(within(section).getByText('1 thing needs you')).toBeInTheDocument();
    expect(within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Lineup and picks']);
    expect(cursorCount()).toBe(1);
    expect(filledCount()).toBe(1);
    // My team does not repeat the play: Your move already carries Set lineup.
    expect(screen.queryByRole('link', { name: 'Fix lineup' })).not.toBeInTheDocument();
  });

  test('a waiver claims info item and a join requests item for the league are not in Your move', async () => {
    mockGetByUrl({
      '/api/league/1': inSeasonLeague(),
      ...actionItems([
        item('waiver_claims', null, {
          title: 'Waivers', detail: '1 claim pending', severity: 'info', deadlineAt: IN_MINUTES(3 * 24 * 60), cta: { label: 'View claims', to: '/league/1/waivers' },
        }),
        item('join_requests', null, {
          title: 'Join requests', detail: '2 waiting', severity: 'timed', deadlineAt: null, cta: { label: 'Review requests', to: '/league/1/commissioner' },
        }),
      ]),
    });
    renderPage();

    const section = await screen.findByTestId('your-move');
    expect(await within(section).findByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
    expect(within(section).queryByText('Waivers')).not.toBeInTheDocument();
    expect(within(section).queryByText('Join requests')).not.toBeInTheDocument();
    expect(cursorCount()).toBe(0);
  });

  test('an empty item list is the calm "You\'re set" card', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), ...actionItems([]) });
    renderPage();

    const section = await screen.findByTestId('your-move');
    expect(await within(section).findByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
    expect(cursorCount()).toBe(0);
    expect(filledCount()).toBe(0);
  });

  test('only this league\'s items count', async () => {
    mockGetByUrl({
      '/api/league/1': inSeasonLeague(),
      ...actionItems([{ ...lineupItem(IN_MINUTES(120)), leagueId: 2, id: 'lineup_problem:2' }]),
    });
    renderPage();

    expect(await screen.findByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
  });

  test('nothing is drawn while the read is in flight, and a failed read is one danger panel that re-reads', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), [ACTION_URL]: { pending: true } });
    const { unmount } = renderPage();
    await screen.findByTestId('dashboard-main');
    expect(screen.queryByTestId('slot-your-move')).not.toBeInTheDocument();
    unmount();

    invalidate(undefined, { reload: false });
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), [ACTION_URL]: { reject: { response: { status: 500 } } } });
    renderPage();
    expect(await screen.findByText("Couldn't check what needs you")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try checking your plays again' })).toBeInTheDocument();
  });

  test('a revisit with cached items keeps the card on screen while the items re-read', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), ...actionItems([lineupItem(IN_MINUTES(6 * 60))]) });
    const { unmount } = renderPage();
    await screen.findByTestId('your-move');
    unmount();

    // The shared items entry survives the unmount; the league and the rest are read again.
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), [ACTION_URL]: { pending: true } });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
    expect(screen.getByTestId('your-move')).toBeInTheDocument();
  });

  test('the lead lineup card names the swap from the Forecast: Start {in} for {out} · +{gain} pts', async () => {
    mockGetByUrl({
      '/api/league/1': inSeasonLeague(),
      ...actionItems([lineupItem(IN_MINUTES(6 * 60))]),
      '/api/team/lineup/advice?leagueId=1&week=3': {
        data: {
          suggestions: [{
            slot: 'WR', gain: 23.04, verdict: 'start', current: { playerId: 1, name: 'Puka Nacua' }, suggested: { playerId: 2, name: 'Jordan Addison' },
          }],
          movePlan: [],
        },
      },
    });
    renderPage();

    const section = await screen.findByTestId('your-move');
    expect(await within(section).findByText('Start Jordan Addison for Puka Nacua · +23.0 pts')).toBeInTheDocument();
    // Said once: the item's own detail does not repeat under it.
    expect(within(section).queryByText('1 empty starting slot')).not.toBeInTheDocument();
  });

  test('with no suggestion there is no swap note, and the item\'s own detail reads', async () => {
    mockGetByUrl({
      '/api/league/1': inSeasonLeague(),
      ...actionItems([lineupItem(IN_MINUTES(6 * 60))]),
      '/api/team/lineup/advice?leagueId=1&week=3': { data: { suggestions: [], movePlan: [] } },
    });
    renderPage();

    const section = await screen.findByTestId('your-move');
    expect(await within(section).findByText('1 empty starting slot')).toBeInTheDocument();
    expect(within(section).queryByText(/^Start /)).not.toBeInTheDocument();
  });

  test('a league with no lineup play makes no advice read', async () => {
    mockGetByUrl({ '/api/league/1': inSeasonLeague(), ...actionItems([picksItem(IN_MINUTES(6 * 60))]) });
    renderPage();

    await screen.findByTestId('your-move');
    expect(apiClient.get.mock.calls.some(([url]) => String(url).includes('/lineup/advice'))).toBe(false);
  });
});

// AC4: on game day a lock inside the hour puts Your move first; otherwise the live scoreboard leads.
describe('game day order', () => {
  test('with an item locking in 45 minutes Your move precedes the live matchup, under a red cursor', async () => {
    mockGetByUrl(gameDayMocks(actionItems([lineupItem(IN_MINUTES(45)), picksItem(IN_MINUTES(45))])));
    renderPage();

    const move = await screen.findByTestId('slot-your-move');
    const matchup = screen.getByTestId('slot-matchup-preview');
    await within(matchup).findByTestId('matchup-versus');
    expect(precedes(move, matchup)).toBe(true);
    expect(await within(move).findByText(/^\d+ min left$/)).toBeInTheDocument();
    expect(cursorCount()).toBe(1);
    expect(filledCount()).toBe(1);
  });

  test('with nothing under an hour the live matchup precedes Your move', async () => {
    mockGetByUrl(gameDayMocks(actionItems([lineupItem(IN_MINUTES(5 * 60))])));
    renderPage();

    const matchup = await screen.findByTestId('slot-matchup-preview');
    await within(matchup).findByTestId('matchup-versus');
    const move = await screen.findByTestId('slot-your-move');
    expect(precedes(matchup, move)).toBe(true);
    expect(precedes(move, screen.getByTestId('slot-my-team'))).toBe(true);
    expect(cursorCount()).toBe(1);
  });

  test('with nothing due the scoreboard leads and Your move is the calm card, no cursor and no filled action', async () => {
    mockGetByUrl(gameDayMocks(actionItems([])));
    renderPage();

    const matchup = await screen.findByTestId('slot-matchup-preview');
    await within(matchup).findByTestId('matchup-versus');
    const move = await screen.findByTestId('slot-your-move');
    expect(precedes(matchup, move)).toBe(true);
    expect(within(move).getByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
    expect(cursorCount()).toBe(0);
    expect(filledCount()).toBe(0);
  });
});

// AC5: Advance week waits until every game of the current week is final.
describe('Advance week', () => {
  const advanceLeague = () => mpLeague({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 1, is_commissioner: true },
  });
  // The server marks a finished, unadvanced game 'played'; only advancing writes 'final'.
  const finalRows = () => mpViewerPaired.map((r) => ({ ...r, status: 'played', final: false, home_score: 100, away_score: 90 }));

  test('with a game still to settle it is disabled and the reason is text', async () => {
    const rows = [{ ...mpViewerPaired[0], status: 'live' }, ...finalRows().slice(1)];
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(rows), ...actionItems([]) });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Advance to Week 2' });
    await waitFor(() => expect(button).toBeDisabled());
    const reason = screen.getByText('Opens when every Week 1 game is final');
    expect(button).toHaveAttribute('aria-describedby', reason.id);
    // Never a filled action: the one filled foot is the lead play's.
    expect(button).not.toHaveAttribute('data-filled');
  });

  test('a week already marked final (final: true) opens it too', async () => {
    const rows = mpViewerPaired.map((r) => ({ ...r, status: 'final', final: true, home_score: 100, away_score: 90 }));
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(rows), ...actionItems([]) });
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Advance to Week 2' })).toBeEnabled());
  });

  test('a failed week read says so, stays disabled and offers a retry that re-reads the week', async () => {
    mockGetByUrl({
      '/api/league/1': advanceLeague(),
      [MP_LIST_URL]: { reject: { response: { status: 500 } } },
      ...actionItems([]),
    });
    renderPage();

    const reason = await screen.findByText("Couldn't check Week 1 games");
    expect(screen.getByRole('button', { name: 'Advance to Week 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Advance to Week 2' })).toHaveAttribute('aria-describedby', reason.id);
    const reads = () => apiClient.get.mock.calls.filter(([url]) => url === MP_LIST_URL).length;
    const before = reads();
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(finalRows()), ...actionItems([]) });
    await userEvent.click(screen.getByRole('button', { name: 'Try checking Week 1 games again' }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advance to Week 2' })).toBeEnabled());
    expect(screen.queryByText("Couldn't check Week 1 games")).not.toBeInTheDocument();
  });

  test('with every game final it is enabled and the reason is gone', async () => {
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(finalRows()), ...actionItems([]) });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Advance to Week 2' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText('Opens when every Week 1 game is final')).not.toBeInTheDocument();
  });

  test('confirming posts the week and the league re-reads', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(finalRows()), ...actionItems([]) });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Advance to Week 2' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/advance-week', { week: 1 });
  });

  test('a successful advance re-reads the action items', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    mockGetByUrl({ '/api/league/1': advanceLeague(), [MP_LIST_URL]: mpMatchupsList(finalRows()), ...actionItems([]) });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Advance to Week 2' });
    await waitFor(() => expect(button).toBeEnabled());
    const reads = () => apiClient.get.mock.calls.filter(([url]) => url === ACTION_URL).length;
    await waitFor(() => expect(reads()).toBeGreaterThan(0));
    const before = reads();
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });
});

// AC6: no polling, no Refresh: the scoreboard moves on the scores:updated socket event.
describe('live updates', () => {
  let sockets;
  beforeEach(() => {
    sockets = [];
    window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
      const handlers = {};
      const ioHandlers = {};
      const socket = {
        emit: jest.fn(),
        on: jest.fn((event, cb) => { handlers[event] = cb; }),
        io: { on: jest.fn((event, cb) => { ioHandlers[event] = cb; }), off: jest.fn() },
        disconnect: jest.fn(),
        fire: (event, payload) => handlers[event]?.(payload),
        reconnect: () => ioHandlers.reconnect?.(),
      };
      sockets.push(socket);
      return socket;
    };
  });
  afterEach(() => {
    delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
    jest.restoreAllMocks();
  });

  test('a scores:updated event changes the score, the "As of" stamp and the live region sentence', async () => {
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(new Date(2026, 9, 18, 14, 40).getTime());
    mockGetByUrl(gameDayMocks(actionItems([])));
    renderPage();

    const card = await (async () => {
      await screen.findByTestId('matchup-versus');
      return screen.getByTestId('matchup-preview');
    })();
    expect(within(card).getByTestId('matchup-figure-viewer')).toHaveTextContent('61.0');
    expect(within(card).getByTestId('matchup-as-of')).toHaveTextContent('As of 2:40 PM');
    expect(within(card).getByTestId('matchup-live-region')).toHaveTextContent('Squad 3 61.0, Squad 7 58.9, as of 2:40 PM');

    clock.mockReturnValue(new Date(2026, 9, 18, 14, 52).getTime());
    act(() => {
      sockets.forEach((socket) => socket.fire('scores:updated', {
        leagueId: 1,
        season: 2026,
        week: 1,
        scored: [{
          matchupId: 55, status: 'live', homeScore: 70.5, awayScore: 58.9, homeExpectedFinal: 112.4, awayExpectedFinal: 108.1, homePlayersRemaining: 6, awayPlayersRemaining: 9,
        }],
        plays: [],
      }));
    });

    await waitFor(() => expect(screen.getByTestId('matchup-figure-viewer')).toHaveTextContent('70.5'));
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:52 PM');
    const sentence = screen.getByTestId('matchup-live-region');
    expect(sentence).toHaveTextContent('Squad 3 70.5, Squad 7 58.9, as of 2:52 PM');
    expect(screen.getByText('Up 11.6')).toBeInTheDocument();
    expect(screen.getByText('6 players remaining')).toBeInTheDocument();
    // No Refresh control, and the live read was not repeated for the event.
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  const liveEvent = (over = {}, entry = {}) => ({
    leagueId: 1,
    season: 2026,
    week: 1,
    scored: [{
      matchupId: 55, status: 'live', homeScore: 70.5, awayScore: 58.9, homeExpectedFinal: 112.4, awayExpectedFinal: 108.1, homePlayersRemaining: 6, awayPlayersRemaining: 9, ...entry,
    }],
    plays: [],
    ...over,
  });

  test('a reconnect re-reads the week matchups', async () => {
    mockGetByUrl(gameDayMocks(actionItems([])));
    renderPage();
    await screen.findByTestId('matchup-versus');
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const reads = () => apiClient.get.mock.calls.filter(([url]) => url === MP_LIST_URL).length;
    const before = reads();

    act(() => sockets.forEach((socket) => socket.reconnect()));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  test('"As of" is the time the read completed, not the time of a cached remount', async () => {
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(new Date(2026, 9, 18, 14, 40, 50).getTime());
    mockGetByUrl(gameDayMocks(actionItems([])));
    const { unmount } = renderPage();
    await screen.findByTestId('matchup-as-of');
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:40 PM');
    unmount();

    // 25 seconds on: the matchups entry is still fresh, so the remount reads nothing new.
    clock.mockReturnValue(new Date(2026, 9, 18, 14, 41, 15).getTime());
    renderPage();
    await screen.findByTestId('matchup-as-of');
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:40 PM');
  });

  test('only a current-week event that touches the viewer matchup moves the stamp and the announcement', async () => {
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(new Date(2026, 9, 18, 14, 40).getTime());
    mockGetByUrl(gameDayMocks(actionItems([])));
    renderPage();
    await screen.findByTestId('matchup-as-of');
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const fire = (payload) => act(() => sockets.forEach((socket) => socket.fire('scores:updated', payload)));
    clock.mockReturnValue(new Date(2026, 9, 18, 14, 50).getTime());

    // Another week's slate, and another matchup of this week: nothing moves.
    fire(liveEvent({ week: 2 }));
    fire(liveEvent({}, { matchupId: 56, homeScore: 99.9 }));
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:40 PM');
    expect(screen.getByTestId('matchup-live-region')).toHaveTextContent('Squad 3 61.0, Squad 7 58.9, as of 2:40 PM');

    // The viewer's matchup with the same scores: the stamp moves, the announcement does not repeat.
    fire(liveEvent({}, { homeScore: 61.0, awayScore: 58.9 }));
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:50 PM');
    expect(screen.getByTestId('matchup-live-region')).toHaveTextContent('Squad 3 61.0, Squad 7 58.9, as of 2:40 PM');
  });

  test('an event that finishes the last game of the week opens Advance week without a reload', async () => {
    const rows = [
      mpLiveRow({ status: 'live' }),
      { ...mpViewerPaired[1], status: 'played', home_score: 100, away_score: 90 },
    ];
    mockGetByUrl({
      '/api/league/1': mpLeague({ league: { draft_status: 'complete', season_status: 'regular', current_week: 1, is_commissioner: true } }),
      [MP_LIST_URL]: mpMatchupsList(rows),
      ...actionItems([]),
    });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Advance to Week 2' });
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    expect(button).toBeDisabled();
    act(() => {
      sockets.forEach((socket) => socket.fire('scores:updated', {
        leagueId: 1, season: 2026, week: 1, scored: [{ matchupId: 55, status: 'played', homeScore: 118.4, awayScore: 96.2 }], plays: [],
      }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advance to Week 2' })).toBeEnabled());
  });
});

// AC2 (#2330): the count of cursors and filled actions on each page state. The one cursor and the one filled
// foot are the lead card of Your move; where nothing needs the viewer there is neither.
describe('the one cursor and the one filled action', () => {
  const LATER = () => IN_MINUTES(6 * 60);
  const fixtures = [
    ['in season, member', () => inSeasonLeague(), actionItems([lineupItem(LATER()), picksItem(LATER())]), 1, 1],
    ['game day, lock in 45 min, commissioner', () => gameDayLeague(), gameDayMocks(actionItems([lineupItem(IN_MINUTES(45)), picksItem(IN_MINUTES(45))])), 1, 1],
    ['game day, nothing due', () => gameDayLeague({ is_commissioner: false, invite_code: undefined }), gameDayMocks(actionItems([])), 0, 0],
    [
      'pre-draft, commissioner (join requests stay in the strip, not a Play)',
      () => preDraftLeague({ is_commissioner: true }),
      actionItems([item('join_requests', null, {
        title: 'Join requests', detail: '2 waiting', severity: 'timed', deadlineAt: IN_MINUTES(3 * 24 * 60), cta: { label: 'Review requests', to: '/league/1/commissioner' },
      })]),
      0, 0,
    ],
    [
      'drafting',
      () => leagueDetail({ league: { draft_status: 'active', season_status: 'regular' }, teams: buildTeams(8) }),
      actionItems([item('draft_live', null, { title: 'Draft Room', detail: 'Draft is live now', severity: 'blocking', cta: { label: 'Enter Draft Room', to: '/league/1/draft' } })]),
      1, 1,
    ],
    ['complete', () => inSeasonLeague({ season_status: 'complete' }), actionItems([]), 0, 0],
    ["pick'em-only", () => pickemOnlyLeague(), actionItems([picksItem(LATER())]), 1, 1],
  ];

  test.each(fixtures)('%s: %i cursor, %i filled action', async (_name, build, extra, cursors, filled) => {
    mockGetByUrl({ ...extra, '/api/league/1': build() });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
    await screen.findByTestId('dashboard-quick-actions');
    await waitFor(() => expect(cursorCount()).toBe(cursors));
    // Give the action-items read a moment to settle before an absence is asserted.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(ACTION_URL));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cursorCount()).toBe(cursors);
    expect(filledCount()).toBe(filled);
  });
});

// The pre-draft-fantasy-commissioner "raw name column" cutover case that used
// to live here (a team-profile rename patching the raw `name` CommissionerTools
// reads, proven by expanding the commissioner panel's League administration
// disclosure) is deleted with this ticket (#1110): CommissionerStrip mounts no
// legacy administration tree at any width (ADR 0034), so CommissionerTools is
// no longer reachable from this page at all - it composes AS-IS in
// src/pages/commissioner-console instead, which is where that surface's own
// coverage of the raw-name write-through now belongs. The teamName half of the
// same write-through stays covered above ("cutover: a team-profile rename
// writes through to the standings rows ...").
