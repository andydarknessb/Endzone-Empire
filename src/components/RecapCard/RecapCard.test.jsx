import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { invalidate } from '../../lib/resourceCache';
import RecapCard from './RecapCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

beforeEach(() => {
  // The commissioner flag rides useLeague's shared cache (ADR 0004), which is
  // module state that outlives a test, so it is cleared whole between them
  // (CommissionerStrip.test.jsx's own convention for the same hook).
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

/**
 * Answers apiClient.get by URL, the same convention CommissionerStrip.test.jsx
 * uses for a component that reads more than one endpoint (here: the recap
 * itself, plus the shared league read `useLeague` fires for `is_commissioner`).
 */
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
};

const leagueResponse = (isCommissioner, currentSeason = 2026) => ({
  data: {
    league: { id: 1, is_commissioner: isCommissioner, current_season: currentSeason },
    teams: [],
    viewerTeamId: null,
  },
});

// The stamp's expected text, built from the same Intl call the card names
// (#1988 L23): month short, day, hour, minute; no seconds, no year.
const generatedLabel = (iso) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

// The emotion rules inserted for an element's generated class(es), as one
// string: jsdom neither lays out nor computes sx, but every rule lands in
// document.styleSheets under the element's css- class.
const rulesFor = (el) => {
  const classes = Array.from(el.classList).filter((c) => c.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => rule.selectorText && classes.some((c) => rule.selectorText === `.${c}`))
    .map((rule) => rule.cssText)
    .join(';');
};
const minHeightOf = (el) => (rulesFor(el).match(/min-height:\s*([\w.]+)/) || [])[1];

const recapResponse = (overrides = {}) => ({
  data: {
    season: 2026,
    week: 5,
    data: {
      generatedAt: '2026-07-10T12:00:00.000Z',
      narrative: 'The Sunday Ballers exploded for a league-high performance this week.',
      facts: {
        highestScorer: { team: 'Sunday Ballers', points: 142.5 },
        benchBlunder: { team: 'Bad Luck FC', pointsLeftOnBench: 22.1 },
        waiverSteal: { player: 'Puka Nacua', team: 'Bad Luck FC', points: 28.4 },
        closestMatchup: { home: 'Team A', away: 'Team B', homeScore: 100, awayScore: 99, margin: 1 },
      },
      ...overrides,
    },
  },
});

test('renders the narrative when a recap is available, with the week in the Card title and no Week badge', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(
    screen.getByText('The Sunday Ballers exploded for a league-high performance this week.')
  ).toBeInTheDocument();
  // The week rides the Card title now (#1988 L23), not a separate Badge.
  expect(screen.queryByText('Week 5')).not.toBeInTheDocument();
});

// #1988 L22: the facts are a compact list of rows above the narrative, a bold
// label then the value, with middots (ADR 0016) where the pills used
// parentheses, hyphens and "margin N".
test('lists the facts as rows: a bold label, then the value with middot separators', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);
  await screen.findByTestId('recap-card');

  const rows = within(screen.getByRole('list')).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'High scoreSunday Ballers · 142.5',
    'Bench blunderBad Luck FC · 22.1 left on the bench',
    'Waiver stealPuka Nacua · Bad Luck FC · 28.4 pts',
    'Closest gameTeam A vs Team B · by 1',
  ]);
  expect(screen.getByText('High score')).toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers · 142.5')).toBeInTheDocument();
  // No pill copy survives: no parenthesised value, no hyphen separator, no "margin N".
  expect(screen.getByRole('list').textContent).not.toMatch(/[()]|margin| - /);
});

// The list reads before the narrative (facts above the story).
test('the facts list sits above the narrative', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);
  await screen.findByTestId('recap-card');

  const list = screen.getByRole('list');
  const narrative = screen.getByText(/exploded for a league-high/);
  expect(list.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// The route's outline was h1, h6, h2, h2, h6 (ADR 0021): this card and the
// Trophy Case were the two literal h6s. It cannot be asserted from
// LeagueDashboardPage.test.jsx, which mocks both components as bare divs, so a
// page-level "no level-6 heading" check passes with or without the fix.
test('renders its heading at level 2, titled with the week', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);

  const card = await screen.findByTestId('recap-card');
  const heading = screen.getByRole('heading', { level: 2, name: 'Week 5 Recap' });
  expect(heading).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 6 })).not.toBeInTheDocument();
  // The card is the region that heading names, so the heading is reachable by
  // landmark as well as by outline.
  expect(card).toHaveAttribute('aria-labelledby', heading.id);
});

