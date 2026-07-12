import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import NotificationPrefs from './NotificationPrefs';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const defaultPrefs = {
  lineupReminder: true,
  waiverResults: false,
  weeklyRecap: true,
  tradeOffers: false,
};

test('loads preferences on mount and renders a labeled switch for each', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });

  renderWithProviders(<NotificationPrefs />);

  expect(await screen.findByLabelText('Lineup reminders')).toBeChecked();
  expect(screen.getByLabelText('Waiver results')).not.toBeChecked();
  expect(screen.getByLabelText('Weekly recap')).toBeChecked();
  expect(screen.getByLabelText('Trade offers')).not.toBeChecked();
  expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/prefs');
});

test('toggling a switch PUTs the correct partial body and disables it while saving', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });
  let resolvePut;
  apiClient.put.mockReturnValue(
    new Promise((resolve) => {
      resolvePut = resolve;
    })
  );

  renderWithProviders(<NotificationPrefs />);
  const waiverSwitch = await screen.findByLabelText('Waiver results');

  await userEvent.click(waiverSwitch);

  expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/prefs', {
    prefs: { waiverResults: true },
  });
  expect(waiverSwitch).toBeChecked();
  expect(waiverSwitch).toBeDisabled();

  resolvePut({ data: { ...defaultPrefs, waiverResults: true } });
  await waitFor(() => expect(waiverSwitch).not.toBeDisabled());
  expect(waiverSwitch).toBeChecked();
});

test('reverts the toggle and shows an error alert when the PUT fails', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });
  apiClient.put.mockRejectedValue({ response: { data: { error: 'save failed' } } });

  renderWithProviders(<NotificationPrefs />);
  const waiverSwitch = await screen.findByLabelText('Waiver results');

  await userEvent.click(waiverSwitch);

  expect(await screen.findByText('save failed')).toBeInTheDocument();
  await waitFor(() => expect(waiverSwitch).not.toBeChecked());
  expect(waiverSwitch).not.toBeDisabled();
});
