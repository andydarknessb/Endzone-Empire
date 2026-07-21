import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import apiClient from '../../api/apiClient';
import ProfileSettingsModal from './ProfileSettingsModal';

let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  window.URL.createObjectURL = jest.fn(() => 'blob:preview');
  window.URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
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
  const user = userEvent.setup();
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
  const user = userEvent.setup();
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
  expect(onClose).toHaveBeenCalled();
});

test('name-only change still renames the team', async () => {
  mock.onGet('/api/league').reply(200, [league]);
  mock.onPut('/api/team/5').reply(200, { id: 5 });
  const onClose = jest.fn();
  const user = userEvent.setup();
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
  const user = userEvent.setup();
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
