import React from 'react';
import { render, screen } from '@testing-library/react';
import LiveGameStatus from './LiveGameStatus';
import useLiveGameRealtime from '../../hooks/useLiveGameRealtime';

jest.mock('../../hooks/useLiveGameRealtime');

test('renders a loading skeleton', () => {
  useLiveGameRealtime.mockReturnValue({ state: null, loading: true, error: null });
  const { container } = render(<LiveGameStatus gameId="x" />);
  expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
});

test('renders an error alert', () => {
  useLiveGameRealtime.mockReturnValue({ state: null, loading: false, error: 'boom' });
  render(<LiveGameStatus gameId="x" />);
  expect(screen.getByText('boom')).toBeInTheDocument();
});

test('renders nothing when there is no state and no error', () => {
  useLiveGameRealtime.mockReturnValue({ state: null, loading: false, error: null });
  const { container } = render(<LiveGameStatus gameId="x" />);
  expect(container).toBeEmptyDOMElement();
});

test('renders the live chip with quarter/clock and the score line', () => {
  useLiveGameRealtime.mockReturnValue({
    state: {
      game_status: 'in_progress',
      quarter: 'Q3',
      time_remaining: '8:42',
      home_team: 'KC',
      away_team: 'DEN',
      current_score_home: 17,
      current_score_away: 10,
    },
    loading: false,
    error: null,
  });
  render(<LiveGameStatus gameId="x" />);
  expect(screen.getByText('Q3 8:42')).toBeInTheDocument();
  expect(screen.getByText(/DEN 10 — 17 KC/)).toBeInTheDocument();
});

test('renders a FINAL chip for a completed game', () => {
  useLiveGameRealtime.mockReturnValue({
    state: {
      game_status: 'final',
      quarter: 'Final',
      time_remaining: null,
      home_team: 'KC',
      away_team: 'DEN',
      current_score_home: 24,
      current_score_away: 20,
    },
    loading: false,
    error: null,
  });
  render(<LiveGameStatus gameId="x" />);
  expect(screen.getByText('FINAL')).toBeInTheDocument();
});

test('renders a SCHEDULED chip before kickoff', () => {
  useLiveGameRealtime.mockReturnValue({
    state: {
      game_status: 'scheduled',
      quarter: null,
      time_remaining: null,
      home_team: 'KC',
      away_team: 'DEN',
      current_score_home: 0,
      current_score_away: 0,
    },
    loading: false,
    error: null,
  });
  render(<LiveGameStatus gameId="x" />);
  expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
});
