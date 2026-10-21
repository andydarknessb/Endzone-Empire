import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import AddPlayerAction from './AddPlayerAction';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

const player = { playerId: 9, name: 'Josh Palmer' };
const roster = [{ id: 31, name: 'Tyler Allgeier', position: 'RB' }];
const full = { rosterCount: 15, rosterCapacity: 15 };

function renderAction(props = {}) {
  return render(
    <SnackbarProvider>
      <AddPlayerAction player={player} leagueId={4} availability={full} roster={roster} onAdded={jest.fn()} {...props} />
    </SnackbarProvider>
  );
}

test('with no look passed it renders the default contained Add and drop button', () => {
  renderAction();
  const add = screen.getByTestId('add-player-submit');
  expect(add).toHaveClass('MuiButton-contained');
  expect(add).not.toHaveAttribute('data-variant');
  expect(screen.queryByRole('group', { name: 'Add Josh Palmer' })).not.toBeInTheDocument();
});

test('look="playselect" is ghost by default and filled only on the modal sheet', () => {
  const { unmount } = renderAction({ });
  expect(screen.getByTestId('add-player-submit')).toHaveAttribute('data-variant', 'ghost');
  unmount();

  renderAction({ filled: true });
  expect(screen.getByTestId('add-player-submit')).toHaveAttribute('data-variant', 'fill');
});

test('look="playselect" keeps the required drop and posts it', async () => {
  apiClient.post.mockResolvedValue({});
  apiClient.delete.mockResolvedValue({});
  renderAction({ });

  const submit = screen.getByRole('button', { name: 'Add and drop' });
  expect(submit).toBeDisabled();
  expect(screen.getByText('Roster 15 of 15')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'Drop a player' }));
  await userEvent.click(await screen.findByRole('option', { name: /Tyler Allgeier \(RB\)/ }));
  await userEvent.click(submit);

  expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/31?leagueId=4');
  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/9', { leagueId: 4 });
});
