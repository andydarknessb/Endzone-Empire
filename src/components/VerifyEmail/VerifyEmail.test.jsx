import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import VerifyEmail from './VerifyEmail';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const renderPage = (route = '/verify-email?token=tok1') =>
  renderWithProviders(<VerifyEmail />, { path: '/verify-email', route });

afterEach(() => {
  jest.clearAllMocks();
});

test('verifies the token on mount and shows success', async () => {
  apiClient.post.mockResolvedValue({ data: { ok: true } });
  renderPage();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/verify-email', { token: 'tok1' })
  );
  expect(await screen.findByText(/Email verified/)).toBeInTheDocument();
});

test('shows the server error when verification fails', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'invalid or expired verification token' } } });
  renderPage();

  expect(await screen.findByText('invalid or expired verification token')).toBeInTheDocument();
});

test('warns when the token is missing and never calls the API', () => {
  renderPage('/verify-email');
  expect(screen.getByText(/Missing verification token/)).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
});
