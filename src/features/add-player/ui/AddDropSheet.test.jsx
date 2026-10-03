import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import AddDropSheet from './AddDropSheet';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

const player = { id: 9, name: 'Josh Palmer' };
const roster = [
  { id: 20, name: 'Josh Allen', position: 'QB', projected_weekly_points: 22.4 },
  { id: 21, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 },
  { id: 22, name: 'Mid Guy', position: 'RB', projected_weekly_points: 9 },
];

function renderSheet(props = {}) {
  return render(
    <SnackbarProvider>
      <AddDropSheet
        open
        player={player}
        leagueId={4}
        roster={roster}
        dropSuggestion={null}
        onClose={jest.fn()}
        onAdded={jest.fn()}
        {...props}
      />
    </SnackbarProvider>,
  );
}

test('titles the sheet for the player and explains the full roster', () => {
  renderSheet();
  expect(screen.getByRole('dialog', { name: 'Add Josh Palmer' })).toBeInTheDocument();
  expect(screen.getByText('Your roster is full. Choose a player to drop.')).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: 'Drop a player' })).toHaveAccessibleDescription(
    'Your roster is full. Choose a player to drop.',
  );
});

test('lists the roster worst projection first, labelled as the claim sheet labels it', () => {
  renderSheet();
  const radios = screen.getAllByRole('radio');
  expect(radios[0]).toHaveAccessibleName('Bench Guy (WR) · 3.2 proj');
  expect(radios[1]).toHaveAccessibleName('Mid Guy (RB) · 9.0 proj');
  expect(radios[2]).toHaveAccessibleName('Josh Allen (QB) · 22.4 proj');
});

test('checks the dropSuggestion on open, and nothing when it is not on the roster', () => {
  const { unmount } = renderSheet({ dropSuggestion: { id: 22, name: 'Mid Guy' } });
  expect(screen.getByRole('radio', { name: /Mid Guy/ })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Add and drop' })).toBeEnabled();
  unmount();
  renderSheet({ dropSuggestion: { id: 99, name: 'Gone' } });
  expect(screen.getAllByRole('radio').some((r) => r.checked)).toBe(false);
});

test('Add and drop is disabled until a player is chosen, then deletes the drop and posts the add', async () => {
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
  const onClose = jest.fn();
  const onAdded = jest.fn();
  renderSheet({ onClose, onAdded });

  expect(screen.getByRole('button', { name: 'Add and drop' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: /Bench Guy/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Add and drop' }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/21?leagueId=4');
  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/9', { leagueId: 4 });
  expect(apiClient.delete.mock.invocationCallOrder[0]).toBeLessThan(apiClient.post.mock.invocationCallOrder[0]);
  expect(onAdded).toHaveBeenCalled();
});

test('a refused add keeps the sheet open', async () => {
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockRejectedValueOnce(new Error('nope')).mockResolvedValue({});
  const onClose = jest.fn();
  renderSheet({ onClose, dropSuggestion: { id: 21, name: 'Bench Guy' } });

  await userEvent.click(screen.getByRole('button', { name: 'Add and drop' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2)); // add, then undo-drop
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/team/roster/21/undo-drop', { leagueId: 4 });
  expect(onClose).not.toHaveBeenCalled();
});

test('an empty roster read shows one line in place of the options and cannot submit', () => {
  renderSheet({ roster: [] });
  expect(screen.getByText("Couldn't load your roster. Close and try again.")).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add and drop' })).toBeDisabled();
});

test('Cancel closes without touching the roster', async () => {
  const onClose = jest.fn();
  renderSheet({ onClose });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalled();
  expect(apiClient.delete).not.toHaveBeenCalled();
});
