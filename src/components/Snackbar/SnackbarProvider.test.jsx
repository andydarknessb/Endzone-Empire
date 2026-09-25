import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnackbarProvider, useSnackbar } from './SnackbarProvider';

function Trigger({ options }) {
  const notify = useSnackbar();
  return <button onClick={() => notify('Hello there', options)}>fire</button>;
}

test('shows a message when notify is called', async () => {
  render(
    <SnackbarProvider>
      <Trigger />
    </SnackbarProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  expect(await screen.findByText('Hello there')).toBeInTheDocument();
});

test('renders an Undo action button and invokes onAction when clicked', async () => {
  const onAction = jest.fn();
  render(
    <SnackbarProvider>
      <Trigger options={{ actionLabel: 'Undo', onAction }} />
    </SnackbarProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  expect(onAction).toHaveBeenCalledTimes(1);
});

test('useSnackbar is a safe no-op when used outside the provider', async () => {
  render(<Trigger />);
  // Clicking must not throw even though there is no provider.
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  expect(screen.getByRole('button', { name: 'fire' })).toBeInTheDocument();
});

describe('actionable toast (#1645)', () => {
  test('action and dismiss buttons meet the 44px touch target', async () => {
    render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    const size = { minWidth: '44px', minHeight: '44px' };
    expect(await screen.findByRole('button', { name: 'Undo' })).toHaveStyle(size);
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveStyle(size);
  });

  test('lingers 20s when it has an action', () => {
    jest.useFakeTimers();
    try {
      render(
        <SnackbarProvider>
          <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
        </SnackbarProvider>
      );
      act(() => {
        screen.getByRole('button', { name: 'fire' }).click();
      });
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      expect(screen.getByText(/Hello there/)).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByText(/Hello there/)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('names the action in the alert text only when there is one', async () => {
    const { unmount } = render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hello there. Undo available.');
    unmount();
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Undo');
  });
});
