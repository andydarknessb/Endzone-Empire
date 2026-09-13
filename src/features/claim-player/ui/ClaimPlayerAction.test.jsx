import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import ClaimPlayerAction from './ClaimPlayerAction';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

const player = { playerId: 7, name: 'Breece Hall' };

function renderAction(props = {}) {
  return render(
    <SnackbarProvider>
      <ClaimPlayerAction player={player} leagueId={1} onClaimed={jest.fn()} {...props} />
    </SnackbarProvider>
  );
}

test('a priority league claims with no drop and no bid field', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({ availability: { waiverPriority: 4 } });

  expect(screen.queryByLabelText('Bid')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('claim-player-submit'));

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: null,
    bid: 0,
  });
});

test('a FAAB league shows the bid field, invalid over budget, and posts the bid amount', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({ availability: { faabRemaining: 85 } });

  const submit = screen.getByTestId('claim-player-submit');
  expect(submit).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Bid'), '40');
  expect(submit).toBeEnabled();
  await userEvent.click(submit);

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: null,
    bid: 40,
  });
});

test('a drop pick is sorted worst projection first and included in the claim', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({
    availability: { waiverPriority: 1 },
    roster: [
      { id: 20, name: 'Josh Allen', position: 'QB', projected_weekly_points: 22.4 },
      { id: 21, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 },
    ],
  });

  await userEvent.click(screen.getByLabelText('Drop a player (optional)'));
  const options = await screen.findAllByRole('option');
  expect(options[1]).toHaveTextContent('Bench Guy');
  await userEvent.click(options[1]);
  await userEvent.click(screen.getByTestId('claim-player-submit'));

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: 21,
    bid: 0,
  });
});
