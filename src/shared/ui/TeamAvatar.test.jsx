import React from 'react';
import { render, screen } from '@testing-library/react';
import TeamAvatar from './TeamAvatar';

let matchMediaMatches = false;
beforeEach(() => {
  matchMediaMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

test('renders initials when no avatar is set', () => {
  render(<TeamAvatar name="Sunday Ballers" />);
  expect(screen.getByText('SB')).toBeInTheDocument();
});

test('falls back to "?" for a missing/empty name', () => {
  render(<TeamAvatar name="" />);
  expect(screen.getByText('?')).toBeInTheDocument();
});

test('renders the animated avatar by default when both URLs are present', () => {
  render(
    <TeamAvatar
      name="Sunday Ballers"
      avatarUrl="https://example.com/animated.gif"
      avatarStaticUrl="https://example.com/static.png"
    />
  );
  // hidden: true because TeamAvatar deliberately omits `alt` - see the
  // comment on Avatar in TeamAvatar.jsx (#327).
  const img = screen.getByRole('img', { hidden: true });
  expect(img).toHaveAttribute('src', 'https://example.com/animated.gif');
});

test('renders the static frame instead when prefers-reduced-motion is on and a static URL exists', () => {
  matchMediaMatches = true;
  render(
    <TeamAvatar
      name="Sunday Ballers"
      avatarUrl="https://example.com/animated.gif"
      avatarStaticUrl="https://example.com/static.png"
    />
  );
  // hidden: true - see the comment on Avatar in TeamAvatar.jsx (#327).
  const img = screen.getByRole('img', { hidden: true });
  expect(img).toHaveAttribute('src', 'https://example.com/static.png');
});

test('falls back to the animated URL under prefers-reduced-motion when no static variant exists (static uploads)', () => {
  matchMediaMatches = true;
  render(<TeamAvatar name="Sunday Ballers" avatarUrl="https://example.com/logo.png" avatarStaticUrl={null} />);
  // hidden: true - see the comment on Avatar in TeamAvatar.jsx (#327).
  const img = screen.getByRole('img', { hidden: true });
  expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
});

test('a falsy-but-present (empty string) static URL falls through to the animated URL under reduced motion (#446 helper extraction)', () => {
  // Guards the coercion at the seam: the shared shouldShowStillFrame uses the
  // TRUTHINESS of the static URL (Boolean(reduced && hasStill)), so an empty
  // string is falsy and reduced-motion viewers get the animated URL, not a
  // blank "" src. A `!= null` derivation would have selected "" here - a silent
  // blank-avatar regression on a path only reduced-motion viewers see. This case
  // is not otherwise covered, so the refactor's green would not have caught it.
  matchMediaMatches = true;
  render(<TeamAvatar name="Sunday Ballers" avatarUrl="https://example.com/logo.png" avatarStaticUrl="" />);
  const img = screen.getByRole('img', { hidden: true });
  expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
});
