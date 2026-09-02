import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftOrderPanel from './DraftOrderPanel';

function renderPanel(teams, league = {}) {
  render(
    <DraftOrderPanel
      league={{ draft_order_overrides: null, draft_rotation: 'snake', roster_limit: 4, ...league }}
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

test('offers every round in the draft roster size, including round 19', () => {
  renderPanel([
    { id: 1, name: 'Team One', draft_position: 1 },
    { id: 2, name: 'Team Two', draft_position: 2 },
  ], { roster_limit: 20, ir_slots: 1 });

  expect(screen.getByText('Round 19')).toBeInTheDocument();
  expect(screen.queryByText('Round 20')).not.toBeInTheDocument();
});

// ADR 0021: a bare render here has no AppThemeProvider (src/theme/AppThemeProvider.jsx:73),
// so any subtitle Typography without an explicit component still resolves
// to <h6> by MUI's own default variantMapping. These three section titles
// get component="h5" here - one level below the Draft Settings page's own
// <Typography variant="h4"> title at DraftSettings.jsx:212, which this
// standalone panel render does not mount (see #704) - so a bare render must
// show no stray h6 and a real h5 for each.
test('gives its three section titles an explicit h5, and no stray h6', () => {
  renderPanel([
    { id: 1, name: 'Team One', draft_position: 1 },
    { id: 2, name: 'Team Two', draft_position: 2 },
  ]);

  expect(screen.getByRole('heading', { level: 5, name: 'Round 1 order' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 5, name: 'Rotation preview' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 5, name: 'Round overrides' })).toBeInTheDocument();
  expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
});