// #1988 L23: the house header. A recap with no week (an old row) reads the
// generic title rather than "Week null Recap".
test('titles the Card "Weekly Recap" when the recap has no week', async () => {
  const response = recapResponse();
  apiClient.get.mockResolvedValue({ data: { ...response.data, week: null } });

  renderWithProviders(<RecapCard leagueId={1} />);

  await screen.findByTestId('recap-card');
  expect(screen.getByRole('heading', { level: 2, name: 'Weekly Recap' })).toBeInTheDocument();
});

// #916 family: no emoji in product UI. The five recap glyphs are inline stroke
// SVG now, one per fact, each aria-hidden so the sentence carries the meaning.
test('marks each fact row with a decorative stroke icon, no emoji', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);
  const card = await screen.findByTestId('recap-card');

  expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design, so no Testing Library query can reach them
  const icons = card.querySelectorAll('svg[data-icon]');
  expect(icons).toHaveLength(4);
  icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  // And each is actually 20px. Box takes width/height as system props, so a
  // string value is emitted unitless, dropped, and never reaches the element as
  // an attribute either, leaving the glyph to draw at its own scale. The same
  // mistake sized the League History medals at roughly 90px, and presence plus
  // aria-hidden both stayed green through it, so the size is asserted here.
  icons.forEach((icon) => {
    const iconRules = rulesFor(icon);
    expect(iconRules).toMatch(/width:\s*20px/);
    expect(iconRules).toMatch(/height:\s*20px/);
  });
});

test('renders a biggestBlowout row when present', async () => {
  apiClient.get.mockResolvedValue(
    recapResponse({
      facts: {
        biggestBlowout: { home: 'Team C', away: 'Team D', homeScore: 150, awayScore: 60, margin: 90 },
      },
    })
  );

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(screen.getByText('Biggest blowout')).toBeInTheDocument();
  expect(screen.getByText('Team C vs Team D · by 90')).toBeInTheDocument();
});

test('renders nothing while no recap has been fetched yet', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<RecapCard leagueId={1} />);
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});

test('hides itself when the recap endpoint 404s (not generated yet)', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });

  renderWithProviders(<RecapCard leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});

test('hides itself on a generic fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('network down'));

  renderWithProviders(<RecapCard leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});

// #1412: a commissioner can rebuild a finalized week's recap on demand. The
// last-generated stamp is visible to every member (so a manager can tell
// whether it predates a correction); the rebuild control is commissioner-only.

test('shows when the recap was last generated, visible to a plain member', async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse(),
    '/api/league/1': leagueResponse(false),
  });

  renderWithProviders(<RecapCard leagueId={1} />);

  await screen.findByTestId('recap-card');
  expect(screen.getByText(`Generated ${generatedLabel('2026-07-10T12:00:00.000Z')}`)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /rebuild recap/i })).not.toBeInTheDocument();
});

// #1988 L23: "Generated Dec 29, 3:00 AM", not toLocaleString()'s
// "12/29/2026, 3:00:45 AM".
test('the generated stamp has no seconds and no year', async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse({ generatedAt: '2026-12-29T03:00:45.000Z' }),
    '/api/league/1': leagueResponse(false),
  });

  renderWithProviders(<RecapCard leagueId={1} />);

  await screen.findByTestId('recap-card');
  const stamp = screen.getByText(/^Generated /);
  expect(stamp.textContent).toMatch(/^Generated [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/);
  expect(stamp.textContent).not.toMatch(/2026|:\d{2}:\d{2}/);
});

test('shows the rebuild control only to commissioners', async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse(), // season 2026
    '/api/league/1': leagueResponse(true, 2026),
  });

  renderWithProviders(<RecapCard leagueId={1} />);

  await screen.findByTestId('recap-card');
  expect(await screen.findByRole('button', { name: /rebuild recap/i })).toBeInTheDocument();
});

// #1988 L23: the rebuild button rides the Card's tail (the header row beside
// the title), and clears the touch-target floor.
test('puts the rebuild button in the Card header with a 44px minimum height', async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse(),
    '/api/league/1': leagueResponse(true, 2026),
  });

  renderWithProviders(<RecapCard leagueId={1} />);

  const button = await screen.findByRole('button', { name: /rebuild recap/i });
  const heading = screen.getByRole('heading', { level: 2 });
  // eslint-disable-next-line testing-library/no-node-access -- the header is the heading's parent; no query reaches a layout wrapper
  expect(heading.parentElement).toContainElement(button);
  expect(minHeightOf(button)).toBe('44px');
});

