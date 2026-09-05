import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { matchupFromDetailBody } from '../../../entities/matchup';
import { ScoreboardStrip } from '../index';

// The strip picks its layout through useMediaQuery (the `md` down query) and
// TeamAvatar reads prefers-reduced-motion through the same hook, so matchMedia
// is mocked the way TeamAvatar.test.jsx does. `mobile` flips only the width
// query; the reduced-motion query always reads "no preference".
let mobile = false;
beforeEach(() => {
  mobile = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: mobile && /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

// The canvas's sample matchup (HERO in build.mjs), built through the entity's
// own detail-body builder so this test reads the model shape, never the wire.
const detail = (overrides = {}) => matchupFromDetailBody({
  matchup: {
    id: 7, season: 2026, week: 3, final: false, status: 'live', home_score: 82.2, away_score: 77.0,
    ...overrides.matchup,
  },
  home: { teamId: 12, name: 'Duluth Dockworkers', expectedFinal: 110.5, playersRemaining: 4, ...overrides.home },
  away: { teamId: 34, name: 'Fargo Frostbite', expectedFinal: 123.9, playersRemaining: 6, ...overrides.away },
});

const homeSide = () => screen.getByTestId('scoreboard-side-home');
const awaySide = () => screen.getByTestId('scoreboard-side-away');
const winBar = () => screen.queryByRole('img', { name: /^Win probability:/ });

test('renders both scores, and each side\'s Expected final and Players remaining', () => {
  render(<ScoreboardStrip matchup={detail()} />);

  expect(screen.getByText('82.2')).toBeInTheDocument();
  expect(screen.getByText('77.0')).toBeInTheDocument();

  const [homeFigures, awayFigures] = screen.getAllByTestId('scoreboard-figures');
  expect(homeFigures).toHaveTextContent(/EF 110\.5/);
  expect(homeFigures).toHaveTextContent(/PMR 4/);
  expect(awayFigures).toHaveTextContent(/EF 123\.9/);
  expect(awayFigures).toHaveTextContent(/PMR 6/);

  // The full captions ride with the abbreviations for a screen reader, and are
  // what the page's own assertions on the retired totals block look for.
  expect(screen.getByText('Projected 110.5')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 4')).toBeInTheDocument();
  expect(screen.getByText('Projected 123.9')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 6')).toBeInTheDocument();
});

test('shows both Team names and an avatar per side', () => {
  render(<ScoreboardStrip matchup={detail()} />);
  expect(within(homeSide()).getByText('Duluth Dockworkers')).toBeInTheDocument();
  expect(within(awaySide()).getByText('Fargo Frostbite')).toBeInTheDocument();
  expect(screen.getAllByTestId('scoreboard-avatar')).toHaveLength(2);
  // Initials fallback: no avatar URL on the detail body.
  expect(within(homeSide()).getByText('DD')).toBeInTheDocument();
  expect(within(awaySide()).getByText('FF')).toBeInTheDocument();
});

test('a started matchup shows the bar with both percentages and the caption', () => {
  render(<ScoreboardStrip matchup={detail()} />);
  expect(screen.getByRole('img', { name: 'Win probability: Duluth Dockworkers 36%, Fargo Frostbite 64%' })).toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-split-bar-home').style.width).toBe('36%');
  expect(screen.getByText('36%')).toBeInTheDocument();
  expect(screen.getByText('64%')).toBeInTheDocument();
  expect(screen.getByText('Win probability')).toBeInTheDocument();
});

test.each(['played', 'final'])('a %s matchup has started, so the bar shows', (status) => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status } })} />);
  expect(winBar()).toBeInTheDocument();
  expect(screen.getByText('36%')).toBeInTheDocument();
});

test('the bar is the one announced image; the percentages and caption are aria-hidden', () => {
  render(<ScoreboardStrip matchup={detail()} />);
  expect(screen.getAllByRole('img', { name: /^Win probability:/ })).toHaveLength(1);
  const percentages = screen.getByTestId('scoreboard-percentages');
  expect(percentages).toHaveAttribute('aria-hidden', 'true');
  expect(percentages).toHaveTextContent('36%');
  expect(percentages).toHaveTextContent('64%');
  expect(screen.getByText('Win probability')).toHaveAttribute('aria-hidden', 'true');
});

test('a scheduled matchup shows no bar and no percentages, with a neutral Scheduled chip', () => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status: 'scheduled' } })} />);
  expect(winBar()).not.toBeInTheDocument();
  expect(screen.queryByText('36%')).not.toBeInTheDocument();
  expect(screen.queryByText('Win probability')).not.toBeInTheDocument();
  const chip = screen.getByTestId('scoreboard-status');
  expect(chip).toHaveTextContent('Scheduled');
  expect(chip).toHaveAttribute('data-variant', 'neutral');
  // Scores and figures still render before kickoff.
  expect(screen.getByText('82.2')).toBeInTheDocument();
  expect(screen.getByText('Projected 110.5')).toBeInTheDocument();
});

// Red-tell: showing the bar for `hasStarted === null` (gating on `!== false`
// instead of `=== true`) turns this case red and no other.
test('a null status shows no chip and no bar', () => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status: null } })} />);
  expect(screen.queryByTestId('scoreboard-status')).not.toBeInTheDocument();
  expect(winBar()).not.toBeInTheDocument();
  expect(screen.queryByText('Win probability')).not.toBeInTheDocument();
  // The scores are still the scores.
  expect(screen.getByText('82.2')).toBeInTheDocument();
  expect(screen.getByText('77.0')).toBeInTheDocument();
});

