import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LoginPage from './LoginPage';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

afterEach(() => {
  mockNavigate.mockClear();
});

test('renders the embedded LoginForm', () => {
  renderWithProviders(<LoginPage />);
  expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
});

test('clicking "Register" navigates to /registration', async () => {
  renderWithProviders(<LoginPage />);

  await userEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(mockNavigate).toHaveBeenCalledWith('/registration');
});
