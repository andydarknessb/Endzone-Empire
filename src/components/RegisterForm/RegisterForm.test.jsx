import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import RegisterForm from './RegisterForm';

test('renders the registration form fields and submit button', () => {
  renderWithProviders(<RegisterForm />);

  expect(screen.getByRole('heading', { name: /build your dream team today/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
});

test('the submit button is the house MUI Button, not the legacy .btn class', () => {
  renderWithProviders(<RegisterForm />);

  const submitButton = screen.getByRole('button', { name: 'Register' });
  expect(submitButton).toHaveAttribute('type', 'submit');
  expect(submitButton.className).toMatch(/MuiButton-root/);
  expect(submitButton.className).not.toMatch(/\bbtn\b/);
});

test('shows the registrationMessage from redux state as an alert', () => {
  renderWithProviders(<RegisterForm />, {
    state: { errors: { registrationMessage: 'Choose a username and password!' } },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a username and password!');
});

test('does not show an error alert when there is no registrationMessage', () => {
  renderWithProviders(<RegisterForm />, { state: { errors: { registrationMessage: '' } } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('submitting the filled form dispatches REGISTER with username, email, and password', async () => {
  const { store } = renderWithProviders(<RegisterForm />);

  await userEvent.type(screen.getByLabelText(/username/i), 'bob');
  await userEvent.type(screen.getByLabelText(/email/i), 'bob@test.local');
  await userEvent.type(screen.getByLabelText(/password/i), 'pw123456');
  await userEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(store.getActions()).toContainEqual({
    type: 'REGISTER',
    payload: { username: 'bob', email: 'bob@test.local', password: 'pw123456' },
  });
});
