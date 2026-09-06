import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import MatchupPreview from '../index';

/**
 * matchup-preview slice tests (T6). The composition assertions the page owns
 * (the chained read's gating, the skeleton/error/empty branches, the two link
 * targets) stay in LeagueDashboardPage.test.jsx; what lives here is what only
 * this slice can answer: which reads a started week is allowed to issue, what
 * the card shows once the game is on, and its own control geometry.
 *
 * The widget reads the league through the shared apiClient (useLeague ->
 * useResource) and its own two endpoints through useEndpoint, so the whole
 * client is mocked and every GET is answered by the URL-keyed dispatcher below
 * - the same seam the page test uses.
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

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
};

// teamId 3 is the viewer (home), 7 the opponent. `teamName` is the canonical
// Team identity field (teamIdentity.js), kept distinct from the league name so
// a value assertion cannot pass off the league's name as a Team's.
const TEAMS = [
  { teamId: 3, id: 3, teamName: 'MyBallsHurts', avatar_url: null, avatar_static_url: null },
  { teamId: 7, id: 7, teamName: 'Terrific T', avatar_url: null, avatar_static_url: null },
];

const leagueResponse = (league = {}) => ({
  data: {
    viewerTeamId: 3,
    league: { id: 1, name: 'MinneApple', current_week: 1, ...league },
    teams: TEAMS,
  },
});

// One week-1 list row pairing the viewer against Team 7, plus one unrelated
// matchup so the pick is a real find. Scores ride as STRINGS on purpose:
// `home_score` is a NOT NULL decimal and node-postgres hands decimals back as
// strings, which is exactly what the score coercion exists for.
const row = (over = {}) => ({
  id: 55,
  week: 1,
  season: 2026,
  final: false,
  status: null,
  home_team_id: 3,
  away_team_id: 7,
  home_score: '0.0',
  away_score: '0.0',
  home_expected_final: null,
  away_expected_final: null,
  home_players_remaining: null,
  away_players_remaining: null,
  ...over,
});

const listOf = (viewerRow) => ({
  data: [viewerRow, row({ id: 56, home_team_id: 5, away_team_id: 9 })],
});

const LIST_URL = '/api/league/1/matchups?week=1';

const renderCard = (viewerRow, league = {}) => {
  mockGetByUrl({ '/api/league/1': leagueResponse(league), [LIST_URL]: listOf(viewerRow) });
  return renderWithProviders(<MatchupPreview leagueId={1} />);
};

const detailCalls = () =>
  apiClient.get.mock.calls.filter(([url]) => /\/matchups\/\d+$/.test(url));

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule it generates into `document.styleSheets` under the element's
// generated class. This gathers one element's declarations, keyed by the media
// condition they sit under (`''` for the unconditional rule), so a responsive
// `sx` object can be read back: MUI compiles `{ xs, sm, md }` into
// `@media (min-width:0px)`, `(min-width:600px)` and `(min-width:900px)`.
const rulesUnder = (el, media = '') => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  // Media text is compared with whitespace stripped: emotion writes
  // "(min-width:600px)" and cssom may hand it back spaced.
  const norm = (value) => String(value).replace(/\s+/g, '');
  let found = '';
  const walk = (rules, condition) => {
    Array.from(rules).forEach((rule) => {
      if (rule.media) {
        walk(rule.cssRules || [], rule.media.mediaText || '');
        return;
      }
      if (rule.selectorText === `.${cls}` && norm(condition) === norm(media)) {
        found += `${rule.style.cssText};`;
      }
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => walk(sheet.cssRules, ''));
  return found;
};

const viewerSide = () => screen.getByTestId('matchup-side-viewer');
const opponentSide = () => screen.getByTestId('matchup-side-opponent');

// --- the read a finished week must not pay for --------------------------------

// Red-tell (T6): dropping the `hasStarted !== true` clause from
// `detailCanAnswer` turns this case red and no other. A final week's Expected
// finals are null by design, which makes `listHasBothFinals` false, so without
// the status gate the card fires the matchup DETAIL route on every load - a
// route that opens a transaction and materializes both teams' lineups to hand
// back the same two nulls.
test('final week: no detail fetch', async () => {
  renderCard(
    row({ final: true, status: 'final', home_score: '128.4', away_score: '117.9' })
  );

  await screen.findByTestId('matchup-side-viewer');
  expect(detailCalls()).toHaveLength(0);
  // The list read itself still happens exactly once: the spine is not what the
  // gate removes.
  expect(apiClient.get.mock.calls.filter(([u]) => u === LIST_URL)).toHaveLength(1);

  // A final week has no projection and nobody left to play, so neither tile
  // renders; the score the list already carried is what the card shows.
  expect(within(viewerSide()).getByTestId('matchup-side-score')).toHaveTextContent('128.4');
  expect(screen.queryByTestId('matchup-expected-final')).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-players-remaining')).not.toBeInTheDocument();
  expect(screen.queryByText('Not available')).not.toBeInTheDocument();
});

test('an unknown status keeps firing the detail fallback', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    [LIST_URL]: listOf(row({ status: null })),
    '/api/league/1/matchups/55': {
      data: {
        matchup: { id: 55, week: 1, season: 2026, home_team_id: 3, away_team_id: 7 },
        home: { teamId: 3, expectedFinal: 112.4 },
        away: { teamId: 7, expectedFinal: 118.9 },
      },
    },
  });
  renderWithProviders(<MatchupPreview leagueId={1} />);

  // `hasStarted` is null for an unknown status ("the server could not say" is
  // not "not started"), so the fallback must behave exactly as it did before
  // the gate existed.
  expect(await within(await screen.findByTestId('matchup-side-viewer')).findByText('112.4'))
    .toBeInTheDocument();
  expect(detailCalls()).toHaveLength(1);
});

// --- once started -------------------------------------------------------------

const LIVE_ROW = row({
  status: 'live',
  home_score: '82.2',
  // No decimal point on the wire, so a card that prints the raw string reads
  // "77" where every other figure on it reads to a tenth.
  away_score: '77',
  home_expected_final: '110.5',
  away_expected_final: '123.9',
  home_players_remaining: 4,
  away_players_remaining: 6,
});

test('a live matchup shows the score in the display slot, to one decimal', async () => {
  renderCard(LIVE_ROW);

  await screen.findByTestId('matchup-side-viewer');
  expect(within(viewerSide()).getByTestId('matchup-side-score')).toHaveTextContent('82.2');
  expect(within(opponentSide()).getByTestId('matchup-side-score')).toHaveTextContent('77.0');
  // The projection is demoted, not dropped, and the dash is gone: a live card
  // showed two static projections and no score before T6.
  expect(within(viewerSide()).queryByText('Not available')).not.toBeInTheDocument();
  expect(detailCalls()).toHaveLength(0);
});

test('a live matchup demotes each projection to an Expected final tile beside Players remaining', async () => {
  renderCard(LIVE_ROW);

  await screen.findByTestId('matchup-side-viewer');
  expect(within(viewerSide()).getByTestId('matchup-expected-final')).toHaveTextContent(
    'Expected final110.5'
  );
  expect(within(opponentSide()).getByTestId('matchup-expected-final')).toHaveTextContent(
    'Expected final123.9'
  );

  // "PMR" is the visible abbreviation; the expansion is what assistive tech
  // hears, so a screen reader gets "Players remaining 4".
  const pmr = within(viewerSide()).getByTestId('matchup-players-remaining');
  expect(within(pmr).getByText('Players remaining')).toBeInTheDocument();
  expect(within(pmr).getByText('PMR')).toHaveAttribute('aria-hidden', 'true');
  expect(pmr).toHaveTextContent(/4$/);
  expect(within(opponentSide()).getByTestId('matchup-players-remaining')).toHaveTextContent(/6$/);
});

// Red-tell (T6): feeding SplitBar a points ratio (82.2 / 159.2 = 52%) instead of
// `matchupWinProbability` turns this case red. The bar's accessible name is the
// hard-coded "Win probability" (#872), so a ratio there announces a probability
// the model never computed - and `projected.value` is a string, so the ratio
// arithmetic is NaN anyway.
test('the win probability bar is named from matchupWinProbability, never a points ratio', async () => {
  renderCard(LIVE_ROW);

  await screen.findByTestId('matchup-side-viewer');
  // Expected finals 110.5 (viewer) against 123.9: a 13.4 deficit over the 24
  // point margin scale is a 36% viewer share, not the 52% the scores split.
  expect(screen.getByTestId('split-bar')).toHaveAccessibleName(
    'Win probability: MyBallsHurts 36%, Terrific T 64%'
  );
  const block = screen.getByTestId('matchup-win-probability');
  expect(block).toHaveTextContent('36%');
  expect(block).toHaveTextContent('64%');
});

test.each([
  ['live', 'LIVE', 'danger'],
  ['played', 'Awaiting final', 'warning'],
  ['final', 'Final', 'success'],
])('a %s matchup carries the status badge in the card header', async (status, label, variant) => {
  renderCard(row({ ...LIVE_ROW, status }));

  await screen.findByTestId('matchup-side-viewer');
  const badge = screen.getByTestId('matchup-preview-status');
  expect(badge).toHaveTextContent(label);
  expect(badge).toHaveAttribute('data-variant', variant);
  // The header's projection note is what the badge replaces.
  expect(screen.queryByText('Projections update daily')).not.toBeInTheDocument();
});

// --- before kickoff -----------------------------------------------------------

test('before kickoff the card keeps the projections and captions the margin', async () => {
  renderCard(
    row({ status: 'scheduled', home_expected_final: '110.5', away_expected_final: '104.0' })
  );

  await screen.findByTestId('matchup-side-viewer');
  expect(within(viewerSide()).getByText('110.5')).toBeInTheDocument();
  expect(within(viewerSide()).getByText('Projected')).toBeInTheDocument();
  expect(screen.getByTestId('matchup-projected-margin')).toHaveTextContent(
    'Projected margin · MyBallsHurts by 6.5'
  );
  // Nothing about the game itself is asserted before it starts.
  expect(screen.queryByTestId('split-bar')).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-side-score')).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-preview-status')).not.toBeInTheDocument();
});

test('a level projection reads as even rather than "by 0.0"', async () => {
  renderCard(
    row({ status: 'scheduled', home_expected_final: '104.0', away_expected_final: '104.0' })
  );

  await screen.findByTestId('matchup-side-viewer');
  expect(screen.getByTestId('matchup-projected-margin')).toHaveTextContent(
    'Projected margin · Even'
  );
});

// --- geometry -----------------------------------------------------------------

// Red-tell (T6): reverting the versus block to a fixed `1fr auto 1fr` turns this
// case red. At 390px two content columns held each Team name to 125px and
// ellipsised both.
test('the versus block is one column on a phone and three from sm up', async () => {
  renderCard(row({ status: 'scheduled', home_expected_final: '110.5', away_expected_final: '104.0' }));

  await screen.findByTestId('matchup-side-viewer');
  const block = screen.getByTestId('matchup-versus');
  expect(rulesUnder(block, '(min-width:0px)')).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
  expect(rulesUnder(block, '(min-width:600px)')).toMatch(/grid-template-columns: 1fr auto 1fr/);
  // Without a centred justify-self the pill stretches into a full-width bar in
  // the one-column case.
  expect(rulesUnder(screen.getByText('VS'))).toMatch(/justify-self: center/);
});

test('the loading skeleton carries the same tracks, so the card does not reflow', async () => {
  // The league has to land for the week-scoped list URL to exist at all; it is
  // that list read the card skeletons for.
  apiClient.get.mockImplementation((url) =>
    url === '/api/league/1' ? Promise.resolve(leagueResponse()) : new Promise(() => {})
  );
  renderWithProviders(<MatchupPreview leagueId={1} />);

  const shapes = await screen.findAllByTestId('matchup-skeleton');
  const block = screen.getByTestId('matchup-versus');
  expect(rulesUnder(block, '(min-width:0px)')).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
  expect(rulesUnder(block, '(min-width:600px)')).toMatch(/grid-template-columns: 1fr auto 1fr/);
  // The pill's stand-in is centred for the same reason the pill is.
  expect(shapes.some((el) => rulesUnder(el).includes('justify-self: center'))).toBe(true);
});

// Red-tell (T2): deleting `minHeight: { xs: 44, md: 38 }` from `BUTTON_BASE`
// turns this case red and no other.
test('both footer actions meet the 44px touch target on a phone and stay 38px on desktop', async () => {
  renderCard(row({ status: 'scheduled' }));

  await screen.findByTestId('matchup-side-viewer');
  ['Compare rosters', 'Set Lineup'].forEach((name) => {
    const button = screen.getByRole('link', { name });
    expect(rulesUnder(button, '(min-width:0px)')).toMatch(/min-height: 44px/);
    expect(rulesUnder(button, '(min-width:900px)')).toMatch(/min-height: 38px/);
    // The phone flex is what splits the pair across the row instead of leaving
    // them 10px apart under one thumb.
    expect(rulesUnder(button, '(min-width:0px)')).toMatch(/flex: 1 1 0|flex-grow: 1/);
  });
});

// Red-tell (T3): dropping the transition from `PRIMARY_SX` turns this case red.
// The hover is a `filter`, which the app theme's MuiButton transition does not
// cover, so the primary snapped while the ghost beside it eased.
test('the primary action eases its hover filter', async () => {
  renderCard(row({ status: 'scheduled' }));

  await screen.findByTestId('matchup-side-viewer');
  expect(rulesUnder(screen.getByRole('link', { name: 'Set Lineup' }))).toMatch(
    /filter var\(--transition-fast\)/
  );
});
