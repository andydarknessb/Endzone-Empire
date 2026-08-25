import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import apiClient from '../../api/apiClient';
import TeamAvatarUploader from './TeamAvatarUploader';

let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  window.URL.createObjectURL = jest.fn(() => 'blob:preview');
  window.URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  mock.restore();
  jest.restoreAllMocks();
});

function pngFile(name = 'logo.png') {
  return new File(['fake-bytes'], name, { type: 'image/png' });
}

test('uploads a selected file and reports the updated team', async () => {
  const user = userEvent.setup();
  mock.onPost('/api/team/5/avatar').reply(200, { id: 5, avatar_url: 'https://x/logo.png', avatar_static_url: null });
  const onUpdated = jest.fn();
  render(<TeamAvatarUploader teamId={5} teamName="Sunday Ballers" avatarUrl={null} onUpdated={onUpdated} />);

  const input = screen.getByTestId('team-avatar-file-input');
  await user.upload(input, pngFile());

  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(
    expect.objectContaining({ avatar_url: 'https://x/logo.png' })
  ));
});

test('rejects an unsupported file type client-side without calling the API', async () => {
  // The input's accept attribute stops most native pickers from offering a
  // mismatched file, but drag-and-drop doesn't honor accept — so the JS
  // check is exercised directly here via fireEvent (bypassing user-event's
  // accept-attribute filtering) rather than through the native file dialog.
  const onUpdated = jest.fn();
  render(<TeamAvatarUploader teamId={5} teamName="Sunday Ballers" avatarUrl={null} onUpdated={onUpdated} />);

  const input = screen.getByTestId('team-avatar-file-input');
  const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [textFile] });
  fireEvent.change(input);

  expect(await screen.findByText(/must be a png, jpeg, webp, or gif/i)).toBeInTheDocument();
  expect(onUpdated).not.toHaveBeenCalled();
  expect(mock.history.post.length).toBe(0);
});

test('rejects an oversized file client-side without calling the API', async () => {
  const user = userEvent.setup();
  const onUpdated = jest.fn();
  render(<TeamAvatarUploader teamId={5} teamName="Sunday Ballers" avatarUrl={null} onUpdated={onUpdated} />);

  const input = screen.getByTestId('team-avatar-file-input');
  const big = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
  await user.upload(input, big);

  expect(await screen.findByText(/too large/i)).toBeInTheDocument();
  expect(onUpdated).not.toHaveBeenCalled();
  expect(mock.history.post.length).toBe(0);
});

test('shows the server error message when the upload fails', async () => {
  const user = userEvent.setup();
  mock.onPost('/api/team/5/avatar').reply(400, { error: 'unsupported file type' });
  render(<TeamAvatarUploader teamId={5} teamName="Sunday Ballers" avatarUrl={null} />);

  const input = screen.getByTestId('team-avatar-file-input');
  await user.upload(input, pngFile());

  expect(await screen.findByText('unsupported file type')).toBeInTheDocument();
});

test('confirms before removing the avatar', async () => {
  const user = userEvent.setup();
  mock.onDelete('/api/team/5/avatar').reply(200, { id: 5, avatar_url: null, avatar_static_url: null });
  const onUpdated = jest.fn();
  render(
    <TeamAvatarUploader
      teamId={5}
      teamName="Sunday Ballers"
      avatarUrl="https://x/logo.png"
      onUpdated={onUpdated}
    />
  );

  await user.click(screen.getByRole('button', { name: /remove sunday ballers avatar/i }));
  expect(screen.getByRole('dialog', { name: /remove team logo/i })).toBeInTheDocument();
  expect(mock.history.delete).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: /^remove logo$/i }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(
    expect.objectContaining({ avatar_url: null })
  ));
});

test('the remove affordance is not shown when there is no avatar to remove', () => {
  render(<TeamAvatarUploader teamId={5} teamName="Sunday Ballers" avatarUrl={null} />);
  expect(screen.queryByRole('button', { name: /remove sunday ballers avatar/i })).not.toBeInTheDocument();
});
