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

function renderAction(props = {}) {
  return render(
    <SnackbarProvider>
      <AddPlayerAction player={player} leagueId={4} onAdded={jest.fn()} {...props} />
    </SnackbarProvider>
  );
}

test('under capacity: a plain Add to roster button posts with no drop', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({ availability: { rosterCount: 10, rosterCapacity: 16 } });

  expect(screen.queryByLabelText('Drop a player')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('add-player-submit'));

  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/9', { leagueId: 4 });
  expect(apiClient.delete).not.toHaveBeenCalled();
});

test('at capacity: the drop pick is required, sorted worst projection first, and posts the drop first', async () => {
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
  renderAction({
    availability: { rosterCount: 16, rosterCapacity: 16 },
    roster: [
      { id: 20, name: 'Josh Allen', position: 'QB', projected_weekly_points: 22.4 },
      { id: 21, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 },
    ],
  });

  expect(screen.getByTestId('add-player-submit')).toBeDisabled();

  await userEvent.click(screen.getByLabelText('Drop a player'));
  const options = await screen.findAllByRole('option');
  expect(options[1]).toHaveTextContent('Bench Guy');
  await userEvent.click(options[1]);

  await userEvent.click(screen.getByTestId('add-player-submit'));
  expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/21?leagueId=4');
  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/9', { leagueId: 4 });
});
