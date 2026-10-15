/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the odds-bar blocks, a tile's unnamed article and the stamp's ancestry have no role to query */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LeagueStatusGrid from './LeagueStatusGrid';

// The My leagues / Live scores section of Home (#2315 S3), at the component
// seam: LeagueStatusGrid rendered alone with the rows GET /api/league?include=status
// returns (Contract B). No page, no network.

const DAY_MS = 24 * 60 * 60 * 1000;
const future = (ms) => new Date(Date.now() + ms).toISOString();

const renderGrid = (props) => render(<LeagueStatusGrid {...props} />, { wrapper: MemoryRouter });

const matchup = (overrides = {}) => ({
  id: 912,
  status: 'scheduled',
  opponent: { teamId: 488, name: 'Gridiron Ghosts' },
  my: { score: 0, expectedFinal: 105.9, playersRemaining: 9 },
  opp: { score: 0, expectedFinal: 98.4, playersRemaining: 9 },
  winProbability: null,
  ...overrides,
});

const fantasyLeague = (statusOverrides = {}, rowOverrides = {}) => ({
  id: 71,
  name: 'Thursday Night Regulars',
  my_team_id: 10,
  my_team_name: 'Polk High Legends',
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 6,
  is_owner: true,
  is_commissioner: true,
  team_count: 10,
  max_teams: 10,
  status: {
    phase: 'in-season',
    week: 6,
    record: { wins: 4, losses: 1, ties: 0 },
    standing: { rank: 2, of: 10 },
    matchup: matchup(),
    lineup: { emptySlots: [], problems: [], nextLockAt: future(DAY_MS) },
    ...statusOverrides,
  },
  statusError: false,
  ...rowOverrides,
});

const liveLeague = (matchupOverrides = {}, statusOverrides = {}, rowOverrides = {}) => fantasyLeague({
  matchup: matchup({
    status: 'live',
    my: { score: 87.4, expectedFinal: 118.6, playersRemaining: 4 },
    opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 2 },
    ...matchupOverrides,
  }),
  ...statusOverrides,
}, rowOverrides);

const finalLeague = (my, opp, rowOverrides = {}) => fantasyLeague({
  record: { wins: 5, losses: 1, ties: 0 },
  matchup: matchup({
    status: 'final',
    my: { score: my, expectedFinal: null, playersRemaining: 0 },
    opp: { score: opp, expectedFinal: null, playersRemaining: 0 },
  }),
}, rowOverrides);

const pickemLeague = (pickem = {}, rowOverrides = {}) => ({
  id: 5,
  name: "Sunday Pick'em",
  my_team_id: 50,
  my_team_name: 'Cubicle Crew',
  draft_status: 'pending',
  pickem_only: true,
  is_owner: false,
  is_commissioner: false,
  team_count: 12,
  max_teams: 30,
  status: {
    phase: 'in-season',
    week: 6,
    standing: { rank: 4, of: 12 },
    pickem: { made: 9, total: 15, missing: 6, nextLockAt: future(DAY_MS), ...pickem },
  },
  statusError: false,
  ...rowOverrides,
});

const preDraftLeague = (draft = {}, rowOverrides = {}) => ({
  id: 9,
  name: 'Dynasty Startup',
  my_team_id: 90,
  draft_status: 'pending',
  is_owner: true,
  is_commissioner: true,
  invite_code: 'EZ7K4Q92',
  team_count: 9,
  max_teams: 12,
  status: {
    phase: 'pre-draft',
    draft: {
      date: future(10 * DAY_MS), timezone: 'America/Chicago', seatsFilled: 9, maxTeams: 12, ...draft,
    },
  },
  statusError: false,
  ...rowOverrides,
});

const panelFor = (name) => screen.getByRole('article', { name });
// A tile's article is named by nothing but its h3, so find it through the heading.
const tileFor = (name) => screen.getByRole('heading', { level: 3, name }).closest('article');
const linkNames = (nav) => within(nav).getAllByRole('link').map((a) => a.textContent);

// emotion inserts each sx rule into document.styleSheets under the element's
// generated class, so a declared colour is read off the rule (jsdom lays out nothing).
const declaredStyle = (element) => {
  const classes = Array.from(element.classList).filter((c) => c.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => classes.some((cls) => rule.selectorText === `.${cls}`))
    .map((rule) => rule.style.cssText)
    .join(';');
};

