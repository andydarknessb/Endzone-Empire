import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftOrderPanel from './DraftOrderPanel';

function renderPanel(teams) {
  render(
    <DraftOrderPanel
      league={{ draft_order_overrides: null, draft_rotation: 'snake', roster_limit: 4 }}
      teams={teams}
      frozen={false}
      onSave={jest.fn()}
      onSetOrder={jest.fn()}
      onRandomize={jest.fn()}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
}

test.each([0, 1])('explains the draft order needs 2+ teams and disables actions with %i team(s)', (teamCount) => {
  const teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, draft_position: i + 1 }));
  renderPanel(teams);

  expect(screen.getByText('Add at least 2 teams to set a draft order.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Randomize order' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save round overrides' })).toBeDisabled();
});

test('enables draft order actions once there are at least 2 teams', () => {
  renderPanel([
    { id: 1, name: 'Team One', draft_position: 1 },
    { id: 2, name: 'Team Two', draft_position: 2 },
  ]);

  expect(screen.queryByText('Add at least 2 teams to set a draft order.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Randomize order' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save order' })).toBeEnabled();
});
