/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import { clearLeagueCache } from '../../hooks/useLeague';
import { clearPickemSettingsCache } from '../../entities/pickem-game';
import { clearPickemStandingsCache } from '../../entities/pickem-standings';
import apiClient from '../../api/apiClient';
import PickemPage from './PickemPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

/**
 * Page-composition tests for `pages/pickem` (#1267, ADR 0038; Play-select and save on tap, ADR 0067
 * wave 2). Every branch of the board and standings themselves has dedicated coverage in
 * widgets/pickem-board and widgets/pickem-standings; this suite proves the page composes them
 * correctly: the head, the disabled state, the commissioner row, the section switch, the cursor and
 * filled-action counts, and that no unsaved-picks guard remains.
 */
const LEAGUE_ID = 7;
// Fixed instant (#1351): NOW is a fixed Friday; +48h lands the fixture's games on a fixed Sunday
// 12:00 EDT instant (the `sunday-early` window) on every run, and +2h is the Friday evening, well
// outside the lock hour.
const NOW = Date.parse('2026-09-11T16:00:00Z');
const hoursFromNow = (hours) => new Date(NOW + hours * 3600 * 1000).toISOString();

let mobile = false;

const league = (overrides = {}) => ({
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  current_season: 2026,
  current_week: 3,
  ...overrides,
});

const openGame = (overrides = {}) => ({
  gameKey: 'NYJ|TEN',
  teams: ['NYJ', 'TEN'],
  kickoffAt: hoursFromNow(48),
  homeTeam: 'TEN',
  awayTeam: 'NYJ',
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  quarter: null,
  timeRemaining: null,
  locked: false,
  winner: null,
  isTie: false,
  pickedCount: 0,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
  ...overrides,
});
const secondGame = (overrides = {}) => openGame({
  gameKey: 'DAL|WAS', teams: ['DAL', 'WAS'], homeTeam: 'WAS', awayTeam: 'DAL', kickoffAt: hoursFromNow(49), ...overrides,
});

const weekResponse = (week, overrides = {}) => ({
  season: 2026,
  week,
  mode: 'straight',
  games: [openGame(), secondGame()],
  myPicks: [],
  othersPicks: {},
  ...overrides,
});

const standingsResponse = (overrides = {}) => ({
  season: 2026,
  mode: 'straight',
  standings: [],
  ...overrides,
});

