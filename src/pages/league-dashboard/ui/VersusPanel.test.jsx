import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import VersusPanel from './VersusPanel';

// The model is the matchup-preview widget's (useMatchupPreview), handed in as plain data: the page
// reads it once and gives it to this view, so the view is pinned without a network.
const side = (overrides = {}) => ({
  name: 'Darkness Falls',
  avatarUrl: null,
  avatarStaticUrl: null,
  projected: { loading: false, value: '112.4' },
  score: null,
  expectedFinal: null,
  playersRemaining: null,
  ...overrides,
});

const game = (overrides = {}) => ({
  hasStarted: false,
  chipLabel: 'Scheduled',
  winProbability: null,
  projectedWinProbability: { viewerPct: 61 },
  projectedMargin: 'Projected margin · Darkness Falls by 7.6',
  kickoffLabel: 'Sun 12:00 PM',
  isLive: false,
  settled: false,
  ...overrides,
});

const model = (overrides = {}) => ({
  week: 7,
  status: 'ready',
  busy: false,
  matchupId: 55,
  viewer: side(),
  opponent: side({ name: 'Sunday Scaries', projected: { loading: false, value: '104.8' } }),
  game: game(),
  narrative: null,
  refetch: jest.fn(),
  ...overrides,
});

const live = (overrides = {}) => model({
  viewer: side({
    score: '61.0', expectedFinal: '112.4', playersRemaining: 7,
  }),
  opponent: side({
    name: 'Sunday Scaries', score: '58.9', expectedFinal: '104.8', playersRemaining: 9,
  }),
  game: game({
    hasStarted: true, chipLabel: 'LIVE', isLive: true, projectedWinProbability: null, winProbability: { viewerPct: 64 }, projectedMargin: null, kickoffLabel: null,
  }),
  ...overrides,
});

const renderPanel = (props) => renderWithProviders(<VersusPanel leagueId={1} {...props} />);
// A rerender replaces the whole tree, so the router goes in the element itself.
const panel = (props) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <VersusPanel leagueId={1} {...props} />
  </MemoryRouter>
);

