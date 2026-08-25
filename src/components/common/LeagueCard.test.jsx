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
  expect(screen.getByRole('link', { name: /Sunday Ballers/ })).toHaveAttribute('href', '/league/7');

  unmount();
  renderWithProviders(<LeagueCard league={{ ...league, draft_status: 'complete', season_status: 'playoffs' }} />);
  expect(screen.getByText('Playoffs')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/7/game-center');
});

// #188: the card reads the viewer's role off the two per-viewer flags the
// leagues list ships (`is_owner`, `is_commissioner`) instead of taking an
// `isOwner` its caller worked out by comparing account ids. Every caller of
// this card renders the same payload, so every caller gets the same answer -
// which is the bug this replaces: UserPage rendered the card without the prop
// and labelled a league's own creator "Co-Commissioner".
test('names the creator commissioner and a co-commissioner co-commissioner, from the payload alone', () => {
  const { unmount } = renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: true, is_commissioner: true }} compact />
  );
  expect(screen.getByText('Commissioner')).toBeInTheDocument();
  expect(screen.queryByText('Co-Commissioner')).not.toBeInTheDocument();

  unmount();
  renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: false, is_commissioner: true }} compact />
  );
  expect(screen.getByText('Co-Commissioner')).toBeInTheDocument();
  expect(screen.queryByText('Commissioner')).not.toBeInTheDocument();
});

// #188 follow-up. In compact mode the whole card is one link, so every chip's
// text is concatenated into its accessible name and the role chip announces
// indistinguishably from "PPR" - one more league fact rather than a statement
// about the reader. The labelling fix is only finished once the role reads as
// a role out loud.
test('announces the role as a statement about the reader, not as another league fact', () => {
  const { unmount } = renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: true, is_commissioner: true }} compact />
  );
  expect(screen.getByRole('link')).toHaveAccessibleName(/You are the Commissioner/);

  unmount();
  renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: false, is_commissioner: true }} compact />
  );
  expect(screen.getByRole('link')).toHaveAccessibleName(/You are the Co-Commissioner/);
});

// Every card in a list carried the identical name "League actions", so a
// screen-reader user moving through /league heard the same button over and
// over with nothing to say which league it belonged to. Pre-existing, folded
// in here because it is the same accessible-name pass as the chip above.
test('names the league in the actions button, so a list of cards is navigable', () => {
  renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: true }} onDelete={jest.fn()} />
  );

  expect(screen.getByRole('button', { name: 'League actions for Sunday Ballers' })).toBeInTheDocument();
});

test('offers the delete action to the creator only', async () => {
  const onDelete = jest.fn();
  const { unmount } = renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: false, is_commissioner: true }} onDelete={onDelete} />
  );
  // Deleting a league is one of the powers that stays with the creator alone,
  // so a co-commissioner gets no actions menu at all.
  expect(screen.queryByRole('button', { name: /^League actions for / })).not.toBeInTheDocument();

  unmount();
  renderWithProviders(
    <LeagueCard league={{ ...league, is_owner: true }} onDelete={onDelete} />
  );
  expect(screen.getByRole('button', { name: /^League actions for / })).toBeInTheDocument();
});

test('requires confirmation before deleting a league', async () => {
  const onDelete = jest.fn();
  renderWithProviders(<LeagueCard league={{ ...league, is_owner: true }} onDelete={onDelete} />);

  await userEvent.click(screen.getByRole('button', { name: /^League actions for / }));
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
