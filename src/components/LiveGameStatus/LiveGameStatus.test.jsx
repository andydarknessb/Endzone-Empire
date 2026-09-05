import React from 'react';
import { render, screen } from '@testing-library/react';
import LiveGameStatus from './LiveGameStatus';

// The strip is a pure render of a live_game_states row handed in by the page
// (#885): no hook, no Supabase client, nothing mocked. Red-tell: the strip
// reading realtime itself would need the client mocked here, and it is not.

const row = (overrides = {}) => ({
  tank01_game_id: '20260914_DEN@KC',
  game_status: 'in_progress',
  quarter: 'Q3',
  time_remaining: '8:42',
  home_team: 'KC',
  away_team: 'DEN',
  current_score_home: 17,
  current_score_away: 10,
  ...overrides,
});

test('renders nothing without a state row', () => {
  const { container } = render(<LiveGameStatus state={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('an in-progress game shows its quarter and clock with the score line', () => {
  render(<LiveGameStatus state={row()} />);
  expect(screen.getByText('Q3 8:42')).toBeInTheDocument();
  expect(screen.getByText(/DEN 10 - 17 KC/)).toBeInTheDocument();
});

test('an in-progress game with no clock yet reads LIVE', () => {
  render(<LiveGameStatus state={row({ quarter: null, time_remaining: null })} />);
  expect(screen.getByText('LIVE')).toBeInTheDocument();
});

test('a completed game shows FINAL', () => {
  render(<LiveGameStatus state={row({ game_status: 'final', quarter: 'Final', time_remaining: null, current_score_home: 24, current_score_away: 20 })} />);
  expect(screen.getByText('FINAL')).toBeInTheDocument();
  expect(screen.getByText(/DEN 20 - 24 KC/)).toBeInTheDocument();
});

test('a game before kickoff shows the scheduled label', () => {
  render(<LiveGameStatus state={row({ game_status: 'scheduled', quarter: null, time_remaining: null, current_score_home: 0, current_score_away: 0 })} />);
  expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
});
