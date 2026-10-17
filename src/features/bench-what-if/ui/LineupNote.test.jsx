import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import { LineupNote } from '../index';

const view = (link) => ({
  kind: 'live',
  segments: [{ text: 'FLEX is empty', strong: true }, { text: ' · next kickoff Sun 3:25 PM' }],
  sub: null,
  plain: 'FLEX is empty · next kickoff Sun 3:25 PM',
  danger: false,
  link,
});

describe('LineupNote self link', () => {
  test('by default a fillable slot carries the Set lineup link to the Lineup page', () => {
    renderWithProviders(<LineupNote view={view('lineup')} leagueId={7} />);
    expect(screen.getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/7/lineup');
  });

  test('selfLink={false} drops Set lineup, for the Lineup page itself', () => {
    renderWithProviders(<LineupNote view={view('lineup')} leagueId={7} selfLink={false} />);
    expect(screen.getByTestId('lineup-note')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('selfLink={false} keeps Free agents, which points elsewhere', () => {
    renderWithProviders(<LineupNote view={view('free-agents')} leagueId={7} selfLink={false} />);
    expect(screen.getByRole('link', { name: 'Free agents' })).toHaveAttribute('href', '/league/7/waivers');
  });
});
