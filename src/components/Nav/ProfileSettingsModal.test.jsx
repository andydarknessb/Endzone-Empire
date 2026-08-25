import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import apiClient from '../../api/apiClient';
import { TEAM_PROFILE_UPDATED_EVENT } from '../../lib/teamProfileEvents';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import ProfileSettingsModal from './ProfileSettingsModal';

jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector) => selector({ user: { id: 1, username: 'alice' } }),
}));

let mock;
let teamProfileUpdates;
let handleTeamProfileUpdate;

// Convention for this file (#263): userEvent calls are never re-wrapped in
// act(). user-event already runs each interaction inside act() and drains the
// queue before it resolves, and an outer act() would still be open while
// user-event's own async wrapper clears IS_REACT_ACT_ENVIRONMENT, so every
// update landing in that window is reported as "the current testing
// environment is not configured to support act". Work that outlives an
// interaction (the avatar POST and the toast behind it) is awaited at the call
// site instead.
const setupUser = () => userEvent.setup();

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  teamProfileUpdates = [];
  handleTeamProfileUpdate = (event) => teamProfileUpdates.push(event.detail);
  window.addEventListener(TEAM_PROFILE_UPDATED_EVENT, handleTeamProfileUpdate);
  window.URL.createObjectURL = jest.fn(() => 'blob:preview');
  window.URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  window.removeEventListener(TEAM_PROFILE_UPDATED_EVENT, handleTeamProfileUpdate);
  mock.restore();
});

const league = {
  id: 1,
  name: 'Sunday League',
  my_team_id: 5,
  my_team_name: "Alice's Team",
  my_team_avatar_url: null,
  my_team_avatar_static_url: null,
};

test('shows the avatar uploader for the selected league', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={jest.fn()} />);

  await user.click(await screen.findByLabelText('League'));
  await user.click(await screen.findByRole('option', { name: /Sunday League/ }));

  expect(await screen.findByText(/Team avatar for Alice's Team/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Change Alice's Team avatar/i })).toBeInTheDocument();
});

test('does not show the avatar uploader before a league is selected', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  render(<ProfileSettingsModal open onClose={jest.fn()} />);
  await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0));
  expect(screen.queryByText(/Team avatar for/)).not.toBeInTheDocument();
});

async function selectLeague(user) {
  await user.click(await screen.findByLabelText('League'));
  await user.click(await screen.findByRole('option', { name: /Sunday League/ }));
  await screen.findByText(/Team avatar for Alice's Team/);
}

test('avatar-only change enables the button and saves just the avatar', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPost('/api/team/5/avatar').reply(200, { id: 5, avatar_url: 'https://x/logo.png', avatar_static_url: null });
  const onClose = jest.fn();
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={onClose} />);

  await selectLeague(user);

  // With no name typed, the submit button is disabled until an avatar is staged.
  const submit = screen.getByRole('button', { name: /^(Save|Rename)$/ });
  expect(submit).toBeDisabled();

  const input = document.querySelector('input[type="file"]');
  const file = new File(['bytes'], 'logo.png', { type: 'image/png' });
  await user.upload(input, file);

  // Staging a file does not upload yet — it just enables "Save".
  expect(mock.history.post).toHaveLength(0);
  const saveBtn = await screen.findByRole('button', { name: 'Save' });
  expect(saveBtn).toBeEnabled();

  await user.click(saveBtn);

  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  expect(mock.history.post[0].url).toBe('/api/team/5/avatar');
  expect(mock.history.put).toHaveLength(0); // no rename
  expect(teamProfileUpdates).toContainEqual({
    leagueId: 1,
    teamId: 5,
    avatarUrl: 'https://x/logo.png',
    avatarStaticUrl: null,
  });
  expect(onClose).toHaveBeenCalled();
});

test('name-only change still renames the team', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPut('/api/team/5').reply(200, { id: 5 });
  const onClose = jest.fn();
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={onClose} />);

  await selectLeague(user);

  await user.type(screen.getByLabelText('New Team Name'), 'Bandits');
  const renameBtn = await screen.findByRole('button', { name: 'Rename' });
  expect(renameBtn).toBeEnabled();

  await user.click(renameBtn);

  await waitFor(() => expect(mock.history.put).toHaveLength(1));
  expect(mock.history.put[0].url).toBe('/api/team/5');
  expect(JSON.parse(mock.history.put[0].data)).toEqual({ name: 'Bandits' });
  expect(mock.history.post).toHaveLength(0); // no avatar upload
  expect(onClose).toHaveBeenCalled();
});

