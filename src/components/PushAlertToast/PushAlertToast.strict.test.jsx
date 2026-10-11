import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import PushAlertToast from './PushAlertToast';

jest.mock('../Snackbar/SnackbarProvider', () => ({
  useSnackbar: jest.fn(),
}));

let notify;
let navigateTo;

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function NavigateProbe() {
  navigateTo = useNavigate();
  return null;
}

function renderAt(entry) {
  return render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <PushAlertToast />
        <LocationProbe />
        <NavigateProbe />
      </MemoryRouter>
    </React.StrictMode>
  );
}

const alertParam = (payload) => `?alert=${encodeURIComponent(JSON.stringify(payload))}`;

beforeEach(() => {
  notify = jest.fn();
  useSnackbar.mockReturnValue(notify);
});

test('shows the alert exactly once under StrictMode and clears the param', () => {
  renderAt(`/league/5/game-center${alertParam({ title: 'Once', body: 'only' })}`);

  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith('Once\nonly', { severity: 'info', duration: 15000 });
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});

test('shows the same alert again when it is tapped again after the param was cleared', () => {
  const search = alertParam({ title: 'X', body: 'Y' });
  renderAt(`/league/5/game-center${search}`);
  expect(notify).toHaveBeenCalledTimes(1);

  act(() => navigateTo('/league/5/game-center'));
  expect(notify).toHaveBeenCalledTimes(1);

  act(() => navigateTo(`/league/5/game-center${search}`));
  expect(notify).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/5\/game-center$/);
});
