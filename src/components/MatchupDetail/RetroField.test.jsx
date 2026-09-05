import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import RetroField from './RetroField';

// prefers-reduced-motion is read through useMediaQuery; mock matchMedia the same
// way TeamAvatar.test.jsx does, defaulting to "no preference" so the existing
// tests keep exercising the ordinary (animated) path.
let matchMediaMatches = false;
beforeEach(() => {
  matchMediaMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

const bench = (overrides = {}) => ({
  id: 1,
  name: 'Bench Guy',
  position: 'RB',
  points: 4.2,
  ...overrides,
});

const starter = (overrides = {}) => ({
  id: 10,
  name: 'Starter Guy',
  slot: 'QB',
  points: 12.5,
  projected: 18.2,
  ...overrides,
});

// Pre-paired starter rows as the Matchup entity hands them to the field.
const defaultRows = [
  { slot: 'QB', home: starter(), away: null },
  { slot: 'RB', home: null, away: starter({ id: 11, name: 'Away Starter', slot: 'RB' }) },
];

const renderField = (props = {}) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <RetroField
        homeName="Team A"
        awayName="Team B"
        homeProb={0.5}
        starterRows={defaultRows}
        homeBench={[bench()]}
        awayBench={[bench({ id: 2, name: 'Visitor Reserve' })]}
        activePlay={null}
        {...props}
      />
    </ThemeProvider>
  );

test('reflects live win probability in the field aria-label', () => {
  renderField({ homeProb: 0.73 });
  expect(
    screen.getByRole('img', { name: 'Field position: Team A 73% likely to win' })
  ).toBeInTheDocument();
});

test('renders each side\'s fantasy team name in its endzone', () => {
  renderField();
  expect(screen.getAllByText('TEAM A').length).toBeGreaterThan(0);
  expect(screen.getAllByText('TEAM B').length).toBeGreaterThan(0);
});

test('shows the full starting lineup for both teams', () => {
  renderField();
  expect(screen.getByText('Starting Lineups')).toBeInTheDocument();
  expect(screen.getByText('Starter Guy')).toBeInTheDocument();
  expect(screen.getByText('Away Starter')).toBeInTheDocument();
});

test('benches are hidden by default and toggle open/closed', async () => {
  renderField();

  expect(screen.queryByText('Bench Guy')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Show Benches' }));
  expect(screen.getByText(/Bench Guy/)).toBeInTheDocument();
  expect(screen.getByText(/Visitor Reserve/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Hide Benches' }));
  expect(screen.queryByText('Bench Guy')).not.toBeInTheDocument();
});

test('shows an empty state for a team with no bench players', async () => {
  renderField({ awayBench: [] });

  await userEvent.click(screen.getByRole('button', { name: 'Show Benches' }));
  expect(screen.getByText('No bench players.')).toBeInTheDocument();
});

test('renders without crashing when a touchdown play is active', () => {
  renderField({ activePlay: { side: 'home', type: 'rushing', isTouchdown: true, nflTeam: 'KC', opponent: 'BUF' } });
  expect(screen.getByRole('img', { name: /Field position/ })).toBeInTheDocument();
});

test('flashes a plain-English banner for a non-touchdown moment play', () => {
  renderField({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
  expect(screen.getByRole('status')).toHaveTextContent('BUF · SACK');
});

test('no banner renders when there is no active play', () => {
  renderField({ activePlay: null });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('under reduced motion the moment banner is still rendered (not gated out by the preference)', () => {
  // NOTE: the actual defect is a COMPUTED-OPACITY one - `flashIn` ends at
  // opacity 0 held by `forwards`, and the global policy collapsing its duration
  // to 0s pins it there. jsdom cannot resolve emotion-applied computed styles
  // (animationName reads '' in both modes), so the visible/invisible distinction
  // can only be asserted in a real browser, and RetroField has no e2e harness.
  // What jsdom CAN guard is that the reduced-motion path does not simply drop
  // the banner from the DOM (a tempting but wrong "fix"): the content is present
  // and announced, and the dismissal test below proves the reduced path is the
  // one running.
  matchMediaMatches = true;
  renderField({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
  expect(screen.getByRole('status')).toHaveTextContent('BUF · SACK');
});

test('under reduced motion the moment banner dismisses on its own after the flash window', () => {
  jest.useFakeTimers();
  try {
    matchMediaMatches = true;
    renderField({ activePlay: { side: 'away', type: 'sack', isTouchdown: false, nflTeam: 'BUF', opponent: 'KC' } });
    // The animation would normally reveal AND dismiss it; with the animation
    // gone, a timer takes it down over the same window so it still auto-clears.
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1800); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
