import React from 'react';
import { render, screen } from '@testing-library/react';
import KickoffWindowGroup from './KickoffWindowGroup';

const view = (gameKey, overrides = {}) => ({
  gameKey,
  teams: ['NYJ', 'TEN'],
  kickoff: '2026-09-20T17:00:00Z',
  lock: false,
  phase: 'open',
  myPick: null,
  confidence: null,
  favorite: null,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
  winner: null,
  isTie: false,
  homeScore: null,
  awayScore: null,
  status: 'scheduled',
  quarter: null,
  timeRemaining: null,
  pickedCount: 0,
  reveal: null,
  outcome: null,
  flagged: false,
  ...overrides,
});

test('labels the window and renders one card per game', () => {
  render(
    <KickoffWindowGroup
      window="sunday-early"
      views={[view('NYJ|TEN'), view('DAL|WAS')]}
      mode="straight"
      totalManagers={10}
    />
  );
  expect(screen.getByText('Sunday Early')).toBeInTheDocument();
  expect(screen.getAllByTestId('game-card')).toHaveLength(2);
});

test('an unrecognized window key falls back to its own raw label', () => {
  render(<KickoffWindowGroup window="some-future-window" views={[]} mode="straight" totalManagers={10} />);
  expect(screen.getByText('some-future-window')).toBeInTheDocument();
});

test('routes a flagged message to the one card it names', () => {
  render(
    <KickoffWindowGroup
      window="sunday-early"
      views={[view('NYJ|TEN', { flagged: true }), view('DAL|WAS')]}
      mode="straight"
      totalManagers={10}
      flaggedMessages={{ 'NYJ|TEN': 'Pick a different number.' }}
    />
  );
  expect(screen.getByTestId('flagged-error')).toHaveTextContent('Pick a different number.');
});