// A fake server: a PUT of picks changes what the next week GET returns.
const mockRequests = ({
  settings = { enabled: true, mode: 'straight', isCommissioner: false },
  leagueOverrides = {},
  weeks = { 3: weekResponse(3) },
  standings = standingsResponse(),
} = {}) => {
  const picks = {};
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/settings`)) {
      return Promise.resolve({ data: settings });
    }
    const weekMatch = url.match(new RegExp(`/api/pickem/league/${LEAGUE_ID}/week/(\\d+)$`));
    if (weekMatch) {
      const week = Number(weekMatch[1]);
      if (!Object.prototype.hasOwnProperty.call(weeks, week)) return Promise.reject(new Error(`unexpected week GET ${url}`));
      return Promise.resolve({ data: { ...weeks[week], myPicks: [...weeks[week].myPicks, ...Object.values(picks)] } });
    }
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/standings`)) {
      return Promise.resolve({ data: standings });
    }
    if (url === `/api/league/${LEAGUE_ID}`) {
      return Promise.resolve({ data: { league: league(leagueOverrides), teams: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  apiClient.put.mockImplementation(async (url, body) => {
    if (url.endsWith('/picks')) {
      for (const pick of body.picks) {
        if (pick.pickedTeam == null) delete picks[pick.gameKey];
        else picks[pick.gameKey] = { gameKey: pick.gameKey, pickedTeam: pick.pickedTeam, confidence: pick.confidence ?? null };
      }
    }
    return { data: { saved: body.picks ? body.picks.length : 0 } };
  });
};

const renderPage = (route = `/league/${LEAGUE_ID}/pickem`) =>
  renderWithProviders(<PickemPage />, { route, path: '/league/:leagueId/pickem' });

const standingsCalls = () => apiClient.get.mock.calls.filter(([u]) => u.includes('/standings')).length;
const titans = () => screen.findByRole('button', { name: /^TEN,/ });

beforeEach(() => {
  jest.clearAllMocks();
  mobile = false;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
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
  clearLeagueCache();
  clearPickemSettingsCache();
  clearPickemStandingsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('the breadcrumb, h1 and no skipped heading level render for every state', async () => {
  mockRequests();
  renderPage();

  expect(screen.getByRole('heading', { level: 1, name: "Pick'em" })).toBeInTheDocument();
  await titans();
  const crumb = screen.getByTestId('pickem-breadcrumb');
  expect(crumb).toHaveTextContent('Sunday Ballers');
  expect(within(crumb).getByText("Pick'em")).toHaveAttribute('aria-current', 'page');

  // axe's heading-order rule: a heading's level never jumps past the highest level seen so far by
  // more than one (h1 -> h2 -> h3 is fine; h1 -> h3 with no h2 between is not).
  const levels = screen.getAllByRole('heading').map((el) => Number(el.tagName.slice(1)));
  expect(levels[0]).toBe(1);
  let highestSoFar = 1;
  for (const level of levels) {
    expect(level).toBeLessThanOrEqual(highestSoFar + 1);
    highestSoFar = Math.max(highestSoFar, level);
  }
  expect(screen.getByRole('heading', { level: 2, name: 'Picks' })).toBeInTheDocument();
});

test('below sm the breadcrumb drops the current page and leaves no trailing separator', async () => {
  mobile = true;
  mockRequests();
  renderPage();
  await titans();
  const crumb = screen.getByTestId('pickem-breadcrumb');
  expect(within(crumb).queryByText("Pick'em")).not.toBeInTheDocument();
  const items = within(crumb).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  // Only the separator between Leagues and the league remains.
  expect(crumb.querySelectorAll('svg')).toHaveLength(1);
});

test('a member sees an explanation when the commissioner has not enabled Pick\'em, and no week is fetched', async () => {
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: false } });
  renderPage();

  const notice = await screen.findByTestId('pickem-disabled');
  expect(notice).toHaveTextContent(/hasn't enabled Pick'em/i);
  expect(within(notice).getByRole('heading', { level: 2, name: "Pick'em is off" })).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/week/'));
});

test('a commissioner sees the settings widget instead of the disabled notice, and can turn it on', async () => {
  const user = userEvent.setup();
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: true } });
  apiClient.put.mockResolvedValue({ data: { enabled: true, mode: 'straight', isCommissioner: true } });
  renderPage();

  const toggle = await screen.findByRole('switch', { name: /Enable Pick'em for this league/i });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(`/api/pickem/league/${LEAGUE_ID}/settings`, { enabled: true })
  );
  // Write-through: the board mounts off the saved row with no follow-up GET.
  expect(await titans()).toBeInTheDocument();
  // Accessibility risk review, #1267: the settings widget stays mounted at the same tree position
  // whether Pick'em is on or off, so the switch the click is still focused on is never unmounted out
  // from under it (a remount would drop focus to <body>, WCAG 4.1.2).
  expect(toggle).toHaveFocus();
  expect(toggle).toBeChecked();
});

test('an enabled league renders the board for a member, with no settings widget', async () => {
  mockRequests();
  renderPage();

  expect(await titans()).toBeInTheDocument();
  expect(screen.queryByTestId('pickem-settings')).not.toBeInTheDocument();
});

