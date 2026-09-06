import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import RecapCard from './RecapCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

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

test('renders the narrative and stat chips when a recap is available', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(
    screen.getByText('The Sunday Ballers exploded for a league-high performance this week.')
  ).toBeInTheDocument();
  expect(screen.getByText('Week 5')).toBeInTheDocument();
  expect(screen.getByText(/High score: Sunday Ballers \(142.5\)/)).toBeInTheDocument();
  expect(screen.getByText(/Bench blunder: Bad Luck FC left 22.1 on the bench/)).toBeInTheDocument();
  expect(screen.getByText(/Waiver steal: Puka Nacua \(Bad Luck FC\) - 28.4 pts/)).toBeInTheDocument();
  expect(screen.getByText(/Closest game: Team A vs Team B \(margin 1\)/)).toBeInTheDocument();
});

// The route's outline was h1, h6, h2, h2, h6 (ADR 0021): this card and the
// Trophy Case were the two literal h6s. It cannot be asserted from
// LeagueDashboardPage.test.jsx, which mocks both components as bare divs, so a
// page-level "no level-6 heading" check passes with or without the fix.
test('renders its heading at level 2', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);

  const card = await screen.findByTestId('recap-card');
  const heading = screen.getByRole('heading', { level: 2, name: 'Weekly Recap' });
  expect(heading).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 6 })).not.toBeInTheDocument();
  // The card is the region that heading names, so the heading is reachable by
  // landmark as well as by outline.
  expect(card).toHaveAttribute('aria-labelledby', heading.id);
});

// Every fact is a whole sentence. Before this the chip label kept MUI's
// `nowrap` and a 70-character fact truncated mid-word at 322px.
test('a fact chip wraps its sentence instead of ellipsising it', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);
  await screen.findByTestId('recap-card');

  const fact = screen.getByText(/Bench blunder: Bad Luck FC left 22.1 on the bench/);
  // eslint-disable-next-line testing-library/no-node-access -- the sx class lands on the chip root, an ancestor Testing Library has no query for
  const chip = fact.closest('.MuiChip-root');
  expect(chip).not.toBeNull();

  // An sx rule is neither laid out nor computed by jsdom, but emotion inserts
  // every rule into `document.styleSheets` under the element's generated class.
  // MUI's own Chip styles declare `nowrap` for the label under that same class,
  // so the override is only real if it is the LAST white-space to land.
  const cls = Array.from(chip.classList).find((c) => c.startsWith('css-'));
  const labelRules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter(
      (rule) =>
        rule.selectorText
        && rule.selectorText.startsWith(`.${cls}`)
        && rule.selectorText.includes('.MuiChip-label')
    )
    .map((rule) => rule.style.cssText)
    .join(';');
  const whiteSpace = labelRules.match(/white-space:\s*([\w-]+)/g);
  expect(whiteSpace).not.toBeNull();
  expect(whiteSpace[whiteSpace.length - 1]).toBe('white-space: normal');
  // `height: auto` on the root is what lets the wrapped lines take vertical
  // space instead of overflowing the chip's fixed 24/32px box.
  const rootRules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => rule.selectorText === `.${cls}`)
    .map((rule) => rule.style.cssText)
    .join(';');
  expect(rootRules).toMatch(/height: auto/);
});

// #916 family: no emoji in product UI. The five recap glyphs are inline stroke
// SVG now, one per fact, each aria-hidden so the sentence carries the meaning.
test('marks each fact with a decorative stroke icon, no emoji', async () => {
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
    const iconCls = Array.from(icon.classList).find((c) => c.startsWith('css-'));
    const iconRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule) => rule.selectorText === `.${iconCls}`)
      .map((rule) => rule.style.cssText)
      .join(';');
    expect(iconRules).toMatch(/width:\s*20px/);
    expect(iconRules).toMatch(/height:\s*20px/);
  });
});

test('renders a biggestBlowout chip when present', async () => {
  apiClient.get.mockResolvedValue(
    recapResponse({
      facts: {
        biggestBlowout: { home: 'Team C', away: 'Team D', homeScore: 150, awayScore: 60, margin: 90 },
      },
    })
  );

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(screen.getByText(/Biggest blowout: Team C vs Team D \(margin 90\)/)).toBeInTheDocument();
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
