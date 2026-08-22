import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import ResetPassword from './ResetPassword';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const renderPage = (route = '/reset-password?token=abc123') =>
  renderWithProviders(<ResetPassword />, { path: '/reset-password', route });

afterEach(() => {
  jest.clearAllMocks();
});

test('warns when the token is missing from the URL', () => {
  renderPage('/reset-password');
  expect(screen.getByText(/Missing reset token/)).toBeInTheDocument();
  expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
});

test('submits the token and new password, then shows success', async () => {
  apiClient.post.mockResolvedValue({ data: { ok: true } });
  renderPage();

  await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'newpassword1');
  await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/reset-password', {
      token: 'abc123',
      password: 'newpassword1',
    })
  );
  expect(await screen.findByText(/Password updated/)).toBeInTheDocument();
});

test('disables submit for short or mismatched passwords', async () => {
  renderPage();
  const button = screen.getByRole('button', { name: 'Reset Password' });

  await userEvent.type(screen.getByLabelText('New Password'), 'short');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'short');
  expect(button).toBeDisabled();

  await userEvent.clear(screen.getByLabelText('New Password'));
  await userEvent.type(screen.getByLabelText('New Password'), 'longenough1');
  expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  expect(button).toBeDisabled();
});

test('surfaces an invalid-token server error', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'invalid or expired reset token' } } });
  renderPage();

  await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'newpassword1');
  await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  expect(await screen.findByText('invalid or expired reset token')).toBeInTheDocument();
});
