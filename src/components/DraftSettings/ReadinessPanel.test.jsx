import React from 'react';
import { render, screen } from '@testing-library/react';
import ReadinessPanel from './ReadinessPanel';

test.each([0, 1])('explains readiness needs 2+ teams with %i team(s)', (teamCount) => {
  const teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, draft_ready: false }));
  render(<ReadinessPanel teams={teams} draftType="snake" />);

  expect(screen.getByText('Add at least 2 teams to track draft readiness.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(`0 of ${teamCount} managers ready`);
});

test('does not show the empty-state message once there are at least 2 teams', () => {
  render(<ReadinessPanel teams={[
    { id: 1, name: 'Team One', draft_ready: true },
    { id: 2, name: 'Team Two', draft_ready: false },
  ]} draftType="snake" />);

  expect(screen.queryByText('Add at least 2 teams to track draft readiness.')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
});
