import React from 'react';
import { render, screen, within, act } from '@testing-library/react';
import { matchupFromDetailBody } from '../../../entities/matchup';
import { ScoreboardStrip } from '../index';

// The strip picks its single layout through useMediaQuery (the `sm` down query), and the team mark
// reads prefers-reduced-motion through the same hook, so matchMedia is mocked. `mobile` flips only the
// width query; the reduced-motion query always reads "no preference".
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
const odds = () => screen.queryByRole('img', { name: /win probability$/ });

test('the live screen is Board black and prints both scores, each side\'s Expected final and players remaining on separate lines', () => {
  render(<ScoreboardStrip matchup={detail()} />);

  expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'live');
  expect(within(homeSide()).getByTestId('scoreboard-score')).toHaveTextContent('82.2');
  expect(within(awaySide()).getByTestId('scoreboard-score')).toHaveTextContent('77.0');
  expect(within(homeSide()).getByTestId('scoreboard-figure-ef')).toHaveTextContent('Expected final 110.5');
  expect(within(homeSide()).getByTestId('scoreboard-figure-pmr')).toHaveTextContent('4 players remaining');
  expect(within(awaySide()).getByTestId('scoreboard-figure-ef')).toHaveTextContent('Expected final 123.9');
  expect(within(awaySide()).getByTestId('scoreboard-figure-pmr')).toHaveTextContent('6 players remaining');
  // The visible text never says PMR.
  expect(screen.getByTestId('scoreboard-strip')).not.toHaveTextContent(/PMR|to play/);
  expect(screen.getByTestId('scoreboard-margin')).toHaveTextContent('Duluth Dockworkers by 5.2');
});

test('a hidden h2 comes before the team-name h3s, and the team names are the h3s', () => {
  render(<ScoreboardStrip matchup={detail()} />);

  const heading = screen.getByRole('heading', { level: 2, name: 'Week 3 scoreboard' });
  const names = screen.getAllByRole('heading', { level: 3 });
  expect(names.map((h) => h.textContent)).toEqual(['Duluth Dockworkers', 'Fargo Frostbite']);
  expect(heading.compareDocumentPosition(names[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Week 3 scoreboard' })).toBe(screen.getByTestId('scoreboard-strip'));
});

test('the odds are one two-sided image naming both teams, with one Forecast credit, and the percentages sum to 100', () => {
  render(<ScoreboardStrip matchup={detail()} />);

  const image = screen.getByRole('img', { name: 'Duluth Dockworkers 36%, Fargo Frostbite 64% win probability' });
  expect(odds()).toBe(image);
  expect(screen.getAllByText('Endzone Forecast')).toHaveLength(1);
  expect(screen.getByText(/^Win probability/)).toBeInTheDocument();
});

test('the live region carries the score sentence only, and its text moves only when a score does', () => {
  const { rerender } = render(<ScoreboardStrip matchup={detail()} />);
  const region = screen.getByTestId('scoreboard-live-region');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('Duluth Dockworkers 82.2, Fargo Frostbite 77.0');
  expect(region).not.toHaveTextContent(/as of|remaining|Expected/i);

  // A new Expected final alone changes nothing the region says.
  rerender(<ScoreboardStrip matchup={detail({ home: { expectedFinal: 99 } })} />);
  expect(screen.getByTestId('scoreboard-live-region')).toHaveTextContent('Duluth Dockworkers 82.2, Fargo Frostbite 77.0');

  rerender(<ScoreboardStrip matchup={detail({ matchup: { home_score: 90 } })} />);
  expect(screen.getByTestId('scoreboard-live-region')).toHaveTextContent('Duluth Dockworkers 90.0, Fargo Frostbite 77.0');
});

test('before kickoff it is the framed panel: Proj figures, starters set to play, the projected margin, an Ink bar and no live region', () => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status: 'scheduled', home_score: 0, away_score: 0 } })} />);

  expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'scheduled');
  expect(screen.getByRole('heading', { level: 2, name: 'Week 3 scoreboard, projected' })).toBeInTheDocument();
  expect(within(homeSide()).getByText('Proj')).toBeInTheDocument();
  expect(within(homeSide()).getByTestId('scoreboard-score')).toHaveTextContent('110.5');
  expect(within(awaySide()).getByTestId('scoreboard-score')).toHaveTextContent('123.9');
  expect(within(homeSide()).getByTestId('scoreboard-figure-pmr')).toHaveTextContent('4 starters set to play');
  expect(within(homeSide()).queryByTestId('scoreboard-figure-ef')).not.toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-margin')).toHaveTextContent('Projected margin · Fargo Frostbite by 13.4');
  expect(odds()).toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-live-region')).not.toBeInTheDocument();
  expect(screen.queryByText(/Live score/)).not.toBeInTheDocument();
});

test('a single starter reads in the singular', () => {
  render(<ScoreboardStrip matchup={detail({ home: { playersRemaining: 1 } })} />);
  expect(within(homeSide()).getByTestId('scoreboard-figure-pmr')).toHaveTextContent('1 player remaining');
});

test.each(['played', 'final'])('a %s matchup states the result in place of the bar and the figures', (status) => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status, final: status === 'final', home_score: 115.9, away_score: 109.7 } })} viewerTeamId={12} />);

  expect(screen.getByTestId('scoreboard-result')).toHaveTextContent(status === 'final' ? 'You won by 6.2' : 'Unofficial: You won by 6.2');
  expect(odds()).not.toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-figures')).not.toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-margin')).not.toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-live-region')).not.toBeInTheDocument();
  expect(screen.queryByText(/Endzone Forecast/)).not.toBeInTheDocument();
});

