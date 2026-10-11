import React from 'react';
import { render, screen } from '@testing-library/react';
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Big play: Jaylen Warren');
  expect(alert.textContent).toContain('Big play: Jaylen Warren\nfacts\nbanter line');
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('keeps other query params when it removes alert', async () => {
  renderAt(`/team?leagueId=5&alert=${encodeURIComponent(JSON.stringify({ title: 'T', body: 'B' }))}`);

  await screen.findByRole('alert');
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/team\?leagueId=5$/);
});

test('shows the alert once under StrictMode', async () => {
  renderAt(`/league/5/game-center${alertParam({ title: 'Once', body: 'only' })}`, { strict: true });

  expect(await screen.findAllByRole('alert')).toHaveLength(1);
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('ignores a malformed alert param without throwing and still clears it', () => {
  renderAt('/league/5/game-center?alert=%7Bnot-json');

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('shows nothing when there is no alert param', () => {
  renderAt('/league/5/game-center');

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});
