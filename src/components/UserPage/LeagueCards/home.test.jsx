import React from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { LeagueLinks } from './League';
import { PickemTile, ScoreTile } from './Tiles';

describe('LeagueLinks', () => {
  test('runs Matchup, Lineup, Picks, Waivers, Dashboard whatever order it is given, and drops the rest', () => {
    renderWithProviders(
      <LeagueLinks
        league="Sunday League"
        links={[
          { label: 'Dashboard', to: '/d' },
          { label: 'Waivers', to: '/w' },
          { label: 'Picks', to: '/p' },
          { label: 'Matchup', to: '/m' },
          { label: 'Lineup', to: '/l' },
          { label: 'Trade', to: '/t' },
        ]}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Sunday League' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Matchup', 'Lineup', 'Picks', 'Waivers', 'Dashboard']);
    expect(within(nav).getByRole('link', { name: 'Sunday League matchup' })).toHaveAttribute('href', '/m');
  });

  test('renders nothing when the league has none of the four', () => {
    renderWithProviders(<LeagueLinks league="X" links={[]} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('ScoreTile', () => {
  const tile = {
    league: 'Sunday League',
    status: 'Q3 · 4:12',
    you: { name: 'You', score: '88.4' },
    opp: { name: 'Gridiron Gang', score: '71.0' },
    youLeads: true,
    margin: '+17.4',
    pct: 80,
    to: '/leagues/1/matchup',
    ariaLabel: 'Sunday League matchup: you 88.4, Gridiron Gang 71.0',
    links: [{ label: 'Lineup', to: '/l' }],
  };

  test('the score block is one link with the whole score as its name', () => {
    renderWithProviders(<ScoreTile {...tile} />);
    const block = screen.getByRole('link', { name: tile.ariaLabel });
    expect(block).toHaveAttribute('href', '/leagues/1/matchup');
    expect(block).not.toHaveClass('scored');
    expect(within(block).getByRole('img', { name: '80% win probability' })).toBeInTheDocument();
  });

  test('scored puts the flash class on the score block', () => {
    renderWithProviders(<ScoreTile {...tile} scored />);
    expect(screen.getByRole('link', { name: tile.ariaLabel })).toHaveClass('scored');
  });
});

describe('PickemTile', () => {
  test('one link for the figure, and the Picks link is not repeated in the foot', () => {
    renderWithProviders(
      <PickemTile
        league="Pick'em League"
        standing="3rd of 12"
        figure="74"
        figureLabel="points"
        note="9 of 14 picked"
        to="/p"
        ariaLabel="Pick'em League picks: 74 points"
        links={[{ label: 'Picks', to: '/p' }, { label: 'Waivers', to: '/w' }]}
      />
    );
    expect(screen.getByRole('link', { name: "Pick'em League picks: 74 points" })).toHaveAttribute('href', '/p');
    expect(screen.getByRole('link', { name: "Pick'em League waivers" })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Pick'em League picks" })).toBeNull();
  });
});
