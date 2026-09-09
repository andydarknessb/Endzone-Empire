import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import DecideJoinRequest from './DecideJoinRequest';

/**
 * decide-join-request feature tests (#1109): the pair of buttons that decide
 * one pending join request. Owns the POST and its outcome only - re-reading
 * the queue is the widget's job, handed in as `onDecided`, the same split
 * `advance-week` draws with the panel that composes it.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const renderFeature = (props = {}) =>
  render(
    <DecideJoinRequest leagueId={42} requestId={7} onDecided={jest.fn()} {...props} />
  );

test('Approve posts { approve: true } to the decide endpoint', async () => {
  apiClient.post.mockResolvedValue({ data: { status: 'approved' } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/league/42/join-requests/7/decide',
    { approve: true }
  );
  await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
});

// The red-tell the ticket names by name: a copy-paste of the wrong boolean
// into the Approve handler must turn THIS assertion red, and no other. Deny
// is asserted separately below so a mistake in either handler is caught by
// exactly the test that names it.
test('Deny posts { approve: false } to the decide endpoint', async () => {
  apiClient.post.mockResolvedValue({ data: { status: 'denied' } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/league/42/join-requests/7/decide',
    { approve: false }
  );
  await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
});

test('both buttons disable while the decision is in flight', async () => {
  let resolvePost;
  apiClient.post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
  renderFeature();

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();

  resolvePost({ data: { status: 'approved' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled());
});

test('a 409 refusal renders the server sentence inline and does not call onDecided', async () => {
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: 'league is full' } } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('league is full');
  expect(onDecided).not.toHaveBeenCalled();
  // The button re-enables so the commissioner can retry (or decide the other way).
  expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled();
});

test('a failure with no server sentence and no err.message falls back to local copy', async () => {
  // Neither a response body readHttpFailure can read a sentence from, nor an
  // `err.message` of its own - the one shape that reaches the feature's own
  // fallback rather than either upstream one.
  apiClient.post.mockRejectedValue({});
  renderFeature();

  await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not record that decision.');
});
