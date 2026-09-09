import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import DecideJoinRequest from './DecideJoinRequest';

/**
 * decide-join-request feature tests (#1109): the pair of buttons that decide
 * one pending join request. Owns the POST and its outcome only - re-reading
 * the queue is the widget's job, handed in as `onDecided`, the same split
 * `advance-week` draws with the panel that composes it.
 *
 * `teamName` is passed on every render below (as the widget always has one to
 * give) so the accessible name and the failure sentence both carry it - the
 * a11y risk review's fix for a bare "Approve"/"Deny" colliding with every
 * other pending row's buttons, and with CommissionerTools' own same-named
 * pair mounted on the console by default alongside this widget.
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
    <DecideJoinRequest
      leagueId={42}
      requestId={7}
      teamName="Gridiron Gang"
      onDecided={jest.fn()}
      {...props}
    />
  );

const approveButton = () => screen.getByRole('button', { name: "Approve Gridiron Gang's join request" });
const denyButton = () => screen.getByRole('button', { name: "Deny Gridiron Gang's join request" });

test('Approve posts { approve: true } to the decide endpoint', async () => {
  apiClient.post.mockResolvedValue({ data: { status: 'approved' } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(approveButton());

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/league/42/join-requests/7/decide',
    { approve: true }
  );
  await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  expect(onDecided).toHaveBeenCalledWith({ approve: true, teamName: 'Gridiron Gang' });
});

// The red-tell the ticket names by name: a copy-paste of the wrong boolean
// into the Approve handler must turn THIS assertion red, and no other. Deny
// is asserted separately below so a mistake in either handler is caught by
// exactly the test that names it.
test('Deny posts { approve: false } to the decide endpoint', async () => {
  apiClient.post.mockResolvedValue({ data: { status: 'denied' } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(denyButton());

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/league/42/join-requests/7/decide',
    { approve: false }
  );
  await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  expect(onDecided).toHaveBeenCalledWith({ approve: false, teamName: 'Gridiron Gang' });
});

// A bare "Approve"/"Deny" would collide with every other pending row's
// buttons (and with CommissionerTools' own same-named pair, mounted on the
// console by default alongside this widget) - so the accessible name has to
// carry the proposed Team name. The visible word still leads the name
// (WCAG 2.5.3 Label in Name), so voice control saying "click Approve" still
// resolves, ambiguity aside.
test('each button carries the Team name in its accessible name, leading with its visible word', () => {
  renderFeature();

  expect(screen.getByRole('button', { name: "Approve Gridiron Gang's join request" })).toHaveTextContent('Approve');
  expect(screen.getByRole('button', { name: "Deny Gridiron Gang's join request" })).toHaveTextContent('Deny');
});

test('without a teamName the buttons fall back to a working, bare accessible name', () => {
  renderFeature({ teamName: undefined });

  expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
});

test('both buttons stay focusable and aria-disabled (never native disabled) while in flight', async () => {
  let resolvePost;
  apiClient.post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
  renderFeature();

  approveButton().focus();
  await userEvent.click(approveButton());

  // The native `disabled` attribute is never set: setting it on the element
  // that was just activated forces the browser to blur it (the HTML focus
  // fixup rule), which is exactly the focus-loss the a11y review flagged.
  expect(approveButton()).not.toBeDisabled();
  expect(approveButton()).toHaveAttribute('aria-disabled', 'true');
  expect(denyButton()).toHaveAttribute('aria-disabled', 'true');
  // Focus survives the click because nothing was disabled out from under it.
  expect(approveButton()).toHaveFocus();

  resolvePost({ data: { status: 'approved' } });
  await waitFor(() => expect(approveButton()).not.toHaveAttribute('aria-disabled'));
});

test('a second activation while busy fires only one POST', async () => {
  // `pointer-events: none` already stops a real mouse from clicking a busy
  // button (userEvent's own pointer check refuses the interaction, which is
  // the CSS half doing its job); a keyboard/AT activation on a focused,
  // still-not-disabled button is not gated by that CSS at all (see the
  // component's own docblock), so `fireEvent.click` here stands in for that
  // path and is what actually exercises the `busy` guard in `decide`.
  let resolvePost;
  apiClient.post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
  renderFeature();

  const button = approveButton();
  await userEvent.click(button);
  fireEvent.click(button);

  expect(apiClient.post).toHaveBeenCalledTimes(1);
  resolvePost({ data: { status: 'approved' } });
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
});

test('a 409 refusal renders the server sentence inline, prefixed with the Team name, and does not call onDecided', async () => {
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: 'league is full' } } });
  const onDecided = jest.fn();
  renderFeature({ onDecided });

  await userEvent.click(approveButton());

  expect(await screen.findByRole('alert')).toHaveTextContent("Gridiron Gang: league is full");
  expect(onDecided).not.toHaveBeenCalled();
  // The button re-enables so the commissioner can retry (or decide the other way).
  expect(approveButton()).not.toHaveAttribute('aria-disabled');
});

test('a failure with no server sentence and no err.message falls back to local copy', async () => {
  // Neither a response body readHttpFailure can read a sentence from, nor an
  // `err.message` of its own - the one shape that reaches the feature's own
  // fallback rather than either upstream one.
  apiClient.post.mockRejectedValue({});
  renderFeature();

  await userEvent.click(denyButton());

  expect(await screen.findByRole('alert')).toHaveTextContent('Gridiron Gang: Could not record that decision.');
});