describe('before kickoff', () => {
  test('a scheduled fantasy league is a panel with the status line, projected sides and its links in order', () => {
    renderGrid({ leagues: [fantasyLeague()] });
    expect(screen.getByRole('heading', { level: 2, name: 'My leagues' })).toBeInTheDocument();
    const panel = panelFor('Thursday Night Regulars');
    expect(within(panel).getByRole('link', { name: 'Thursday Night Regulars' })).toHaveAttribute('href', '/league/71');
    expect(within(panel).getByText('4-1 · 2nd of 10')).toBeInTheDocument();
    expect(within(panel).getByText(/^vs Gridiron Ghosts · kicks off /)).toBeInTheDocument();
    expect(within(panel).getByText('Projected')).toBeInTheDocument();
    expect(within(panel).getByText('105.9')).toBeInTheDocument();
    expect(within(panel).getByText('98.4')).toBeInTheDocument();
    expect(within(panel).getByText('Lineup set')).toBeInTheDocument();
    expect(linkNames(within(panel).getByRole('navigation', { name: 'Thursday Night Regulars' }))).toEqual(['Matchup', 'Lineup', 'Waivers']);
    expect(within(panel).getByRole('link', { name: 'Thursday Night Regulars matchup' })).toHaveAttribute('href', '/league/71/matchups/912');
  });

  test('the odds bar is 20 blocks in Frame colour, never the live green', () => {
    const { container } = renderGrid({ leagues: [fantasyLeague()] });
    const bar = screen.getByRole('img', { name: /% win probability$/ });
    expect(bar.children).toHaveLength(20);
    const filled = container.querySelectorAll('[data-on="true"]');
    expect(filled.length).toBeGreaterThan(0);
    expect(declaredStyle(filled[0])).toContain('var(--home-frame)');
    expect(declaredStyle(filled[0])).not.toContain('accent');
    expect(declaredStyle(filled[0])).not.toContain('live');
  });

  test("pick'em on a fantasy league adds Picks between Lineup and Waivers and a progress line", () => {
    renderGrid({ leagues: [fantasyLeague({ pickem: { made: 3, total: 14, missing: 11, nextLockAt: future(DAY_MS) } })] });
    const panel = panelFor('Thursday Night Regulars');
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Matchup', 'Lineup', 'Picks', 'Waivers']);
    expect(within(panel).getByText('Week 6 picks: 3 of 14 made')).toBeInTheDocument();
  });

  test('lineup health names the first problem and counts the rest', () => {
    renderGrid({
      leagues: [fantasyLeague({ lineup: { emptySlots: ['FLEX'], problems: ['1 empty FLEX slot', 'Puka Nacua is Out'], nextLockAt: null } })],
    });
    expect(screen.getByText('1 empty FLEX slot · 1 more')).toBeInTheDocument();
    expect(screen.queryByText('Lineup set')).toBeNull();
  });

  test('a bye week says so, draws no odds bar and links no matchup', () => {
    renderGrid({ leagues: [fantasyLeague({ matchup: null })] });
    const panel = panelFor('Thursday Night Regulars');
    expect(within(panel).getByText('Bye week')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /win probability/ })).toBeNull();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Lineup', 'Waivers']);
  });

  test("a pick'em-only league shows the standing and picks progress, and no season points", () => {
    renderGrid({ leagues: [pickemLeague()] });
    const panel = panelFor("Sunday Pick'em");
    expect(within(panel).getByText('12 managers · season standings')).toBeInTheDocument();
    expect(within(panel).getByText('4th')).toBeInTheDocument();
    expect(within(panel).getByText('of 12')).toBeInTheDocument();
    expect(within(panel).getByText('Week 6 picks: 9 of 15 made')).toBeInTheDocument();
    expect(within(panel).queryByText(/points?\b/i)).toBeNull();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Picks']);
  });

  test('a pre-draft league shows the draft line, seats, the invite code and the draft room', () => {
    renderGrid({ leagues: [preDraftLeague()] });
    const panel = panelFor('Dynasty Startup');
    expect(within(panel).getByText(/^Draft [A-Z][a-z]{2} \d{1,2}$/)).toBeInTheDocument();
    expect(within(panel).getByText('9 of 12 seats filled')).toBeInTheDocument();
    expect(within(panel).getByText('EZ7K4Q92')).toBeInTheDocument();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Draft room', 'Draft settings']);
    expect(within(panel).getByRole('link', { name: 'Dynasty Startup draft room' })).toHaveAttribute('href', '/league/9/draft');
  });

  test('a league mid-draft says so, hides the invite code and the settings link', () => {
    renderGrid({ leagues: [preDraftLeague({}, { draft_status: 'active', status: { phase: 'drafting', draft: { seatsFilled: 12, maxTeams: 12 } } })] });
    const panel = panelFor('Dynasty Startup');
    expect(within(panel).getByText('Draft in progress')).toBeInTheDocument();
    expect(within(panel).queryByText('EZ7K4Q92')).toBeNull();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Draft room']);
  });

  test('a full pre-draft league hides the invite code, and a non-commissioner has no draft settings', () => {
    renderGrid({
      leagues: [preDraftLeague({ seatsFilled: 12 }, { is_commissioner: false })],
    });
    const panel = panelFor('Dynasty Startup');
    expect(within(panel).queryByText('EZ7K4Q92')).toBeNull();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Draft room']);
  });

  test('a row with no status, or a failed one, falls back to its name and a way in', () => {
    renderGrid({
      leagues: [
        fantasyLeague({}, { id: 1, name: 'No Status', status: null }),
        fantasyLeague({}, { id: 2, name: 'Failed Status', statusError: true }),
      ],
    });
    ['No Status', 'Failed Status'].forEach((name) => {
      const panel = panelFor(name);
      expect(within(panel).getByText('Status unavailable right now.')).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: `${name} league home` })).toBeInTheDocument();
    });
  });
});