test('the status chip is the live variant for a live matchup and neutral for a final one', () => {
  const { rerender } = render(<ScoreboardStrip matchup={detail()} />);
  expect(screen.getByTestId('scoreboard-status')).toHaveTextContent('LIVE');
  expect(screen.getByTestId('scoreboard-status')).toHaveAttribute('data-variant', 'live');
  rerender(<ScoreboardStrip matchup={detail({ matchup: { status: 'final' } })} />);
  expect(screen.getByTestId('scoreboard-status')).toHaveTextContent('Final');
  expect(screen.getByTestId('scoreboard-status')).toHaveAttribute('data-variant', 'neutral');
});

test('the You pill marks the viewer\'s side only, and neither side for a spectator', () => {
  const { rerender } = render(<ScoreboardStrip matchup={detail()} viewerTeamId={12} />);
  expect(within(homeSide()).getByText('You')).toBeInTheDocument();
  expect(homeSide()).toHaveAttribute('data-viewer-team', 'true');
  expect(within(awaySide()).queryByText('You')).not.toBeInTheDocument();
  expect(awaySide()).not.toHaveAttribute('data-viewer-team');

  rerender(<ScoreboardStrip matchup={detail()} viewerTeamId={34} />);
  expect(within(awaySide()).getByText('You')).toBeInTheDocument();
  expect(within(homeSide()).queryByText('You')).not.toBeInTheDocument();

  rerender(<ScoreboardStrip matchup={detail()} viewerTeamId={99} />);
  expect(screen.queryByText('You')).not.toBeInTheDocument();
});

test('records render beside each name when the lookup has them, and not otherwise', () => {
  const { rerender } = render(
    <ScoreboardStrip matchup={detail()} records={{ 12: '2-0', 34: '1-1' }} />
  );
  expect(within(homeSide()).getByText('2-0')).toBeInTheDocument();
  expect(within(awaySide()).getByText('1-1')).toBeInTheDocument();

  rerender(<ScoreboardStrip matchup={detail()} />);
  expect(screen.queryByText('2-0')).not.toBeInTheDocument();
  expect(screen.queryByText('1-1')).not.toBeInTheDocument();
});

test('a side with no Expected final or Players remaining shows a dash and says so', () => {
  render(
    <ScoreboardStrip
      matchup={detail({ home: { expectedFinal: null, playersRemaining: null } })}
    />
  );
  const [homeFigures] = screen.getAllByTestId('scoreboard-figures');
  expect(homeFigures).toHaveTextContent(/EF -/);
  expect(homeFigures).toHaveTextContent(/PMR -/);
  expect(screen.getByText('Projected not available')).toBeInTheDocument();
  expect(screen.getByText('Players remaining not available')).toBeInTheDocument();
});

test('is sticky below the app bar by default and static when sticky is false', () => {
  const { rerender } = render(<ScoreboardStrip matchup={detail()} />);
  const strip = screen.getByTestId('scoreboard-strip');
  expect(strip).toHaveAttribute('data-sticky', 'true');
  expect(strip).toHaveStyle({ position: 'sticky', top: '0px' });

  rerender(<ScoreboardStrip matchup={detail()} sticky={false} />);
  expect(screen.getByTestId('scoreboard-strip')).not.toHaveAttribute('data-sticky');
  expect(screen.getByTestId('scoreboard-strip')).not.toHaveStyle({ position: 'sticky' });
});

test('is a labelled Scoreboard region with no heading of its own', () => {
  render(<ScoreboardStrip matchup={detail()} />);
  expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});

test('the mobile layout keeps both names, scores, the bar, the chip, EF and PMR', () => {
  mobile = true;
  render(<ScoreboardStrip matchup={detail()} viewerTeamId={12} records={{ 12: '2-0', 34: '1-1' }} />);
  expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-layout', 'mobile');

  expect(within(homeSide()).getByText('Duluth Dockworkers')).toBeInTheDocument();
  expect(within(homeSide()).getByText('2-0')).toBeInTheDocument();
  expect(within(homeSide()).getByText('You')).toBeInTheDocument();
  expect(within(awaySide()).getByText('Fargo Frostbite')).toBeInTheDocument();
  expect(within(awaySide()).queryByText('You')).not.toBeInTheDocument();

  expect(screen.getByText('82.2')).toBeInTheDocument();
  expect(screen.getByText('77.0')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Win probability: Duluth Dockworkers 36%, Fargo Frostbite 64%' })).toBeInTheDocument();
  expect(screen.getByText('36%')).toBeInTheDocument();
  expect(screen.getByText('64%')).toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-status')).toHaveTextContent('LIVE');

  const [homeFigures, awayFigures] = screen.getAllByTestId('scoreboard-figures');
  expect(homeFigures).toHaveTextContent('EF 110.5 · PMR 4');
  expect(awayFigures).toHaveTextContent('EF 123.9 · PMR 6');
  expect(screen.getByText('Projected 110.5')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 6')).toBeInTheDocument();
});

test('the mobile layout shows no bar for a scheduled matchup and no chip for a null status', () => {
  mobile = true;
  const { rerender } = render(<ScoreboardStrip matchup={detail({ matchup: { status: 'scheduled' } })} />);
  expect(winBar()).not.toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-status')).toHaveTextContent('Scheduled');
  rerender(<ScoreboardStrip matchup={detail({ matchup: { status: null } })} />);
  expect(winBar()).not.toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-status')).not.toBeInTheDocument();
});
