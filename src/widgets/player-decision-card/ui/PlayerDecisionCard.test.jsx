import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import {
  freeAgent, fromCard, myTeam, rostered, waivers,
} from '../model/decisionContext';
import { availabilityEntry, mockCardRoute } from './decisionCardTestFixtures';

/**
 * The card (ADR 0067, spec #2347 ruling 7): the desktop drawer carries no contained or filled button
 * while the phone sheet (modal) carries exactly one, the context's Claim or Add.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

function setViewport(isMobile) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: isMobile,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

beforeEach(() => {
  setViewport(false);
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });
});

afterEach(() => jest.clearAllMocks());

// emotion inserts each sx rule into document.styleSheets under the generated class; read an element's own rules back.
const own = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText && rule.selectorText.startsWith(`.${cls}`)) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

const lineupEntry = (over = {}) => ({
  playerId: 1,
  name: 'Puka Nacua',
  position: 'WR',
  nflTeam: 'LAR',
  slot: 'WR',
  projectedPoints: 0,
  projection: 0,
  floor: 0,
  ceiling: 0,
  points: null,
  injuryStatus: 'O',
  opponent: 'JAX',
  kickoff: '2026-09-14T17:00:00Z',
  gameKey: 'g1',
  eligibleSlots: ['BENCH', 'WR'],
  locked: false,
  spent: false,
  edge: null,
  factorExplanation: null,
  ...over,
});

const bench = lineupEntry({
  playerId: 2, name: 'Jordan Addison', slot: 'BENCH', projectedPoints: 10.1, projection: 10.1, injuryStatus: null,
});

const RICH_CARD = {
  decision: {
    projWeek: { week: 7, points: 0 },
    ros: { points: 188.4, throughWeek: 18 },
    upgrade: { points: 2.4, week: 9, slot: 'WR' },
    volatility: 'steady',
  },
  seasonEnd: 17,
  watching: false,
  news: [{ headline: 'Logged a full practice on Friday.', publishedAt: null }],
  seasons: [
    {
      season: 2026, games: 6, points: 127, pointsPerGame: 21.2, posRank: null, posRankOf: null, adp: 7.4,
      weeks: [
        { week: 4, kind: 'actual', points: 13.4 },
        { week: 7, kind: 'unavailable', reason: 'out' },
        { week: 8, kind: 'bye' },
        { week: 9, kind: 'projected', points: 19.1 },
      ],
      log: [{ week: 4, opponent: 'IND', statLine: { recYds: 74 }, points: 13.4 }],
    },
    {
      season: 2025, games: 17, points: 316.4, pointsPerGame: 18.6, posRank: 6, posRankOf: 88, adp: 9.4, weeks: [], log: [],
    },
  ],
};

const usageCard = {
  ...RICH_CARD,
  decision: {
    ...RICH_CARD.decision,
    usage: {
      weeks: [{ season: 2026, week: 6, targets: 10, carries: 0, airYards: 92, snaps: 62, snapShare: 0.93, targetShare: 0.3, fantasyPoints: 24.2 }],
      seasonAverage: { targets: 10.5, carries: 0.2, airYards: 90.7, snaps: 60.7, snapShare: 0.91, targetShare: 0.31, fantasyPoints: 21.2 },
    },
  },
};

function renderCard({ context, entry = lineupEntry(), onClose = jest.fn() }) {
  return renderWithProviders(
    <PlayerDecisionCard
      open
      onClose={onClose}
      entry={entry}
      leagueId={1}
      week={7}
      context={context}
    />
  );
}

const lineupContext = () => myTeam({
  managed: true,
  onSwap: jest.fn(),
  onRequestDrop: jest.fn(),
  canDropEntry: () => true,
  entries: [lineupEntry(), bench],
});

const buttonsIn = (root) => within(root).getAllByRole('button');
const isFilled = (el) => el.getAttribute('data-variant') === 'fill' || el.classList.contains('MuiButton-contained');

describe('desktop drawer', () => {
  test('is a primary frame on playselect tokens with the name in Archivo, not pixel type', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');

    expect(dialog).toHaveAttribute('data-variant', 'drawer');
    expect(dialog).toHaveClass('ps-root');
    expect(own(dialog)).toMatch(/6px double var\(--ps-frame\)/);
    const name = screen.getByRole('heading', { name: 'Puka Nacua', level: 2 });
    expect(own(name)).toMatch(/font-size: 24px/);
    expect(own(name)).not.toMatch(/Press Start/);
    // A section head is pixel type at 16px, inside a tertiary frame.
    const head = await screen.findByRole('heading', { name: 'Decision strip' });
    expect(own(head)).toMatch(/Press Start 2P/);
    expect(own(head)).toMatch(/font-size: 16px/);
  });

  test('carries no contained or filled button, and its actions are ghost', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');
    await screen.findByTestId('decision-strip');

    const row = screen.getByRole('group', { name: 'Player actions' });
    ['Bench', 'Compare', 'Trade', 'Drop', 'Watch'].forEach((name) => {
      expect(within(row).getByRole(name === 'Trade' ? 'link' : 'button', { name })).toHaveAttribute('data-variant', 'ghost');
    });
    expect(buttonsIn(dialog).filter(isFilled)).toHaveLength(0);
    expect(within(dialog).queryAllByRole('button').every((b) => !b.classList.contains('MuiButton-contained'))).toBe(true);
  });

  test('prints no legacy token anywhere inside the drawer', async () => {
    mockCardRoute({ ...usageCard });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');
    await screen.findByTestId('weekly-points-bars');
    await screen.findByTestId('decision-card-usage-table');

    // eslint-disable-next-line testing-library/no-node-access -- every element's own rules are the point
    const all = [dialog, ...Array.from(dialog.querySelectorAll('*'))].map(own).join(';');
    expect(all).toMatch(/--ps-/);
    expect(all).not.toMatch(/--dash-|--text-muted|--success|--warning|--accent\b|--border-/);
  });

  test('keeps the test ids and names the existing suites and e2e read', async () => {
    mockCardRoute({ ...usageCard });
    renderCard({ context: lineupContext() });
    await screen.findByTestId('decision-card');

    expect(await screen.findByRole('table', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByTestId('decision-card-usage-table')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Weekly points, actual and projected' })).toBeInTheDocument();
    expect(screen.getByTestId('weekly-bar-4-fill')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-bar-8-bye')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-bar-7-unavailable')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Week 7: out' })).toBeInTheDocument();
    expect(screen.getByTestId('decision-strip-upgrade-pill')).toHaveTextContent('+2.4 Wk 9');
    expect(screen.getByTestId('decision-card-range-bar')).toHaveAttribute('role', 'img');
    expect(screen.getByRole('heading', { name: 'Bench options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap in Jordan Addison' })).toHaveAttribute('data-variant', 'ghost');
    // The season sections sit on their own tabs (#2489).
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(await screen.findByRole('table', { name: 'Season totals' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    expect(screen.getByRole('table', { name: 'Game log' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Season' })).toBeInTheDocument();
  });

  test('the header is a Play-blue band, its name in Play ink and its team in Play dim', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const name = await screen.findByRole('heading', { name: 'Puka Nacua', level: 2 });
    // eslint-disable-next-line testing-library/no-node-access -- the band is the name's header container
    const band = name.parentElement.parentElement.parentElement;
    expect(own(band)).toMatch(/background-color: var\(--ps-play\)/);
    expect(own(name)).toMatch(/color: var\(--ps-play-ink\)/);
  });

  test('the injury tag is the code, with the word for a screen reader', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');
    expect(within(dialog).getByText('Injury status: Out')).toBeInTheDocument();
    expect(within(dialog).getByText('OUT')).toBeInTheDocument();
  });

  test('the header avatar is a neutral square, not the jersey colour', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    await screen.findByTestId('decision-card');
    const initials = screen.getByText('PN');
    expect(initials).toHaveClass('MuiAvatar-square');
    expect(own(initials)).not.toMatch(/background-color: #|--pos-/);
  });

  test('a rostered open is "Propose trade", "Rostered by {team}" and the Play-blue Watching toggle in one row', async () => {
    mockCardRoute({ ...RICH_CARD, watching: true });
    renderCard({
     
      entry: availabilityEntry({ name: 'Patrick Mahomes', position: 'QB', slot: 'QB', nflTeam: 'KC' }),
      context: rostered({ availability: { teamName: 'Sunday Scaries' } }),
    });
    const row = await screen.findByRole('group', { name: 'Player actions' });

    expect(within(row).getByRole('link', { name: 'Propose trade' })).toHaveAttribute('data-variant', 'ghost');
    expect(within(row).getByText('Rostered by Sunday Scaries')).toBeInTheDocument();
    const watching = await within(row).findByRole('button', { name: 'Watching' });
    expect(watching).toHaveAttribute('data-variant', 'selected');
    expect(buttonsIn(screen.getByTestId('decision-card')).filter(isFilled)).toHaveLength(0);
  });

  test('the waivers Claim and the free-agent Add are ghost in the drawer', async () => {
    mockCardRoute({ ...RICH_CARD });
    const { unmount } = renderCard({
     
      entry: availabilityEntry(),
      context: waivers({ availability: { waiverPriority: 3 }, roster: [] }),
    });
    expect(await screen.findByTestId('claim-player-submit')).toHaveAttribute('data-variant', 'ghost');
    expect(buttonsIn(screen.getByTestId('decision-card')).filter(isFilled)).toHaveLength(0);
    unmount();

    renderCard({
     
      entry: availabilityEntry(),
      context: freeAgent({ availability: { rosterCount: 10, rosterCapacity: 16 }, roster: [] }),
    });
    expect(await screen.findByTestId('add-player-submit')).toHaveAttribute('data-variant', 'ghost');
    expect(buttonsIn(screen.getByTestId('decision-card')).filter(isFilled)).toHaveLength(0);
  });

  test('the load error is the house copy on a Danger edge, and its alert holds no button', async () => {
    apiClient.get.mockRejectedValue(new Error('boom'));
    renderCard({ context: fromCard(), entry: { playerId: 7, name: 'Jaylen Warren' } });
    const alert = await screen.findByTestId('decision-card-load-error');

    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent("We could not load this player's details.");
    expect(own(alert)).toMatch(/--ps-danger/);
    expect(within(alert).queryAllByRole('button')).toHaveLength(0);
  });

  test('the counter is a text-only live region, and prev and next are 44px square buttons', async () => {
    mockCardRoute({ ...RICH_CARD });
    const onNavigate = jest.fn();
    renderCard({
     
      context: myTeam({
        managed: true,
        onSwap: jest.fn(),
        onRequestDrop: jest.fn(),
        canDropEntry: () => true,
        entries: [lineupEntry()],
        playerIds: [5, 1, 9],
        onNavigate,
      }),
    });
    const counter = await screen.findByRole('status', { name: 'Player 2 of 3' });
    expect(within(counter).queryAllByRole('button')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Next player' }));
    expect(onNavigate).toHaveBeenCalledWith(9);
    expect(own(screen.getByRole('button', { name: 'Previous player' }))).toMatch(/width: 44px/);
  });
});

describe('phone sheet', () => {
  beforeEach(() => setViewport(true));

  test('the waivers sheet carries exactly one filled button, the Claim, and a square frame with no bottom edge', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({
     
      entry: availabilityEntry({ name: 'Michael Wilson', position: 'WR', slot: 'WR', nflTeam: 'ARI' }),
      context: waivers({ availability: { waiverPriority: 5 }, roster: [] }),
    });
    const dialog = await screen.findByTestId('decision-card');
    await screen.findByTestId('decision-strip');

    expect(dialog).toHaveAttribute('data-variant', 'sheet');
    expect(own(dialog)).toMatch(/border-bottom: 0/);
    const filled = buttonsIn(dialog).filter(isFilled);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveAttribute('data-testid', 'claim-player-submit');
    // The Watch toggle under the claim bar is a ghost, never the green fill.
    expect(screen.getByRole('button', { name: 'Watch' })).toHaveAttribute('data-variant', 'ghost');
    expect(screen.getByRole('heading', { name: 'News' })).toBeInTheDocument();
  });

  test('the free-agent sheet carries exactly one filled button, the Add', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({
     
      entry: availabilityEntry(),
      context: freeAgent({ availability: { rosterCount: 10, rosterCapacity: 16 }, roster: [] }),
    });
    const dialog = await screen.findByTestId('decision-card');
    const filled = buttonsIn(dialog).filter(isFilled);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveAttribute('data-testid', 'add-player-submit');
  });

  test('the lineup sheet has no filled button at all', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');
    await screen.findByTestId('decision-strip');
    expect(buttonsIn(dialog).filter(isFilled)).toHaveLength(0);
  });
});

describe('compare', () => {
  test('two panels of tertiary frames, and Clear compare is a 44px icon button', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({
     
      context: myTeam({
        managed: true,
        onSwap: jest.fn(),
        onRequestDrop: jest.fn(),
        canDropEntry: () => true,
        entries: [lineupEntry(), bench],
        compareWith: 2,
      }),
    });
    const compare = await screen.findByTestId('decision-card-compare');
    const panel = within(compare).getByTestId('decision-card-compare-panel-2');

    expect(within(panel).getByRole('heading', { name: 'Jordan Addison', level: 3 })).toBeInTheDocument();
    expect(within(compare).getByTestId('decision-card-compare-panel-1')).toBeInTheDocument();
    expect(own(within(panel).getByRole('button', { name: 'Clear compare' }))).toMatch(/width: 44px/);
    expect(buttonsIn(screen.getByTestId('decision-card')).filter(isFilled)).toHaveLength(0);
  });
});

describe('type', () => {
  test('body lines take the page font (Archivo), not the theme font MUI Typography would apply', async () => {
    mockCardRoute({ ...RICH_CARD });
    renderCard({ context: lineupContext() });
    const dialog = await screen.findByTestId('decision-card');
    const opponent = await screen.findByTestId('decision-card-opponent');

    // The paper sets Archivo and each body line inherits it; MUI's own Typography rule is reset to inherit.
    expect(own(dialog)).toMatch(/Archivo/);
    expect(own(opponent)).toMatch(/font-family: inherit/);
    expect(getComputedStyle(opponent).fontFamily).toMatch(/Archivo|inherit/);
  });
});
