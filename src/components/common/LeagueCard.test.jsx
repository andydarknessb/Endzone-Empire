import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LeagueCard from './LeagueCard';

const league = {
  id: 7,
  name: 'Sunday Ballers',
  my_team_name: 'Gridiron Guild',
  draft_status: 'pending',
  team_count: 8,
  max_teams: 10,
};

test('renders the same league identity and phase in compact and management variants', () => {
  const { unmount } = renderWithProviders(<LeagueCard league={league} compact />);
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('Team: Gridiron Guild')).toBeInTheDocument();
  expect(screen.getByText('Pre-draft')).toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers').closest('a')).toHaveAttribute('href', '/league/7');

  unmount();
  renderWithProviders(<LeagueCard league={{ ...league, draft_status: 'complete', season_status: 'playoffs' }} />);
  expect(screen.getByText('Playoffs')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/7/game-center');
});

test('requires confirmation before deleting a league', async () => {
  const onDelete = jest.fn();
  renderWithProviders(<LeagueCard league={league} isOwner onDelete={onDelete} />);

  await userEvent.click(screen.getByRole('button', { name: 'League actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete Sunday Ballers?');
  expect(onDelete).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete League' }));
  expect(onDelete).toHaveBeenCalledWith(7);
});

test("a pick'em-only league is labelled as such and offers Pick'em in place of the fantasy shortcuts", () => {
  const pickem = { ...league, pickem_only: true, draft_status: 'pending', season_status: 'regular' };
  const { unmount } = renderWithProviders(<LeagueCard league={pickem} compact />);
  expect(screen.getByText("Pick'em")).toBeInTheDocument();
  // No draft, so the phase reads as in season from day one.
  expect(screen.getByText('In season')).toBeInTheDocument();
  expect(screen.queryByText('Pre-draft')).not.toBeInTheDocument();

  unmount();
  renderWithProviders(<LeagueCard league={pickem} />);
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/league/7');
  expect(screen.getByRole('link', { name: "Pick'em" })).toHaveAttribute('href', '/league/7/pickem');
  expect(screen.queryByRole('link', { name: 'Draft Room' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Game Center' })).not.toBeInTheDocument();
});
