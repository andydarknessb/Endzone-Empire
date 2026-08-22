import React from 'react';
import { render, screen } from '@testing-library/react';
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
