/* eslint-disable testing-library/no-node-access, testing-library/no-container, testing-library/prefer-presence-queries -- the Play-select cursor, fill and live-region facts are DOM structure (a class, a data attribute, "no button inside this region"), which Testing Library has no query for */
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

  test('names the action in the status text only when there is one', async () => {
    const { unmount } = render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Hello there. Undo available.');
    unmount();
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(await screen.findByRole('status')).not.toHaveTextContent('Undo');
  });
});

describe('live region holds text only (spec #2347 ruling 4)', () => {
  test('a toast with Undo and Dismiss keeps both buttons outside its status region', async () => {
    render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    const status = await screen.findByRole('status');
    expect(status.querySelector('button')).toBeNull();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  test('an error toast is the alert region, on its text, with its buttons outside', async () => {
    function ErrorTrigger() {
      const notify = useSnackbar();
      return <button onClick={() => notify('It failed', { severity: 'error' })}>fire</button>;
    }
    render(
      <SnackbarProvider>
        <ErrorTrigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('It failed');
    expect(alert.querySelector('button')).toBeNull();
  });
});

test('Undo hands focus back to the page before its action runs, so a caller restoring focus does not find it on the toast', async () => {
  let activeInAction = null;
  const onAction = jest.fn(() => { activeInAction = document.activeElement; });
  render(
    <SnackbarProvider>
      <Trigger options={{ actionLabel: 'Undo', onAction }} />
    </SnackbarProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(activeInAction).toBe(document.body);
});
