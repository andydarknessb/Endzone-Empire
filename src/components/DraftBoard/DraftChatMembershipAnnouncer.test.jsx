import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftChatMembershipAnnouncer from './DraftChatMembershipAnnouncer';

// The announcer is one persistent, polite live region whose text changes only on
// the membership edge (#534 a11y finding 3): it lives in the chrome so a tab
// switch never remounts it, and it re-renders in place across membership values.

test('is a polite live region', () => {
  render(<DraftChatMembershipAnnouncer membership="unknown" />);
  const region = screen.getByRole('status');
  expect(region).toHaveAttribute('aria-live', 'polite');
});

test('stays silent before membership is decided and while the viewer is a member', () => {
  const { rerender } = render(<DraftChatMembershipAnnouncer membership="unknown" />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();

  rerender(<DraftChatMembershipAnnouncer membership="member" />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('speaks the loss once membership becomes non_member, matching the visible surface copy', () => {
  const { rerender } = render(<DraftChatMembershipAnnouncer membership="member" />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();

  // The edge: the same node gains the notice, so a live region already being
  // observed announces the change (and only this change).
  rerender(<DraftChatMembershipAnnouncer membership="non_member" />);
  expect(screen.getByRole('status')).toHaveTextContent('League chat is available to league members only.');
});

test('falls silent again if the viewer is re-added mid-draft', () => {
  const { rerender } = render(<DraftChatMembershipAnnouncer membership="non_member" />);
  expect(screen.getByRole('status')).toHaveTextContent('League chat is available to league members only.');

  rerender(<DraftChatMembershipAnnouncer membership="member" />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});
