import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertPrompt, { alertPromptState, hasLiveTeam } from './AlertPrompt';
import {
  ALERT_PROMPT_KEY, readAlertPromptDismissal, writeAlertPromptDismissal,
} from './alertPromptDismissal';
import {
  fetchPushPublicKey, getCurrentSubscription, isPushSupported, needsHomeScreenInstall, subscribeToPush,
} from '../../utils/push';

jest.mock('../../utils/push', () => ({
  __esModule: true,
  isPushSupported: jest.fn(),
  needsHomeScreenInstall: jest.fn(),
  fetchPushPublicKey: jest.fn(),
  getCurrentSubscription: jest.fn(),
  subscribeToPush: jest.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 12);
const live = { my_team_id: 10, status: { phase: 'in-season' } };
const eligible = {
  leagues: [live],
  supported: true,
  publicKey: 'key',
  subscribed: false,
  permission: 'default',
  installHint: false,
  dismissal: { count: 0, at: 0 },
  now: NOW,
};

describe('alertPromptState', () => {
  test('an eligible manager sees the default state', () => {
    expect(alertPromptState(eligible)).toBe('default');
  });

  test.each([
    ['push is not supported', { supported: false }],
    ['the server has no public key', { publicKey: null }],
    ['this browser already holds a subscription', { subscribed: true }],
    ['no league row has a team', { leagues: [{ status: { phase: 'in-season' } }] }],
    ['there are no leagues', { leagues: [] }],
    ['every league with a team is finished', {
      leagues: [{ my_team_id: 10, status: { phase: 'complete' } }, { status: { phase: 'in-season' } }],
    }],
    ['dismissed twice', { dismissal: { count: 2, at: NOW - 30 * DAY } }],
    ['dismissed once, under seven days ago', { dismissal: { count: 1, at: NOW - 6 * DAY } }],
  ])('is hidden when %s', (_name, override) => {
    expect(alertPromptState({ ...eligible, ...override })).toBe('hidden');
  });

  test('one dismissal eight days old returns default', () => {
    expect(alertPromptState({ ...eligible, dismissal: { count: 1, at: NOW - 8 * DAY } })).toBe('default');
  });

  test('install when the install hint is true', () => {
    expect(alertPromptState({ ...eligible, supported: false, installHint: true })).toBe('install');
  });

  test('blocked when permission is denied', () => {
    expect(alertPromptState({ ...eligible, permission: 'denied' })).toBe('blocked');
  });

  test('a missing permission is not blocked', () => {
    expect(alertPromptState({ ...eligible, permission: undefined })).toBe('default');
  });

  test('one live league is enough beside a finished one', () => {
    const leagues = [{ my_team_id: 1, status: { phase: 'complete' } }, live];
    expect(hasLiveTeam(leagues)).toBe(true);
  });
});

describe('alert prompt dismissal store', () => {
  beforeEach(() => window.localStorage.clear());

  test('reads as never dismissed when nothing, junk or a bad shape is stored', () => {
    expect(readAlertPromptDismissal()).toEqual({ count: 0, at: 0 });
    window.localStorage.setItem(ALERT_PROMPT_KEY, 'not json');
    expect(readAlertPromptDismissal()).toEqual({ count: 0, at: 0 });
    window.localStorage.setItem(ALERT_PROMPT_KEY, '{"count":"x"}');
    expect(readAlertPromptDismissal()).toEqual({ count: 0, at: 0 });
  });

  test('round-trips the count and time', () => {
    writeAlertPromptDismissal({ count: 1, at: NOW });
    expect(JSON.parse(window.localStorage.getItem(ALERT_PROMPT_KEY))).toEqual({ count: 1, at: NOW });
    expect(readAlertPromptDismissal()).toEqual({ count: 1, at: NOW });
  });

  test('a denied storage degrades without throwing', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readAlertPromptDismissal()).toEqual({ count: 0, at: 0 });
    expect(() => writeAlertPromptDismissal({ count: 1, at: NOW })).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('AlertPrompt', () => {
  const leagues = [{ my_team_id: 10, status: { phase: 'in-season' } }];
  const originalNotification = window.Notification;

  beforeEach(() => {
    window.localStorage.clear();
    isPushSupported.mockReturnValue(true);
    needsHomeScreenInstall.mockReturnValue(false);
    fetchPushPublicKey.mockResolvedValue('key');
    getCurrentSubscription.mockResolvedValue(null);
    subscribeToPush.mockResolvedValue({});
    delete window.Notification;
  });

  afterEach(() => {
    jest.resetAllMocks();
    window.Notification = originalNotification;
  });

  test('default state shows the exact copy and both buttons', async () => {
    render(<AlertPrompt leagues={leagues} />);
    expect(await screen.findByRole('heading', { name: 'Get alerts on this phone' })).toBeInTheDocument();
    expect(screen.getByText(
      'Score changes, big plays and lineup problems, delivered to this device even when the app is closed.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable alerts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  test('install state shows the exact copy and only Not now', async () => {
    isPushSupported.mockReturnValue(false);
    needsHomeScreenInstall.mockReturnValue(true);
    render(<AlertPrompt leagues={leagues} />);
    expect(await screen.findByRole('heading', { name: 'Add to your Home Screen for alerts' })).toBeInTheDocument();
    expect(screen.getByText(
      'Tap Share, then Add to Home Screen. Open Endzone Empire from there and this card will offer the switch.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable alerts' })).not.toBeInTheDocument();
  });

  test('blocked state is one line with no buttons', async () => {
    window.Notification = { permission: 'denied' };
    render(<AlertPrompt leagues={leagues} />);
    expect(await screen.findByText(
      'Notifications are blocked for this site. Allow them in your browser settings to get alerts.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('renders nothing when the browser already holds a subscription', async () => {
    getCurrentSubscription.mockResolvedValue({ endpoint: 'e' });
    const { container } = render(<AlertPrompt leagues={leagues} />);
    await waitFor(() => expect(getCurrentSubscription).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('Enable alerts subscribes with the public key and hides the card on success', async () => {
    render(<AlertPrompt leagues={leagues} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable alerts' }));
    expect(subscribeToPush).toHaveBeenCalledWith('key');
    expect(screen.queryByTestId('alert-prompt')).not.toBeInTheDocument();
  });

  test('Enable alerts shows the error text and keeps the card on rejection', async () => {
    subscribeToPush.mockRejectedValue(new Error('Notification permission was not granted'));
    render(<AlertPrompt leagues={leagues} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable alerts' }));
    expect(await screen.findByText('Notification permission was not granted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable alerts' })).toBeInTheDocument();
  });

  test('Not now writes the dismissal and hides the card', async () => {
    render(<AlertPrompt leagues={leagues} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('alert-prompt')).not.toBeInTheDocument();
    expect(readAlertPromptDismissal().count).toBe(1);
    expect(readAlertPromptDismissal().at).toBeGreaterThan(0);
  });

  test('stays hidden on a device that dismissed it twice', async () => {
    writeAlertPromptDismissal({ count: 2, at: Date.now() - 30 * DAY });
    const { container } = render(<AlertPrompt leagues={leagues} />);
    await waitFor(() => expect(fetchPushPublicKey).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
