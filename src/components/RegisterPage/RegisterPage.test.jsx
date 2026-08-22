import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import RegisterPage from './RegisterPage';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

afterEach(() => {
  mockNavigate.mockClear();
});

test('renders the embedded RegisterForm', () => {
  renderWithProviders(<RegisterPage />);
  expect(screen.getByRole('heading', { name: /build your dream team today/i })).toBeInTheDocument();
});

test('clicking "Login" navigates to /login', async () => {
  renderWithProviders(<RegisterPage />);

  await userEvent.click(screen.getByRole('button', { name: 'Login' }));

  expect(mockNavigate).toHaveBeenCalledWith('/login');
});