describe('VersusPanel before kickoff', () => {
  test('is a framed versus panel: both names, projected figures under a Proj label, the odds bar and the margin', () => {
    renderPanel({ model: model() });

    const card = screen.getByTestId('matchup-preview');
    expect(within(card).getByRole('heading', { level: 2, name: 'Week 7 Matchup' })).toBeInTheDocument();
    expect(within(card).getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByTestId('matchup-figure-viewer')).toHaveTextContent('112.4');
    expect(screen.getByTestId('matchup-figure-opponent')).toHaveTextContent('104.8');
    expect(within(card).getAllByText('Proj')).toHaveLength(2);
    expect(within(card).getByRole('img', { name: 'Darkness Falls win probability 61%' })).toBeInTheDocument();
    expect(within(card).getByText('Projected margin · Darkness Falls by 7.6')).toBeInTheDocument();
    // The head drops its kickoff line, and the panel is not Board black.
    expect(within(card).queryByText(/Kicks off|Sun 12:00/)).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute('data-state');
  });

  test('the Matchup link is the one way in, named for both teams', () => {
    renderPanel({ model: model() });

    const link = screen.getByRole('link', { name: 'Matchup, Darkness Falls against Sunday Scaries' });
    expect(link).toHaveAttribute('href', '/league/1/matchups/55');
    expect(screen.queryByRole('link', { name: /compare rosters/i })).not.toBeInTheDocument();
  });

  test('the stored narrative reads under the margin', () => {
    renderPanel({ model: model({ narrative: 'Darkness Falls hold the running back edge.' }) });
    expect(screen.getByTestId('matchup-preview-narrative')).toHaveTextContent('Darkness Falls hold the running back edge.');
  });

  test('a projection that is not in yet is a skeleton, and one that cannot be had says so without a digit', () => {
    const { rerender } = render(panel({
      model: model({ busy: true, viewer: side({ projected: { loading: true, value: null } }) }),
    }));
    expect(within(screen.getByTestId('matchup-figure-viewer')).getByTestId('matchup-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('matchup-preview')).toHaveAttribute('aria-busy', 'true');

    rerender(panel({ model: model({ viewer: side({ projected: { loading: false, value: null } }) }) }));
    expect(within(screen.getByTestId('matchup-figure-viewer')).getByText('Not available')).toBeInTheDocument();
    expect(screen.getByTestId('matchup-figure-viewer').textContent).not.toMatch(/\d/);
  });

  test('wears neither the cursor nor a filled action', () => {
    renderPanel({ model: model() });
    const card = screen.getByTestId('matchup-preview');
    // eslint-disable-next-line testing-library/no-node-access
    expect(card.querySelector('.cursor, [data-filled="true"]')).toBeNull();
  });
});

describe('VersusPanel once started', () => {
  test('is the Board-black scoreboard: the leader first, the margin under the viewer\'s score, Expected final and players remaining per side', () => {
    renderPanel({ model: live() });

    const card = screen.getByTestId('matchup-preview');
    expect(card).toHaveAttribute('data-state', 'live');
    expect(within(card).getByText('Live')).toBeInTheDocument();
    expect(screen.getByTestId('matchup-figure-viewer')).toHaveTextContent('61.0');
    expect(screen.getByTestId('matchup-figure-opponent')).toHaveTextContent('58.9');
    expect(within(card).getByText('Up 2.1')).toBeInTheDocument();
    expect(within(card).getByText('7 players remaining')).toBeInTheDocument();
    expect(within(card).getByText('9 players remaining')).toBeInTheDocument();
    expect(within(card).getAllByText('Live score')).toHaveLength(2);
    expect(within(card).getByRole('img', { name: 'Darkness Falls win probability 64%' })).toBeInTheDocument();
  });

  test('the score block is one link whose name states the whole score and spells out PMR', () => {
    renderPanel({ model: live() });

    const link = screen.getByRole('link', {
      name: 'Matchup: Darkness Falls lead Sunday Scaries 61.0 to 58.9, expected final 112.4 to 104.8, 64% Darkness Falls win probability. PMR, players remaining: 7 for Darkness Falls and 9 for Sunday Scaries',
    });
    expect(link).toHaveAttribute('href', '/league/1/matchups/55');
  });

  test('a polite live region carries the score sentence, with the "As of" time when the page has one', () => {
    const asOf = new Date(2026, 9, 18, 14, 40).getTime();
    renderPanel({ model: live(), asOf });

    const region = screen.getByTestId('matchup-live-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Darkness Falls 61.0, Sunday Scaries 58.9, as of 2:40 PM');
    expect(screen.getByTestId('matchup-as-of')).toHaveTextContent('As of 2:40 PM');
  });

  test('without a time the stamp is absent and the sentence has none', () => {
    renderPanel({ model: live() });

    expect(screen.queryByTestId('matchup-as-of')).not.toBeInTheDocument();
    expect(screen.getByTestId('matchup-live-region')).toHaveTextContent(/^Darkness Falls 61\.0, Sunday Scaries 58\.9$/);
  });

  test('a changed score is announced and flashes the score block; at rest the board is flash-free', () => {
    const { rerender } = render(panel({ model: live() }));
    // eslint-disable-next-line testing-library/no-node-access
    const flashed = () => screen.getByTestId('matchup-preview').querySelector('.scored');
    expect(flashed()).toBeNull();

    rerender(panel({ model: live({ viewer: side({ score: '67.0', expectedFinal: '112.4', playersRemaining: 7 }) }) }));
    expect(flashed()).not.toBeNull();
    expect(screen.getByTestId('matchup-live-region')).toHaveTextContent('Darkness Falls 67.0, Sunday Scaries 58.9');
    expect(screen.getByText('Up 8.1')).toBeInTheDocument();
  });

  test('a trailing viewer reads Down and the opponent leads', () => {
    renderPanel({
      model: live({ viewer: side({ score: '40.0', expectedFinal: '99.0', playersRemaining: 7 }) }),
    });

    expect(screen.getByText('Down 18.9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Darkness Falls trail Sunday Scaries 40\.0 to 58\.9/ })).toBeInTheDocument();
  });

  test('a settled matchup is a result: Final, Won by, no live chip, no Expected final or players remaining', () => {
    renderPanel({
      model: live({
        viewer: side({ score: '118.4' }),
        opponent: side({ name: 'Sunday Scaries', score: '96.2' }),
        game: game({
          hasStarted: true, chipLabel: 'Final', isLive: false, settled: true, projectedWinProbability: null, winProbability: null, projectedMargin: null,
        }),
      }),
    });

    const card = screen.getByTestId('matchup-preview');
    expect(card).toHaveAttribute('data-state', 'settled');
    expect(within(card).getByText('Final')).toBeInTheDocument();
    expect(within(card).queryByText('Live')).not.toBeInTheDocument();
    expect(within(card).getByText('Won by 22.2')).toBeInTheDocument();
    expect(within(card).queryByText(/players remaining/)).not.toBeInTheDocument();
    expect(within(card).queryByText('Expected final')).not.toBeInTheDocument();
    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('VersusPanel states', () => {
  test('no matchup this week keeps its frame and says so', () => {
    renderPanel({ model: model({ status: 'empty', week: 7, viewer: null, opponent: null }) });

    expect(screen.getByRole('heading', { level: 2, name: 'Week 7 Matchup' })).toBeInTheDocument();
    expect(screen.getByTestId('matchup-preview-empty')).toHaveTextContent('No matchup this week');
  });

  test('before the season has a week the title is just Matchup', () => {
    renderPanel({ model: model({ status: 'empty', week: null, viewer: null, opponent: null }) });
    expect(screen.getByRole('heading', { level: 2, name: 'Matchup' })).toBeInTheDocument();
  });

  test('loading holds the frame with skeletons and is busy', () => {
    renderPanel({ model: model({ status: 'loading', busy: true, viewer: null, opponent: null }) });

    expect(screen.getByTestId('matchup-preview')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('matchup-skeleton').length).toBeGreaterThan(0);
  });

  test('a failed read is one danger panel with a Try again that re-reads', async () => {
    const refetch = jest.fn();
    renderPanel({ model: model({ status: 'error', refetch, viewer: null, opponent: null }) });

    expect(screen.getByRole('alert')).toHaveTextContent("We could not load this week's matchup right now.");
    await userEvent.click(screen.getByRole('button', { name: 'Try loading the matchup again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
