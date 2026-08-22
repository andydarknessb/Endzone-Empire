import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import ForgotPassword from './ForgotPassword';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('submits the trimmed email and shows the server message', async () => {
  apiClient.post.mockResolvedValue({ data: { ok: true, message: 'Check your inbox.' } });
  renderWithProviders(<ForgotPassword />);

  await userEvent.type(screen.getByLabelText('Email'), '  cory@example.com  ');
  await userEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/forgot-password', {
      email: 'cory@example.com',
    })
  );
  expect(await screen.findByText('Check your inbox.')).toBeInTheDocument();
});

test('the submit button is disabled until an email is entered', () => {
  renderWithProviders(<ForgotPassword />);
  expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeDisabled();
});

test('surfaces server errors', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'rate limited' } } });
  renderWithProviders(<ForgotPassword />);

  await userEvent.type(screen.getByLabelText('Email'), 'x@y.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

  expect(await screen.findByText('rate limited')).toBeInTheDocument();
});