test('AC 6g: a commissioner sees the collapsed settings row above the sections control, with Edit collapsed and no radios until it is pressed', async () => {
  const user = userEvent.setup();
  mockRequests({ settings: { enabled: true, mode: 'straight', isCommissioner: true } });
  renderPage();

  await titans();
  const panel = screen.getByTestId('pickem-settings');
  expect(within(panel).getByRole('heading', { name: 'Commissioner settings' })).toBeInTheDocument();
  const edit = within(panel).getByRole('button', { name: /Edit/ });
  expect(edit).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('radio', { name: /Straight up/ })).not.toBeInTheDocument();
  // Above the sections control in document order.
  expect(panel.compareDocumentPosition(screen.getByTestId('pickem-sections')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(edit);
  const straight = screen.getByRole('radio', { name: /Straight up/ });
  expect(straight).toBeEnabled();
});

test('AC 6g: after the season\'s first pick the scoring radios are disabled and the row says locked for the season', async () => {
  const user = userEvent.setup();
  mockRequests({
    settings: { enabled: true, mode: 'straight', isCommissioner: true },
    standings: standingsResponse({ standings: [{ teamId: 1, teamName: 'A', rank: 1, points: 1, correct: 1, incorrect: 0, pushes: 0, pending: 0, made: 1, weekly: { 1: 1 } }] }),
  });
  renderPage();

  await titans();
  const panel = screen.getByTestId('pickem-settings');
  await waitFor(() => expect(within(panel).getByTestId('pickem-settings-summary')).toHaveTextContent('locked for the season'));
  await user.click(within(panel).getByRole('button', { name: /Edit/ }));
  within(panel).getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
  expect(screen.getByText("The mode can only change before the season's first pick.")).toBeInTheDocument();
});

test('a commissioner of a pick\'em-only league sees the row without "Pick\'em on"', async () => {
  mockRequests({
    settings: { enabled: true, mode: 'confidence', isCommissioner: true },
    leagueOverrides: { pickem_only: true },
    weeks: { 3: weekResponse(3, { mode: 'confidence' }) },
  });
  renderPage();
  await titans();
  expect(within(screen.getByTestId('pickem-settings')).getByTestId('pickem-settings-summary')).not.toHaveTextContent("Pick'em on");
});

test('the section switch moves between the board and the standings, keyed in the URL', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await titans();
  await user.click(screen.getByRole('radio', { name: 'Standings' }));

  expect(await screen.findByTestId('pickem-standings')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^TEN,/ })).not.toBeInTheDocument();
});