test('a null status draws no bar and no result', () => {
  render(<ScoreboardStrip matchup={detail({ matchup: { status: null } })} />);
  expect(odds()).not.toBeInTheDocument();
  expect(screen.queryByTestId('scoreboard-result')).not.toBeInTheDocument();
});

test('the viewer side wears the You tag and a record under the name when the page passes one', () => {
  render(<ScoreboardStrip matchup={detail()} viewerTeamId={34} records={{ 12: '2-0', 34: '1-1' }} />);

  expect(awaySide()).toHaveAttribute('data-viewer-team', 'true');
  expect(within(awaySide()).getByText('You')).toBeInTheDocument();
  expect(within(homeSide()).queryByText('You')).not.toBeInTheDocument();
  expect(homeSide()).toHaveTextContent('2-0');
  expect(awaySide()).toHaveTextContent('1-1');
});

test('on a phone the figures sit under the margin in the two halves, and the You tag sits beside the record', () => {
  mobile = true;
  render(<ScoreboardStrip matchup={detail()} viewerTeamId={12} />);

  expect(screen.queryByTestId('scoreboard-figures')).not.toBeInTheDocument();
  const [home, away] = screen.getAllByTestId('scoreboard-figures-phone');
  expect(home).toHaveTextContent('Expected final 110.5');
  expect(home).toHaveTextContent('4 players remaining');
  expect(away).toHaveTextContent('6 players remaining');
  expect(within(homeSide()).getByText('You')).toBeInTheDocument();
});

describe('the compact bar', () => {
  let observed;
  beforeEach(() => {
    observed = null;
    window.IntersectionObserver = jest.fn((callback) => {
      observed = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
  });
  afterEach(() => { delete window.IntersectionObserver; });

  test('stays hidden while the panel is in view, pins as a labelled 56px group once it has scrolled out, and goes again on return', () => {
    render(<ScoreboardStrip matchup={detail()} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByTestId('scoreboard-sticky')).toBeInTheDocument();

    act(() => { observed([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]); });
    const bar = screen.getByRole('group', { name: 'Duluth Dockworkers 82.2, Fargo Frostbite 77.0, Duluth Dockworkers by 5.2' });
    expect(bar).toHaveTextContent('DD 82.2 · FF 77.0');
    expect(bar).toHaveTextContent('Live');

    act(() => { observed([{ isIntersecting: true, boundingClientRect: { bottom: 400 } }]); });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  test('a panel that is below the viewport (not scrolled past) does not pin it', () => {
    render(<ScoreboardStrip matchup={detail()} />);
    act(() => { observed([{ isIntersecting: false, boundingClientRect: { bottom: 1600 } }]); });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  test('sticky={false} renders no anchor at all', () => {
    render(<ScoreboardStrip matchup={detail()} sticky={false} />);
    expect(screen.queryByTestId('scoreboard-sticky')).not.toBeInTheDocument();
    expect(window.IntersectionObserver).not.toHaveBeenCalled();
  });

  test('before kickoff the bar reads the Proj figures', () => {
    render(<ScoreboardStrip matchup={detail({ matchup: { status: 'scheduled' } })} />);
    act(() => { observed([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]); });
    expect(screen.getByRole('group')).toHaveTextContent('DD 110.5 · FF 123.9');
  });
});

describe('the viewer\'s side comes first', () => {
  const sideOrder = () => screen.getAllByTestId(/^scoreboard-side-/).map((el) => el.getAttribute('data-testid'));

  test('as the away team he is the left column, and the names follow that order', () => {
    render(<ScoreboardStrip matchup={detail()} viewerTeamId={34} />);

    expect(sideOrder()).toEqual(['scoreboard-side-away', 'scoreboard-side-home']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Fargo Frostbite', 'Duluth Dockworkers']);
    expect(screen.getAllByTestId('scoreboard-score').map((el) => el.textContent)).toEqual(['77.0', '82.2']);
    expect(screen.getByTestId('scoreboard-live-region')).toHaveTextContent('Fargo Frostbite 77.0, Duluth Dockworkers 82.2');
    // His own win probability leads the image: Fargo 64%.
    expect(screen.getByRole('img', { name: 'Fargo Frostbite 64%, Duluth Dockworkers 36% win probability' })).toBeInTheDocument();
    // The margin names the leader whichever column he is in.
    expect(screen.getByTestId('scoreboard-margin')).toHaveTextContent('Duluth Dockworkers by 5.2');
  });

  test('the compact bar reads in the same order', () => {
    window.IntersectionObserver = jest.fn((callback) => {
      window.__strip = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
    render(<ScoreboardStrip matchup={detail()} viewerTeamId={34} />);
    act(() => { window.__strip([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]); });

    expect(screen.getByRole('group', { name: 'Fargo Frostbite 77.0, Duluth Dockworkers 82.2, Duluth Dockworkers by 5.2' })).toHaveTextContent('FF 77.0 · DD 82.2');
    delete window.IntersectionObserver;
    delete window.__strip;
  });

  test('a participant as home, and a non-participant, see home on the left', () => {
    const { rerender } = render(<ScoreboardStrip matchup={detail()} viewerTeamId={12} />);
    expect(sideOrder()).toEqual(['scoreboard-side-home', 'scoreboard-side-away']);
    rerender(<ScoreboardStrip matchup={detail()} />);
    expect(sideOrder()).toEqual(['scoreboard-side-home', 'scoreboard-side-away']);
  });
});
