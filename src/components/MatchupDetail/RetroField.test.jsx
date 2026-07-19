import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import RetroField from './RetroField';

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

const renderField = (props = {}) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <RetroField
        homeName="Team A"
        awayName="Team B"
        homeProb={0.5}
        homeStarters={[starter()]}
        awayStarters={[starter({ id: 11, name: 'Away Starter', slot: 'RB' })]}
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
  expect(screen.getByRole('status')).toHaveTextContent('BUF — SACK');
});

test('no banner renders when there is no active play', () => {
  renderField({ activePlay: null });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