// formal-001 f3: the rebuild is scoped to a finalized week of the CURRENT
// season. GET /recap has no current-season filter, so a league between
// rollover and its first recap of the new season can be showing an OLDER
// season's (still finalized) recap — offering the control there would
// silently target a different season's week once clicked.
test("hides the rebuild control when the displayed recap predates the league's current season, even for a commissioner", async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse(), // season 2026
    '/api/league/1': leagueResponse(true, 2027),
  });

  renderWithProviders(<RecapCard leagueId={1} />);

  await screen.findByTestId('recap-card');
  expect(screen.queryByRole('button', { name: /rebuild recap/i })).not.toBeInTheDocument();
});

test('a commissioner can rebuild the recap and see the refreshed narrative and stamp', async () => {
  mockGetByUrl({
    '/api/scoring/league/1/recap': recapResponse(), // season 2026
    '/api/league/1': leagueResponse(true, 2026),
  });
  apiClient.post.mockResolvedValue({
    data: {
      season: 2026,
      week: 5,
      data: {
        generatedAt: '2026-07-12T09:00:00.000Z',
        narrative: 'Rebuilt narrative after the correction.',
        facts: {},
      },
    },
  });

  renderWithProviders(<RecapCard leagueId={1} />);
  const button = await screen.findByRole('button', { name: /rebuild recap/i });
  await userEvent.click(button);

  // The client names the season it had on screen, so the route can refuse a
  // mismatch instead of silently substituting the league's current season.
  expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/recap', { week: 5, season: 2026 });
  expect(await screen.findByText('Rebuilt narrative after the correction.')).toBeInTheDocument();
  expect(screen.getByText(`Generated ${generatedLabel('2026-07-12T09:00:00.000Z')}`)).toBeInTheDocument();
  // The rebuilt recap has no facts, so the list is gone with them.
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

// #1988 L21: the narrative clamps to 3 lines and a toggle offers the rest, but
// only when the text actually overflows. jsdom has no layout, so overflow is
// driven by stubbing scrollHeight/clientHeight on every element.
describe('collapsed narrative', () => {
  const stubOverflow = (scrollHeight, clientHeight) => {
    jest.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
    jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a narrative that overflows 3 lines gets a Read the full recap toggle wired to it', async () => {
    stubOverflow(180, 63);
    apiClient.get.mockResolvedValue(recapResponse());

    renderWithProviders(<RecapCard leagueId={1} />);

    const toggle = await screen.findByRole('button', { name: 'Read the full recap' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const narrative = screen.getByText(/The Sunday Ballers exploded/);
    expect(toggle).toHaveAttribute('aria-controls', narrative.id);
    expect(narrative.id).not.toBe('');
    expect(minHeightOf(toggle)).toBe('44px');
    expect(rulesFor(narrative)).toMatch(/-webkit-line-clamp:\s*3/);
    expect(rulesFor(narrative)).toMatch(/overflow:\s*hidden/);

    await userEvent.click(toggle);
    const expanded = screen.getByRole('button', { name: 'Show less' });
    expect(expanded).toHaveAttribute('aria-expanded', 'true');
    expect(expanded).toHaveAttribute('aria-controls', narrative.id);
    // Open, the clamp is gone and the whole narrative shows.
    expect(rulesFor(narrative)).not.toMatch(/-webkit-line-clamp/);

    await userEvent.click(expanded);
    expect(screen.getByRole('button', { name: 'Read the full recap' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a short narrative shows whole with no toggle', async () => {
    stubOverflow(63, 63);
    apiClient.get.mockResolvedValue(recapResponse());

    renderWithProviders(<RecapCard leagueId={1} />);

    await screen.findByTestId('recap-card');
    expect(screen.queryByRole('button', { name: /read the full recap|show less/i })).not.toBeInTheDocument();
  });

  test('re-checks the overflow when the window resizes', async () => {
    stubOverflow(63, 63);
    apiClient.get.mockResolvedValue(recapResponse());

    renderWithProviders(<RecapCard leagueId={1} />);
    await screen.findByTestId('recap-card');
    expect(screen.queryByRole('button', { name: 'Read the full recap' })).not.toBeInTheDocument();

    jest.restoreAllMocks();
    stubOverflow(180, 63);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(await screen.findByRole('button', { name: 'Read the full recap' })).toBeInTheDocument();
  });
});
