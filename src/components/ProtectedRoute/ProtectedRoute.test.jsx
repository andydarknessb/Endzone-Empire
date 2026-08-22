import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import ProtectedRoute from './ProtectedRoute';

test('renders the protected children when a user is logged in', () => {
  renderWithProviders(
    <ProtectedRoute>
      <div>Secret Content</div>
    </ProtectedRoute>,
    { state: { user: { id: 1, username: 'alice' } } }
  );

  expect(screen.getByText('Secret Content')).toBeInTheDocument();
});

test('renders LoginPage instead of the children when no user is logged in', () => {
  renderWithProviders(
    <ProtectedRoute>
      <div>Secret Content</div>
    </ProtectedRoute>,
    { state: { user: {} } }
  );

  expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  // LoginPage renders LoginForm, which has a "Login" heading
  expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
});
