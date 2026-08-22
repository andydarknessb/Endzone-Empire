import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import NotificationPrefs from './NotificationPrefs';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
  delete navigator.serviceWorker;
  delete window.PushManager;
  delete window.Notification;
});

// Stubs the two browser APIs the push section feature-detects, plus the
// service-worker registration's pushManager (getSubscription/subscribe).
function mockPushSupport({ existingSubscription = null, subscribeResolves } = {}) {
  const pushManager = {
    getSubscription: jest.fn(() => Promise.resolve(existingSubscription)),
    subscribe: jest.fn(() => Promise.resolve(subscribeResolves || existingSubscription)),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  window.PushManager = function PushManager() {};
  window.Notification = { requestPermission: jest.fn(() => Promise.resolve('granted')) };
  return { pushManager };
}

const withPushKey = (key, prefs = defaultPrefs) => (url) => {
  if (url === '/api/notifications/push-public-key') {
    return Promise.resolve({ data: { publicKey: key } });
  }
  return Promise.resolve({ data: prefs });
};

const defaultPrefs = {
  lineupReminder: true,
  irAlerts: false,
  waiverResults: false,
  weeklyRecap: true,
  tradeOffers: false,
};

test('loads preferences on mount and renders a labeled switch for each', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });

  renderWithProviders(<NotificationPrefs />);

  expect(await screen.findByLabelText('Lineup reminders')).toBeChecked();
  expect(screen.getByLabelText('IR eligibility alerts')).not.toBeChecked();
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

describe('push notifications section', () => {
  test('is absent when the browser has no serviceWorker/PushManager support', async () => {
    apiClient.get.mockResolvedValue({ data: defaultPrefs });

    renderWithProviders(<NotificationPrefs />);

    await screen.findByLabelText('Lineup reminders');
    expect(screen.queryByLabelText('Push notifications on this device')).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith('/api/notifications/push-public-key');
  });

  test('is absent when the server has no VAPID key configured', async () => {
    mockPushSupport();
    apiClient.get.mockImplementation(withPushKey(null));

    renderWithProviders(<NotificationPrefs />);

    await screen.findByLabelText('Lineup reminders');
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/push-public-key')
    );
    expect(screen.queryByLabelText('Push notifications on this device')).not.toBeInTheDocument();
  });

  test('shows an unchecked switch when supported and a key is configured, off', async () => {
    mockPushSupport({ existingSubscription: null });
    apiClient.get.mockImplementation(withPushKey('fake-public-key'));

    renderWithProviders(<NotificationPrefs />);

    expect(await screen.findByLabelText('Push notifications on this device')).not.toBeChecked();
  });

  test('shows a checked switch when a subscription already exists', async () => {
    mockPushSupport({
      existingSubscription: { endpoint: 'https://push.example.com/existing' },
    });
    apiClient.get.mockImplementation(withPushKey('fake-public-key'));

    renderWithProviders(<NotificationPrefs />);

    expect(await screen.findByLabelText('Push notifications on this device')).toBeChecked();
  });

  test('enabling requests permission, subscribes, and POSTs the subscription JSON', async () => {
    const { pushManager } = mockPushSupport({
      existingSubscription: null,
      subscribeResolves: {
        endpoint: 'https://push.example.com/new',
        toJSON: () => ({ endpoint: 'https://push.example.com/new', keys: { p256dh: 'x', auth: 'y' } }),
      },
    });
    apiClient.get.mockImplementation(withPushKey('fake-public-key'));
    apiClient.post.mockResolvedValue({ status: 201, data: {} });

    renderWithProviders(<NotificationPrefs />);
    const pushSwitch = await screen.findByLabelText('Push notifications on this device');
    expect(pushSwitch).not.toBeChecked();

    await userEvent.click(pushSwitch);

    await waitFor(() => expect(pushSwitch).toBeChecked());
    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/notifications/push-subscribe', {
      subscription: { endpoint: 'https://push.example.com/new', keys: { p256dh: 'x', auth: 'y' } },
    });
  });

  test('disabling unsubscribes locally and DELETEs the endpoint', async () => {
    const unsubscribe = jest.fn(() => Promise.resolve(true));
    mockPushSupport({
      existingSubscription: { endpoint: 'https://push.example.com/existing', unsubscribe },
    });
    apiClient.get.mockImplementation(withPushKey('fake-public-key'));
    apiClient.delete.mockResolvedValue({ status: 200, data: { ok: true } });

    renderWithProviders(<NotificationPrefs />);
    const pushSwitch = await screen.findByLabelText('Push notifications on this device');
    expect(pushSwitch).toBeChecked();

    await userEvent.click(pushSwitch);

    await waitFor(() => expect(pushSwitch).not.toBeChecked());
    expect(unsubscribe).toHaveBeenCalled();
    expect(apiClient.delete).toHaveBeenCalledWith('/api/notifications/push-subscribe', {
      data: { endpoint: 'https://push.example.com/existing' },
    });
  });

  test('reverts and shows an alert when enabling fails (permission denied)', async () => {
    mockPushSupport({ existingSubscription: null });
    window.Notification.requestPermission = jest.fn(() => Promise.resolve('denied'));
    apiClient.get.mockImplementation(withPushKey('fake-public-key'));

    renderWithProviders(<NotificationPrefs />);
    const pushSwitch = await screen.findByLabelText('Push notifications on this device');

    await userEvent.click(pushSwitch);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    await waitFor(() => expect(pushSwitch).not.toBeChecked());
  });
});
