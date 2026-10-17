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

test('with no look passed it renders the default outlined, and contained while watching', () => {
  const { unmount } = renderAction();
  expect(screen.getByTestId('watch-player-action')).toHaveClass('MuiButton-outlined');
  unmount();
  renderAction({ watching: true });
  expect(screen.getByTestId('watch-player-action')).toHaveClass('MuiButton-contained');
  expect(screen.getByTestId('watch-player-action')).not.toHaveAttribute('data-variant');
});

test('look="playselect" is a ghost toggle, and the Play-blue selected state (never fill) while watching', async () => {
  apiClient.put.mockResolvedValue({});
  const onToggled = jest.fn();
  const { unmount } = renderAction({ look: 'playselect', onToggled });

  const watch = screen.getByRole('button', { name: 'Watch' });
  expect(watch).toHaveAttribute('data-variant', 'ghost');
  expect(watch).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(watch);
  expect(onToggled).toHaveBeenCalledWith(true);
  unmount();

  renderAction({ look: 'playselect', watching: true });
  const watching = screen.getByRole('button', { name: 'Watching' });
  expect(watching).toHaveAttribute('data-variant', 'selected');
  expect(watching).toHaveAttribute('aria-pressed', 'true');
});
