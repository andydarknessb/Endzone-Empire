import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

test('a fractional bid disables Claim and never posts', async () => {
  renderAction({ availability: { faabRemaining: 85 } });

  await userEvent.type(screen.getByLabelText('Bid'), '2.5');
  expect(screen.getByTestId('claim-player-submit')).toBeDisabled();
  expect(screen.getByText('Enter a whole-dollar bid between $0 and $85')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
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

test('at roster capacity the drop pick is required and Claim waits for it', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({
    availability: { waiverPriority: 1, rosterCount: 16, rosterCapacity: 16 },
    roster: [{ id: 21, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 }],
  });

  const submit = screen.getByTestId('claim-player-submit');
  expect(submit).toBeDisabled();
  expect(screen.queryByLabelText('Drop a player (optional)')).not.toBeInTheDocument();
  expect(screen.getByText(/roster is full/i)).toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Drop a player'));
  const options = await screen.findAllByRole('option');
  expect(options).toHaveLength(2);
  await userEvent.click(options[1]);
  expect(submit).toBeEnabled();
  await userEvent.click(submit);

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: 21,
    bid: 0,
  });
});

// The Play-select bar (ADR 0067, spec #2347 ruling 7).
describe('the Play-select bar', () => {
  const player = { playerId: 7, name: 'Breece Hall' };
  const roster = [{ id: 31, name: 'Tyler Allgeier', position: 'RB', projected_weekly_points: 4.2 }];
  const faab = { faabRemaining: 62, waiverPriority: 5, rosterCount: 15, rosterCapacity: 15 };

  function renderBar(props = {}) {
    return render(
      <SnackbarProvider>
        <ClaimPlayerAction player={player} leagueId={1} availability={faab} roster={roster} onClaimed={jest.fn()} {...props} />
      </SnackbarProvider>
    );
  }

  test('is a ghost Claim by default, filled only when told it is in a modal sheet', () => {
    const { unmount } = renderBar({ });
    expect(screen.getByTestId('claim-player-submit')).toHaveAttribute('data-variant', 'ghost');
    expect(screen.getByTestId('claim-player-submit')).not.toHaveClass('MuiButton-contained');
    unmount();

    renderBar({ filled: true });
    expect(screen.getByTestId('claim-player-submit')).toHaveAttribute('data-variant', 'fill');
  });

  test('keeps the claim flow: required drop, FAAB bid, and the post', async () => {
    apiClient.post.mockResolvedValue({});
    renderBar({ filled: true });

    const group = screen.getByRole('group', { name: 'Claim Breece Hall' });
    expect(within(group).getByText('Your roster is full. Choose a player to drop when this claim clears.')).toBeInTheDocument();
    expect(within(group).getByText('Priority #5')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Claim' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Bid'), '9');
    expect(within(group).getByText('$62 remaining')).toBeInTheDocument();
    expect(submit).toBeDisabled(); // a full roster still needs a drop
    await userEvent.click(screen.getByRole('combobox', { name: 'Drop a player' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Tyler Allgeier (RB)' }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: 31,
      bid: 9,
    });
  });
});
