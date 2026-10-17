import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import PushAlertToast from './PushAlertToast';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderAt(entry, { strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <SnackbarProvider>
        <PushAlertToast />
        <LocationProbe />
      </SnackbarProvider>
    </MemoryRouter>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

const alertParam = (payload) => `?alert=${encodeURIComponent(JSON.stringify(payload))}`;

test('shows the title and the whole body, then removes the alert param from the URL', async () => {
  renderAt(`/league/5/game-center${alertParam({ title: 'Big play: Jaylen Warren', body: 'facts\nbanter line' })}`);

  // The toast is said in the provider's always-mounted status region, a beat after it opens.
  const alert = screen.getByTestId('toast-status');
  await waitFor(() => expect(alert).toHaveTextContent('Big play: Jaylen Warren'));
  expect(alert.textContent).toContain('Big play: Jaylen Warren\nfacts\nbanter line');
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('keeps other query params when it removes alert', async () => {
  renderAt(`/team?leagueId=5&alert=${encodeURIComponent(JSON.stringify({ title: 'T', body: 'B' }))}`);

  await waitFor(() => expect(screen.getByTestId('toast-status')).toHaveTextContent('T'));
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/team\?leagueId=5$/);
});

test('ignores a malformed alert param without throwing and still clears it', () => {
  renderAt('/league/5/game-center?alert=%7Bnot-json');

  expect(screen.getByTestId('toast-status')).toBeEmptyDOMElement();
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('shows nothing when there is no alert param', () => {
  renderAt('/league/5/game-center');

  expect(screen.getByTestId('toast-status')).toBeEmptyDOMElement();
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});
