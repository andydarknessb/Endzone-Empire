import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftOrderPanel from './DraftOrderPanel';

const LONG_TEAM_NAME = 'Keep my team name out yo mouth with an especially long suffix';

const baseProps = {
  teams: [
    { teamId: 1, teamName: LONG_TEAM_NAME, draft_position: 1, autodraft: false },
    { teamId: 2, teamName: 'Harbor Hawks', draft_position: 2, autodraft: true },
  ],
  draftStatus: 'pending',
  viewerTeamId: 1,
  isCommissioner: true,
  // The one On-the-clock value (#754): { team, state, deadlineAt }.
  onTheClock: { team: { teamId: 2, teamName: 'Harbor Hawks' }, state: 'running', deadlineAt: null },
  onToggleAutodraft: jest.fn(),
};

test('keeps a long Team name and its Autodraft control in one accessible row', () => {
  render(<DraftOrderPanel {...baseProps} />);

  const order = screen.getByRole('region', { name: 'Draft order' });
  const row = within(order).getAllByRole('listitem')[0];

  expect(row).toBeInTheDocument();
  expect(row).toContainElement(
    within(row).getByRole('checkbox', { name: `Autodraft for ${LONG_TEAM_NAME}` }),
  );
  expect(within(order).getAllByRole('listitem')).toHaveLength(2);
});

test('keeps the complete Team name available when the row label is constrained', () => {
  render(<DraftOrderPanel {...baseProps} />);

  expect(screen.getByText(LONG_TEAM_NAME)).toHaveAttribute('aria-label', LONG_TEAM_NAME);
  expect(screen.getByText(LONG_TEAM_NAME)).toHaveAttribute('tabindex', '0');
});

test('preserves Team status markers and Autodraft switch behavior', async () => {
  const user = userEvent.setup();
  const onToggleAutodraft = jest.fn();
  render(<DraftOrderPanel {...baseProps} isCommissioner={false} onToggleAutodraft={onToggleAutodraft} />);

  expect(screen.getByText('You')).toBeInTheDocument();
  expect(screen.getByText('AUTO')).toBeInTheDocument();
  expect(screen.getByLabelText('On the clock')).toBeInTheDocument();

  const toggle = screen.getByRole('checkbox', { name: `Autodraft for ${LONG_TEAM_NAME}` });
  await user.tab();
  await user.tab();
  expect(toggle).toHaveFocus();
  await user.keyboard(' ');

  expect(onToggleAutodraft).toHaveBeenCalledWith(1, true);
});

test('keeps duplicate Team names scoped to their own row and permission', () => {
  const duplicateTeams = [
    { teamId: 1, teamName: 'Rival Club', draft_position: 1, autodraft: false },
    { teamId: 2, teamName: 'Rival Club', draft_position: 2, autodraft: false },
  ];

  render(
    <DraftOrderPanel
      {...baseProps}
      teams={duplicateTeams}
      viewerTeamId={1}
      isCommissioner={false}
    />,
  );

  const rows = within(screen.getByRole('region', { name: 'Draft order' })).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole('checkbox', { name: 'Autodraft for Rival Club' })).toBeInTheDocument();
  expect(within(rows[1]).queryByRole('checkbox', { name: 'Autodraft for Rival Club' })).not.toBeInTheDocument();
});

test('does not expose Autodraft controls after the Draft is complete', () => {
  render(<DraftOrderPanel {...baseProps} draftStatus="complete" />);

  expect(screen.queryByRole('checkbox', { name: `Autodraft for ${LONG_TEAM_NAME}` })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Autodraft for Harbor Hawks' })).not.toBeInTheDocument();
});