describe('final', () => {
  test('a win shows the result chip in words, the trophy, and the winner in ink', () => {
    renderGrid({ leagues: [finalLeague(112.6, 97)] });
    const panel = panelFor('Thursday Night Regulars');
    expect(within(panel).getByText('Final · You won')).toBeInTheDocument();
    expect(within(panel).getByTestId('trophy')).toBeInTheDocument();
    expect(within(panel).getByText('Final: you 112.6, Gridiron Ghosts 97.0. You won. Now 5-1, 2nd of 10.')).toBeInTheDocument();
    expect(declaredStyle(within(panel).getByText('112.6'))).toContain('var(--home-ink)');
    expect(declaredStyle(within(panel).getByText('97.0'))).toContain('var(--home-dim)');
    expect(screen.queryByRole('img', { name: /win probability/ })).toBeNull();
    expect(linkNames(within(panel).getByRole('navigation'))).toEqual(['Matchup', 'Lineup', 'Waivers']);
  });

  test('a loss shows the chip alone, no trophy, and dims your score', () => {
    renderGrid({ leagues: [finalLeague(88.3, 104.6)] });
    const panel = panelFor('Thursday Night Regulars');
    expect(within(panel).getByText('Final · You lost')).toBeInTheDocument();
    expect(within(panel).queryByTestId('trophy')).toBeNull();
    expect(declaredStyle(within(panel).getByText('88.3'))).toContain('var(--home-dim)');
    expect(declaredStyle(within(panel).getByText('104.6'))).toContain('var(--home-ink)');
  });
});

describe('live', () => {
  test('a live league is a tile whose one score link carries the whole score, with the margin and odds', () => {
    renderGrid({ leagues: [liveLeague({}, { lineup: { emptySlots: [], problems: ['1 starter Out'], nextLockAt: null } })], live: true });
    const tile = tileFor('Thursday Night Regulars');
    const score = within(tile).getByRole('link', {
      name: /^Thursday Night Regulars matchup: you lead Gridiron Ghosts 87\.4 to 71\.2, up 16\.2, \d+% win probability\. 4 of your players and 2 of theirs remain\.$/,
    });
    expect(score).toHaveAttribute('href', '/league/71/matchups/912');
    expect(within(tile).getByText('Up 16.2')).toBeInTheDocument();
    expect(within(tile).getByText('4 players remaining')).toBeInTheDocument();
    expect(within(tile).getByText('2 players remaining')).toBeInTheDocument();
    expect(within(tile).getByText('4-1 · 2nd of 10, 1 starter Out')).toBeInTheDocument();
    expect(within(score).getByRole('img', { name: /% win probability$/ }).children).toHaveLength(20);
    // The score block is the matchup link; the foot has the rest.
    expect(linkNames(within(tile).getByRole('navigation'))).toEqual(['Lineup', 'Waivers']);
  });

  test('a trailing live league reads "Down" and dims your score', () => {
    renderGrid({
      leagues: [liveLeague({ my: { score: 64, expectedFinal: 90, playersRemaining: 6 }, opp: { score: 78.9, expectedFinal: 100, playersRemaining: 3 } })],
    });
    expect(screen.getByText('Down 14.9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /you trail Gridiron Ghosts 64\.0 to 78\.9, down 14\.9/ })).toBeInTheDocument();
  });

  test('the live heading and the updated stamp, plain text and not a live region', () => {
    renderGrid({ leagues: [liveLeague()], live: true, updatedAt: new Date(Date.now() - 3 * 60000).toISOString() });
    expect(screen.getByRole('heading', { level: 2, name: 'Live scores' })).toBeInTheDocument();
    const stamp = screen.getByText('updated 3 min ago · refreshes every minute');
    expect(stamp).not.toHaveAttribute('aria-live');
    expect(stamp.closest('[aria-live]')).toBeNull();
    expect(stamp.closest('[role="status"]')).toBeNull();
  });

  test('under a minute reads "just now"; with no live mode there is no stamp', () => {
    const { rerender } = renderGrid({ leagues: [liveLeague()], live: true, updatedAt: Date.now() });
    expect(screen.getByText('updated just now · refreshes every minute')).toBeInTheDocument();
    rerender(<LeagueStatusGrid leagues={[liveLeague()]} updatedAt={Date.now()} />);
    expect(screen.queryByText(/refreshes every minute/)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'My leagues' })).toBeInTheDocument();
  });

  test('on game day the live tiles come first and the other leagues stay panels after them', () => {
    const leagues = [preDraftLeague(), fantasyLeague({}, { id: 72, name: 'Office League' }), liveLeague()];
    renderGrid({ leagues, live: true });
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Thursday Night Regulars', 'Dynasty Startup', 'Office League']);
    // The first is a tile (a score link), the others have no score block.
    expect(within(tileFor('Thursday Night Regulars')).getByText('Up 16.2')).toBeInTheDocument();
    expect(within(panelFor('Office League')).getByText('Projected')).toBeInTheDocument();
  });

  test("a pick'em-only league on game day is a tile with the standing and picks in, and no points", () => {
    renderGrid({ leagues: [pickemLeague()], live: true });
    const tile = tileFor("Sunday Pick'em");
    const link = within(tile).getByRole('link', { name: "Sunday Pick'em picks: 4th of 12 this season, 9 of 15 in" });
    expect(link).toHaveAttribute('href', '/league/5/pickem');
    expect(within(tile).getByText('4th')).toBeInTheDocument();
    expect(within(tile).getByText('9 of 15 in')).toBeInTheDocument();
    expect(within(tile).queryByText(/points/i)).toBeNull();
  });
});

