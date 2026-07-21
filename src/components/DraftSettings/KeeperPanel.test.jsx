import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import KeeperPanel from './KeeperPanel';

function renderPanel(onSaveLeague = jest.fn()) {
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: 1, keeper_lock_at: null, roster_limit: 4 }}
      teams={[]}
      keepers={[]}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={onSaveLeague}
      onSaveKeepers={jest.fn()}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  return onSaveLeague;
}

function renderAssignments({ keeperCount, keepers }) {
  const onSaveKeepers = jest.fn();
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: keeperCount, keeper_lock_at: null, roster_limit: 4 }}
      teams={[
        { id: 1, name: 'Team One' },
        { id: 2, name: 'Team Two' },
      ]}
      keepers={keepers}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={jest.fn()}
      onSaveKeepers={onSaveKeepers}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  return onSaveKeepers;
}

test.each([
  ['-1', 'Keepers per team must be between 0 and 4.'],
  ['1.5', 'Keepers per team must be a whole number between 0 and 4.'],
  ['5', 'Keepers per team must be between 0 and 4.'],
])('blocks invalid keeper count %s', (value, message) => {
  const onSaveLeague = renderPanel();
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value } });

  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save keeper settings' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));
  expect(onSaveLeague).not.toHaveBeenCalled();
});

test.each(['0', '4'])('accepts keeper count boundary %s', (value) => {
  const onSaveLeague = renderPanel();
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));

  expect(onSaveLeague).toHaveBeenCalledWith({
    keepersEnabled: true,
    keeperCount: Number(value),
    keeperLockAt: null,
  }, 'Keeper settings saved');
});

test('shows a row error and blocks duplicate player assignments', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 2,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 2, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
    ],
  });

  expect(screen.getByText('Player One is assigned more than once.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});

test('shows a row error and blocks duplicate team and round slots', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 2,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 1, player_id: 102, name: 'Player Two', position: 'RB', draft_round: 1 },
    ],
  });

  expect(screen.getByText('Team One already has a keeper in round 1.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});

test('shows a row error when one team exceeds its keeper allowance', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 1,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 1, player_id: 102, name: 'Player Two', position: 'RB', draft_round: 2 },
    ],
  });

  expect(screen.getByText('Team One exceeds the 1 keeper limit.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});
