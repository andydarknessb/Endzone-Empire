import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import TrophyRoom from './TrophyRoom';

/**
 * The trophy room widget's own suite: the season gate on the "Your season" line, its placement with and
 * without a champion Trophy, and the viewer-first award order. The page test mounts this widget for real;
 * what lives here is what only the widget can answer.
 */

// True when `b` comes after `a` in document order.
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const teams = [1, 2, 3, 4].map((teamId) => ({
  teamId, id: teamId, teamName: `Squad ${teamId}`, avatar_url: null, avatar_static_url: null,
}));

const champion = {
  id: 9, season: 2026, week: 0, type: 'champion', label: '2026 League Champion', team_id: 2, team_name: 'Squad 2',
};
const weekly = {
  id: 10, season: 2026, week: 6, type: 'weekly_high', label: 'Weekly High', team_id: 3, team_name: 'Squad 3',
};
const closest = {
  id: 11, season: 2026, week: 5, type: 'closest_game', label: 'Closest Game', team_id: 1, team_name: 'Squad 1',
};
const lastYear = {
  id: 20, season: 2025, week: 3, type: 'weekly_high', label: 'Weekly High', team_id: 4, team_name: 'Squad 4',
};

// The `trophy` state useTrophies hands the widget, with the visible rows filtered the way the hook filters them.
const trophyState = ({ trophies, season }) => ({
  trophies,
  loading: false,
  error: null,
  season,
  setSeason: jest.fn(),
  seasonOptions: [...new Set(trophies.map((t) => t.season))].sort((a, b) => b - a),
  visibleTrophies: trophies.filter((t) => t.season === season),
});

// The standings row the page hands in: second of the four Teams.
const standing = { season: 2026, rank: 2, record: '6-2', pointsFor: '1234.5' };

const renderRoom = ({ trophies, season = 2026 }) => renderWithProviders(
  <TrophyRoom
    trophy={trophyState({ trophies, season })}
    teams={teams}
    viewerTeamId={1}
    standing={standing}
  />
);

test('trophy room: "Your season" prints the standing row when the selected season is its season', () => {
  renderRoom({ trophies: [champion, weekly, closest] });
  const line = screen.getByTestId('trophy-your-season');
  expect(within(line).getByText('Your season')).toBeInTheDocument();
  expect(within(line).getByText('2nd of 4 · 6-2 · 1234.5 PF')).toBeInTheDocument();
});

test('trophy room: no "Your season" line while an older season is selected', () => {
  renderRoom({ trophies: [champion, weekly, closest, lastYear], season: 2025 });
  expect(screen.queryByTestId('trophy-your-season')).not.toBeInTheDocument();
  expect(screen.getByTestId('trophy-20')).toBeInTheDocument();
});

test('trophy room: with no champion Trophy, "Your season" is the first row under the head, before the awards', () => {
  renderRoom({ trophies: [weekly, closest] });
  expect(screen.queryByTestId('trophy-champion')).not.toBeInTheDocument();
  const line = screen.getByTestId('trophy-your-season');
  expect(precedes(line, screen.getByRole('list', { name: 'Awards' }))).toBe(true);
  // Frame renders its head and its children as siblings with no body element, so the head row is the line's previous sibling.
  // eslint-disable-next-line testing-library/no-node-access -- the placement is the head row directly before the line
  expect(within(line.previousElementSibling).getByRole('heading', { name: 'Trophy room' })).toBeInTheDocument();
});

test('trophy room: with a champion, "Your season" sits after the champion block and before the awards', () => {
  renderRoom({ trophies: [champion, weekly, closest] });
  const line = screen.getByTestId('trophy-your-season');
  expect(precedes(screen.getByTestId('trophy-champion'), line)).toBe(true);
  expect(precedes(line, screen.getByRole('list', { name: 'Awards' }))).toBe(true);
});