describe('score flash', () => {
  const tileLeagues = (myScore) => [
    liveLeague({ my: { score: myScore, expectedFinal: 118.6, playersRemaining: 4 } }),
    liveLeague({}, {}, { id: 72, name: 'Office League' }),
  ];
  const scoreLinks = () => screen.getAllByRole('link', { name: /matchup: you/ });

  test('the first render never flashes', () => {
    renderGrid({ leagues: tileLeagues(87.4), live: true });
    scoreLinks().forEach((a) => expect(a).not.toHaveClass('scored'));
  });

  test('a refresh that changes one score flashes that tile only, and the next quiet refresh clears it', () => {
    const { rerender } = renderGrid({ leagues: tileLeagues(87.4), live: true });
    rerender(<LeagueStatusGrid leagues={tileLeagues(93.1)} live />);
    const [first, second] = scoreLinks();
    expect(first).toHaveAccessibleName(/87\.4|93\.1/);
    expect(first).toHaveClass('scored');
    expect(first).toHaveAccessibleName(/93\.1/);
    expect(second).not.toHaveClass('scored');
    rerender(<LeagueStatusGrid leagues={tileLeagues(93.1)} live />);
    scoreLinks().forEach((a) => expect(a).not.toHaveClass('scored'));
  });
});

describe('error and loading', () => {
  test('an error with nothing loaded shows the alert and Try again calls onRetry', async () => {
    const onRetry = jest.fn();
    renderGrid({ leagues: [], error: new Error('Network Error'), onRetry });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText("Couldn't load your leagues")).toBeInTheDocument();
    expect(within(alert).getByText('Check your connection, then try again.')).toBeInTheDocument();
    expect(screen.queryByText('Network Error')).toBeNull();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try loading your leagues again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 2, name: 'My leagues' })).toBeInTheDocument();
  });

  test('an error keeps the leagues already on screen under it', () => {
    renderGrid({ leagues: [fantasyLeague()], error: true, onRetry: jest.fn() });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(panelFor('Thursday Night Regulars')).toBeInTheDocument();
  });

  test('loading with no leagues shows three skeleton panels and no content', () => {
    renderGrid({ leagues: [], loading: true });
    const skeletons = screen.getAllByLabelText('Loading a league');
    expect(skeletons).toHaveLength(3);
    skeletons.forEach((s) => expect(s).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('loading with leagues already there keeps showing them', () => {
    renderGrid({ leagues: [fantasyLeague()], loading: true });
    expect(screen.queryByLabelText('Loading a league')).toBeNull();
    expect(panelFor('Thursday Night Regulars')).toBeInTheDocument();
  });

  test('an empty list with no error renders nothing', () => {
    const { container } = renderGrid({ leagues: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
