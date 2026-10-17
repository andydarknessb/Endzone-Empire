/* eslint-disable testing-library/no-node-access, testing-library/prefer-presence-queries -- the cursor, fill and live-region facts are DOM structure, which Testing Library has no query for */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
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
      // The visible message and the status region both carry it while it is up.
      expect(screen.getAllByText(/Hello there/).length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.getByTestId('toast-status')).toHaveTextContent('Hello there. Undo available.'));
    unmount();
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(screen.getByTestId('toast-status')).toHaveTextContent('Hello there'));
    expect(screen.getByTestId('toast-status')).not.toHaveTextContent('Undo');
  });
});

describe('live regions hold text only (spec #2347 ruling 4)', () => {
  function ErrorTrigger() {
    const notify = useSnackbar();
    return <button onClick={() => notify('It failed', { severity: 'error' })}>fire</button>;
  }

  test('the status and alert regions are mounted before any toast, and are the same nodes after one', async () => {
    render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    const status = screen.getByTestId('toast-status');
    const alert = screen.getByTestId('toast-alert');
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(status).toHaveTextContent('Hello there. Undo available.'));
    // One region node for good, so a screen reader hears the change instead of a mount.
    expect(screen.getByTestId('toast-status')).toBe(status);
    expect(screen.getByTestId('toast-alert')).toBe(alert);
  });

  test('a toast with Undo and Dismiss keeps both buttons outside every live region', async () => {
    render(
      <SnackbarProvider>
        <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(screen.getByTestId('toast-status')).toHaveTextContent('Hello there'));
    expect(screen.getByTestId('toast-status').querySelector('button')).toBeNull();
    expect(screen.getByTestId('toast-alert')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  test('an error toast is said in the alert region, with the status region quiet', async () => {
    render(
      <SnackbarProvider>
        <ErrorTrigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(screen.getByTestId('toast-alert')).toHaveTextContent('It failed'));
    expect(screen.getByTestId('toast-status')).toBeEmptyDOMElement();
    expect(screen.getByTestId('toast-alert').querySelector('button')).toBeNull();
  });

  test('the visible toast is presentation and draws its message from an attribute; the region holds the one DOM copy of the text', async () => {
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    // One node carries the sentence, so a text query meets the toast once.
    expect(screen.getAllByText('Hello there')).toHaveLength(1);
    expect(screen.getByText('Hello there')).toBe(screen.getByTestId('toast-status'));
    const drawn = document.querySelector('[data-message="Hello there"]');
    expect(drawn).toHaveAttribute('aria-hidden', 'true');
    expect(drawn.closest('[role="presentation"]')).not.toBeNull();
  });

  test('closing the toast empties the regions, so a stale sentence is not announced again', async () => {
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(screen.getByTestId('toast-status')).toHaveTextContent('Hello there'));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByTestId('toast-status')).toBeEmptyDOMElement();
  });
});

test('Undo is described by the message it undoes, and keeps the name "Undo"', async () => {
  render(
    <SnackbarProvider>
      <Trigger options={{ actionLabel: 'Undo', onAction: jest.fn() }} />
    </SnackbarProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  const undo = await screen.findByRole('button', { name: 'Undo' });
  expect(undo).toHaveAccessibleDescription('Hello there. Undo available.');
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

test('the same sentence twice in a row clears the region first, so it is a change to announce again', async () => {
  render(
    <SnackbarProvider>
      <Trigger />
    </SnackbarProvider>
  );
  const status = screen.getByTestId('toast-status');
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  expect(status).toHaveTextContent('Hello there');
  await userEvent.click(screen.getByRole('button', { name: 'fire' }));
  expect(status).toBeEmptyDOMElement();
  await waitFor(() => expect(status).toHaveTextContent('Hello there'));
});
