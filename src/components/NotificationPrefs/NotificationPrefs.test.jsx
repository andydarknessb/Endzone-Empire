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
  injuryAlerts: true,
  scoreUpdates: false,
};

test('loads preferences on mount and renders a labeled switch for each', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });

  renderWithProviders(<NotificationPrefs />);

  expect(await screen.findByLabelText('Lineup reminders')).toBeChecked();
  expect(screen.getByLabelText('IR eligibility alerts')).not.toBeChecked();
  expect(screen.getByLabelText('Waiver results')).not.toBeChecked();
  expect(screen.getByLabelText('Weekly recap')).toBeChecked();
  expect(screen.getByLabelText('Trade offers')).not.toBeChecked();
  expect(screen.getByLabelText('Injury alerts')).toBeChecked();
  expect(screen.getByLabelText('Score updates')).not.toBeChecked();
  expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/prefs');
});

test('the injury alerts and score updates toggles carry their helper text and PUT their keys', async () => {
  apiClient.get.mockResolvedValue({ data: defaultPrefs });
  apiClient.put.mockResolvedValue({ data: { ...defaultPrefs, scoreUpdates: true } });

  renderWithProviders(<NotificationPrefs />);

  expect(await screen.findByLabelText('Injury alerts')).toHaveAccessibleDescription(
    'A player on one of your rosters changes injury designation'
  );
  const scores = screen.getByLabelText('Score updates');
  expect(scores).toHaveAccessibleDescription('Your matchup when the lead changes and when it is over');

  await userEvent.click(scores);

  expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/prefs', { prefs: { scoreUpdates: true } });
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

  describe('iOS Home Screen hint', () => {
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
    const setUserAgent = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
    const HINT = /need the app on your Home Screen/;
    const originalUa = window.navigator.userAgent;
    afterEach(() => setUserAgent(originalUa));

    test('replaces the subscribe switch on iPhone when PushManager and Notification are missing', async () => {
      setUserAgent(IPHONE_UA);
      apiClient.get.mockImplementation(withPushKey('BEl6test'));

      renderWithProviders(<NotificationPrefs />);

      expect(await screen.findByText(HINT)).toBeInTheDocument();
      expect(screen.queryByLabelText('Push notifications on this device')).not.toBeInTheDocument();
    });

    test('shows the hint and no switch when PushManager exists but Notification is missing', async () => {
      setUserAgent(IPHONE_UA);
      mockPushSupport();
      delete window.Notification;
      apiClient.get.mockImplementation(withPushKey('BEl6test'));

      renderWithProviders(<NotificationPrefs />);

      expect(await screen.findByText(HINT)).toBeInTheDocument();
      expect(screen.queryByLabelText('Push notifications on this device')).not.toBeInTheDocument();
    });

    test('shows the subscribe switch and no hint when push APIs are present', async () => {
      setUserAgent(IPHONE_UA);
      mockPushSupport();
      apiClient.get.mockImplementation(withPushKey('BEl6test'));

      renderWithProviders(<NotificationPrefs />);

      expect(await screen.findByLabelText('Push notifications on this device')).toBeInTheDocument();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });
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

describe('postgame cutscenes preference', () => {
  test('shows the toggle with its helper text, bound to postgameCutscenes', async () => {
    apiClient.get.mockResolvedValue({ data: { ...defaultPrefs, postgameCutscenes: true } });

    renderWithProviders(<NotificationPrefs />);

    const toggle = await screen.findByLabelText('Postgame cutscenes');
    expect(toggle).toBeChecked();
    expect(
      screen.getByText('A full-screen result the first time you open Home after a week is final.')
    ).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(
      'A full-screen result the first time you open Home after a week is final.'
    );
  });

  test('toggling it off PUTs the key and the switch stays off', async () => {
    apiClient.get.mockResolvedValue({ data: { ...defaultPrefs, postgameCutscenes: true } });
    apiClient.put.mockResolvedValue({ data: { ...defaultPrefs, postgameCutscenes: false } });

    renderWithProviders(<NotificationPrefs />);
    const toggle = await screen.findByLabelText('Postgame cutscenes');

    await userEvent.click(toggle);

    expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/prefs', {
      prefs: { postgameCutscenes: false },
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();
  });

  test('toggling it back on PUTs true', async () => {
    apiClient.get.mockResolvedValue({ data: { ...defaultPrefs, postgameCutscenes: false } });
    apiClient.put.mockResolvedValue({ data: { ...defaultPrefs, postgameCutscenes: true } });

    renderWithProviders(<NotificationPrefs />);
    const toggle = await screen.findByLabelText('Postgame cutscenes');
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/prefs', {
      prefs: { postgameCutscenes: true },
    });
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
