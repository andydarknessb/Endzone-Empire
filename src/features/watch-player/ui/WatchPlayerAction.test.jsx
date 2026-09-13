import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import WatchPlayerAction from './WatchPlayerAction';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn(), delete: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

function renderAction(props = {}) {
  return render(
    <SnackbarProvider>
      <WatchPlayerAction playerId={9} leagueId={4} watching={false} {...props} />
    </SnackbarProvider>
  );
}

test('not watching: renders "Watch" and PUTs on click, reporting watching: true', async () => {
  apiClient.put.mockResolvedValue({});
  const onToggled = jest.fn();
  renderAction({ onToggled });

  const button = screen.getByRole('button', { name: 'Watch' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(button);

  expect(apiClient.put).toHaveBeenCalledWith('/api/players/9/watch', null, { params: { leagueId: 4 } });
  expect(onToggled).toHaveBeenCalledWith(true);
});

test('watching: renders "Watching" and DELETEs on click, reporting watching: false', async () => {
  apiClient.delete.mockResolvedValue({});
  const onToggled = jest.fn();
  renderAction({ watching: true, onToggled });

  const button = screen.getByRole('button', { name: 'Watching' });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(button);

  expect(apiClient.delete).toHaveBeenCalledWith('/api/players/9/watch', { params: { leagueId: 4 } });
  expect(onToggled).toHaveBeenCalledWith(false);
});
