import React from 'react';
import { render, screen } from '@testing-library/react';
import SimPlayerPool from './SimPlayerPool';

// useMediaQuery(theme.breakpoints.down('md')) reads matchMedia; flip `matches`
// to simulate the phone layout (the TeamAvatar.test.jsx convention).
let matchMediaMatches = false;
beforeEach(() => {
  matchMediaMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

const PLAYERS = [
  {
    playerId: 1, name: 'Jahmyr Gibbs', position: 'RB', nflTeam: 'DET',
    adp: 1.5, positionRank: 1, projectedPoints: 328.4, byeWeek: 6, injuryStatus: null,
  },
  {
    playerId: 2, name: 'Puka Nacua', position: 'WR', nflTeam: 'LAR',
    adp: 2.9, positionRank: 1, projectedPoints: 290.1, byeWeek: 11, injuryStatus: null,
  },
];

describe('SimPlayerPool', () => {
  it('renders the stats table on desktop', () => {
    render(<SimPlayerPool players={PLAYERS} onDraft={jest.fn()} myTurn />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft Jahmyr Gibbs' })).toBeEnabled();
  });

  it('renders cards with a visible Draft button per player on mobile', () => {
    matchMediaMatches = true;
    render(<SimPlayerPool players={PLAYERS} onDraft={jest.fn()} myTurn />);
    // No table on the phone — the Draft action must not live in a scrolled-away column.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft Jahmyr Gibbs' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Draft Puka Nacua' })).toBeEnabled();
    // The card keeps the stats the table columns carried.
    expect(screen.getByText(/Bye 6 · ADP 1\.5 · RB1 · Proj 328\.4/)).toBeInTheDocument();
  });

  it('disables Draft buttons when it is not your turn (both layouts)', () => {
    matchMediaMatches = true;
    render(<SimPlayerPool players={PLAYERS} onDraft={jest.fn()} myTurn={false} />);
    expect(screen.getByRole('button', { name: 'Draft Jahmyr Gibbs' })).toBeDisabled();
  });
});
