import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LoginForm from './LoginForm';

test('renders the login form fields and submit button', () => {
  renderWithProviders(<LoginForm />);

  expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument();
});

test('does not show an error alert when there is no loginMessage', () => {
  renderWithProviders(<LoginForm />, { state: { errors: { loginMessage: '' } } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows the loginMessage from redux state as an alert', () => {
  renderWithProviders(<LoginForm />, {
    state: { errors: { loginMessage: "Oops! The username and password didn't match. Try again!" } },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    "Oops! The username and password didn't match. Try again!"
  );
});

test('typing updates the username and password fields', async () => {
  renderWithProviders(<LoginForm />);

  const usernameInput = screen.getByLabelText(/username/i);
  const passwordInput = screen.getByLabelText(/password/i);

  await userEvent.type(usernameInput, 'alice');
  await userEvent.type(passwordInput, 'hunter2');

  expect(usernameInput).toHaveValue('alice');
  expect(passwordInput).toHaveValue('hunter2');
});

test('submitting with both fields filled dispatches LOGIN with the entered credentials', async () => {
  const { store } = renderWithProviders(<LoginForm />);

  await userEvent.type(screen.getByLabelText(/username/i), 'alice');
  await userEvent.type(screen.getByLabelText(/password/i), 'hunter2');
  await userEvent.click(screen.getByRole('button', { name: 'Log In' }));

  expect(store.getActions()).toContainEqual({
    type: 'LOGIN',
    payload: { username: 'alice', password: 'hunter2' },
  });
});

test('submitting with empty fields dispatches LOGIN_INPUT_ERROR instead', () => {
  // The inputs are HTML-required, so a real click on the submit button would
  // be blocked by the browser's own constraint validation before our handler
  // ever runs. Firing the form's submit event directly exercises the
  // component's own empty-fields branch instead of the browser's gate.
  const { container, store } = renderWithProviders(<LoginForm />);

  fireEvent.submit(container.querySelector('form'));

  expect(store.getActions()).toContainEqual({ type: 'LOGIN_INPUT_ERROR' });
});