test('name and avatar changed together fire both requests', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPost('/api/team/5/avatar').reply(200, { id: 5, avatar_url: 'https://x/logo.png', avatar_static_url: null });
  mock.onPut('/api/team/5').reply(200, { id: 5 });
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={jest.fn()} />);

  await selectLeague(user);

  await user.type(screen.getByLabelText('New Team Name'), 'Bandits');
  const input = document.querySelector('input[type="file"]');
  await user.upload(input, new File(['bytes'], 'logo.png', { type: 'image/png' }));

  await user.click(await screen.findByRole('button', { name: 'Save' }));

  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  expect(mock.history.post[0].url).toBe('/api/team/5/avatar');
  await waitFor(() => expect(mock.history.put).toHaveLength(1));
  expect(mock.history.put[0].url).toBe('/api/team/5');
});

// M1: when both changes are staged and only one request fails, the other is
// already persisted — spell out both outcomes and keep the dialog open to retry.
test('partial failure: avatar fails while name saves — reports both, dialog stays open', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPost('/api/team/5/avatar').reply(500, { error: 'storage offline' });
  mock.onPut('/api/team/5').reply(200, { id: 5, name: 'Bandits' });
  const onClose = jest.fn();
  const user = setupUser();
  render(
    <SnackbarProvider>
      <ProfileSettingsModal open onClose={onClose} />
    </SnackbarProvider>
  );

  await selectLeague(user);
  await user.type(screen.getByLabelText('New Team Name'), 'Bandits');
  const input = document.querySelector('input[type="file"]');
  await user.upload(input, new File(['bytes'], 'logo.png', { type: 'image/png' }));

  await user.click(await screen.findByRole('button', { name: 'Save' }));

  // Both requests fired independently, and the toast names each outcome.
  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  await waitFor(() => expect(mock.history.put).toHaveLength(1));
  expect(
    await screen.findByText('avatar save failed (storage offline); name saved')
  ).toBeInTheDocument();
  expect(teamProfileUpdates).toEqual([{ leagueId: 1, teamId: 5, name: 'Bandits' }]);
  // The failed part is retryable, so the dialog does not close.
  expect(onClose).not.toHaveBeenCalled();
});

// L1: the state-based guard let a fast double-click through because `saving`
// hadn't re-rendered yet. The useRef latch blocks the second click synchronously.
test('a rapid double-click fires only one save request', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPut('/api/team/5').reply(200, { id: 5, name: 'Bandits' });
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={jest.fn()} />);

  await selectLeague(user);
  await user.type(screen.getByLabelText('New Team Name'), 'Bandits');
  const renameBtn = await screen.findByRole('button', { name: 'Rename' });

  // Two clicks in the same tick, before React can re-render to disable the button.
  fireEvent.click(renameBtn);
  fireEvent.click(renameBtn);

  // Both handler calls ran synchronously, so a duplicate request (if any) is
  // already recorded by now — assert exactly one.
  await waitFor(() => expect(mock.history.put.length).toBeGreaterThan(0));
  expect(mock.history.put).toHaveLength(1);
});

// Deferred-staging edge case: stage a file, remove it, then stage a different
// file. The last action must win — an upload of the new file, not a stale delete.
test('staging a file, removing, then picking another file uploads the last file', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPost('/api/team/5/avatar').reply(200, { id: 5, avatar_url: 'https://x/second.png', avatar_static_url: null });
  mock.onDelete('/api/team/5/avatar').reply(200, { id: 5, avatar_url: null, avatar_static_url: null });
  const onClose = jest.fn();
  const user = setupUser();
  render(<ProfileSettingsModal open onClose={onClose} />);

  await selectLeague(user);

  const input = document.querySelector('input[type="file"]');
  await user.upload(input, new File(['a'], 'first.png', { type: 'image/png' }));
  // Remove the just-staged file...
  await user.click(await screen.findByRole('button', { name: /Remove Alice's Team avatar/i }));
  expect(screen.getByRole('dialog', { name: /Remove team logo/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove logo' }));
  // ...then stage a different one in its place.
  await user.upload(input, new File(['bcd'], 'second.png', { type: 'image/png' }));

  await user.click(await screen.findByRole('button', { name: 'Save' }));

  // One upload, and crucially no stale DELETE from the intermediate removal.
  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  expect(mock.history.delete).toHaveLength(0);
  expect(onClose).toHaveBeenCalled();
});
