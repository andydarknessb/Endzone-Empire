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
const roster = [{ id: 31, name: 'Tyler Allgeier', position: 'RB', projected_weekly_points: 4.2 }];
const faab = { faabRemaining: 62, waiverPriority: 5, rosterCount: 15, rosterCapacity: 15 };

function renderAction(props = {}) {
  return render(
    <SnackbarProvider>
      <ClaimPlayerAction player={player} leagueId={1} availability={faab} roster={roster} onClaimed={jest.fn()} {...props} />
    </SnackbarProvider>
  );
}

test('with no look passed it renders the default contained Claim, not the playselect bar', () => {
  renderAction();
  const claim = screen.getByTestId('claim-player-submit');
  expect(claim).toHaveClass('MuiButton-contained');
  expect(claim).not.toHaveAttribute('data-variant');
  expect(screen.queryByRole('group', { name: 'Claim Breece Hall' })).not.toBeInTheDocument();
});

test('look="playselect" is a ghost Claim by default, filled only when told it is in a modal sheet', () => {
  const { unmount } = renderAction({ });
  expect(screen.getByTestId('claim-player-submit')).toHaveAttribute('data-variant', 'ghost');
  expect(screen.getByTestId('claim-player-submit')).not.toHaveClass('MuiButton-contained');
  unmount();

  renderAction({ filled: true });
  expect(screen.getByTestId('claim-player-submit')).toHaveAttribute('data-variant', 'fill');
});

test('look="playselect" keeps the claim flow: required drop, FAAB bid, and the post', async () => {
  apiClient.post.mockResolvedValue({});
  renderAction({ filled: true });

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
