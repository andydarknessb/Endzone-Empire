import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getByRole('table', { name: 'Available players' })).toBeInTheDocument();
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

  // #142: Best available (CONTEXT.md) admits no-ADP TEs who produced last
  // season — Darren Waller and Dawson Knox were missing from the real pool
  // and unsearchable here because they never reached this `players` prop.
  // Given a serialized draft-pool payload that now includes them, search
  // must still find them (in-memory filtering, no server round trip).
  it('finds a no-ADP player by name once the pool includes them', async () => {
    const withNoAdpTEs = [
      ...PLAYERS,
      {
        playerId: 1310, name: 'Darren Waller', position: 'TE', nflTeam: 'MIA',
        adp: null, positionRank: null, projectedPoints: 76.7, byeWeek: 8, injuryStatus: null,
      },
      {
        playerId: 1342, name: 'Dawson Knox', position: 'TE', nflTeam: 'BUF',
        adp: null, positionRank: null, projectedPoints: 85.7, byeWeek: 7, injuryStatus: null,
      },
    ];
    render(<SimPlayerPool players={withNoAdpTEs} onDraft={jest.fn()} myTurn />);

    await userEvent.type(screen.getByLabelText('Search players'), 'Waller');

    expect(screen.getByRole('button', { name: 'Draft Darren Waller' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft Dawson Knox' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft Jahmyr Gibbs' })).not.toBeInTheDocument();
    // No ADP renders as a dash, not a crash or a fake 0.
    expect(screen.getAllByRole('row')[1].textContent).toMatch(/-/);
  });
});