test('the Standings section keeps the plain Standings heading on its widget', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await titans();
  await user.click(screen.getByRole('radio', { name: 'Standings' }));

  expect(await screen.findByRole('heading', { name: 'Standings' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Pick'em Standings" })).not.toBeInTheDocument();
});

test('the sections control is the playselect look: the selected section carries an arrow, one tab stop', async () => {
  mockRequests();
  renderPage();
  await titans();
  const picks = screen.getByRole('radio', { name: 'Picks' });
  const standings = screen.getByRole('radio', { name: 'Standings' });
  expect(picks).toHaveAttribute('aria-checked', 'true');
  expect(picks.querySelector('svg')).not.toBeNull();
  expect(picks).toHaveAttribute('tabindex', '0');
  expect(standings).toHaveAttribute('tabindex', '-1');
});

test('AC 6i: no discard dialog guards a week change or a section switch, and nothing offers Save picks', async () => {
  const user = userEvent.setup();
  mockRequests({ weeks: { 3: weekResponse(3), 4: weekResponse(4) } });
  renderPage();

  await user.click(await titans());
  await screen.findByRole('button', { name: /Undo pick/ });
  expect(screen.queryByRole('button', { name: /Save picks/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(`/api/pickem/league/${LEAGUE_ID}/week/4`));

  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByTestId('pickem-standings')).toBeInTheDocument();
});

test('saving a pick invalidates the cached standings so the Standings tab reflects it', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await titans();
  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  const before = standingsCalls();

  await user.click(screen.getByRole('radio', { name: 'Picks' }));
  await user.click(await titans());
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());

  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  await waitFor(() => expect(standingsCalls()).toBeGreaterThan(before));
});

// Formal review f3: the standings body names the mode in force, so a scoring-mode change must not
// leave the cached table captioned with the old one.
test('a scoring-mode change invalidates the cached standings (the caption names the mode)', async () => {
  const user = userEvent.setup();
  mockRequests({ settings: { enabled: true, mode: 'straight', isCommissioner: true } });
  apiClient.put.mockResolvedValue({ data: { enabled: true, mode: 'confidence', isCommissioner: true } });
  renderPage();

  await titans();
  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  const before = standingsCalls();

  await user.click(screen.getByRole('button', { name: /Edit commissioner settings/ }));
  await user.click(screen.getByRole('radio', { name: /Confidence/ }));
  await user.click(screen.getByRole('button', { name: /Save scoring mode/i }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());

  await waitFor(() => expect(standingsCalls()).toBeGreaterThan(before));
});

// The mirror of "saving a pick invalidates the cached standings": a PICKEM_LOCKED rejection saved
// nothing, so nothing went stale.
test('a rejected pick save does not invalidate the cached standings', async () => {
  const user = userEvent.setup();
  mockRequests();
  apiClient.put.mockRejectedValue({
    response: { status: 409, data: { error: 'that game already kicked off', code: 'PICKEM_LOCKED', gameKeys: ['NYJ|TEN'] } },
  });
  renderPage();

  await titans();
  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  const before = standingsCalls();

  await user.click(screen.getByRole('radio', { name: 'Picks' }));
  await user.click(await titans());
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
  await screen.findByText(/This pick wasn't saved: NYJ @ TEN had already kicked off/);

  await user.click(screen.getByRole('radio', { name: 'Standings' }));
  await screen.findByTestId('pickem-standings');
  expect(standingsCalls()).toBe(before);
});

test('a deep link straight to the Standings tab renders it directly, with no Picks fetch', async () => {
  mockRequests();
  renderPage(`/league/${LEAGUE_ID}/pickem?tab=standings`);

  expect(await screen.findByTestId('pickem-standings')).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/week/'));
});

test('a failed league read shows the page error with a Retry that reloads', async () => {
  const user = userEvent.setup();
  mockRequests();
  const ok = apiClient.get.getMockImplementation();
  let failing = true;
  apiClient.get.mockImplementation((url) => (failing && url === `/api/league/${LEAGUE_ID}` ? Promise.reject(new Error('boom')) : ok(url)));
  renderPage();

  const error = await screen.findByTestId('pickem-page-error');
  expect(error).toHaveTextContent('We could not load this league. Check your connection and try again.');
  expect(screen.getByRole('heading', { level: 1, name: "Pick'em" })).toBeInTheDocument();
  failing = false;
  await user.click(within(error).getByRole('button', { name: 'Retry' }));
  expect(await titans()).toBeInTheDocument();
});

describe('AC 3: cursor and filled-action counts', () => {
  const cursors = () => document.querySelectorAll('.cursor').length;
  // A filled action is the page's one Accent-filled button or link (PsButton fill, a play card foot).
  const filled = () => Array.from(document.querySelectorAll('button, a')).filter((el) => {
    const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
    let text = '';
    Array.from(document.styleSheets).forEach((sheet) => Array.from(sheet.cssRules || []).forEach((rule) => {
      if (rule.selectorText && cls && rule.selectorText.startsWith(`.${cls}`)) text += rule.style.cssText;
    }));
    return el.getAttribute('data-filled') === 'true' || /background-color:\s*var\(--ps-accent\)/.test(text);
  }).length;

  test('an open week with unpicked games: one cursor, no filled action', async () => {
    mockRequests();
    renderPage();
    await titans();
    expect(cursors()).toBe(1);
    expect(filled()).toBe(0);
  });

  test('a save in flight or just saved: still one cursor (the other game is unpicked), no filled action', async () => {
    const user = userEvent.setup();
    mockRequests();
    renderPage();
    await user.click(await titans());
    await screen.findByRole('button', { name: /Undo pick/ });
    expect(cursors()).toBe(1);
    expect(filled()).toBe(0);
  });

  test('every game picked: no cursor and no filled action', async () => {
    mockRequests({
      weeks: {
        3: weekResponse(3, {
          myPicks: [
            { gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: null },
            { gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: null },
          ],
        }),
      },
    });
    renderPage();
    await titans();
    expect(cursors()).toBe(0);
    expect(filled()).toBe(0);
  });

  test('every game locked: no cursor and no filled action', async () => {
    mockRequests({
      weeks: { 3: weekResponse(3, { games: [openGame({ locked: true, status: 'in_progress', quarter: 'Q1' }), secondGame({ locked: true, status: 'in_progress', quarter: 'Q1' })] }) },
    });
    renderPage();
    await screen.findByTestId('pickem-status');
    expect(cursors()).toBe(0);
    expect(filled()).toBe(0);
  });

  test('the cursor sits on the earliest unpicked card, and its frame goes Danger 45 minutes from kickoff', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(hoursFromNow(48)) - 45 * 60 * 1000);
    mockRequests();
    renderPage();
    await titans();
    const frame = document.querySelector('.cursor');
    expect(frame).toContainElement(screen.getByRole('article', { name: /^NYJ at TEN/ }));
    expect(frame).toHaveStyle({ borderColor: 'var(--ps-danger)' });
  });
});

test('paints no dash token anywhere on the page', async () => {
  mockRequests({ settings: { enabled: true, mode: 'straight', isCommissioner: true } });
  const { container } = renderPage();
  await titans();
  expect(container.innerHTML).not.toMatch(/dash-/);
});
