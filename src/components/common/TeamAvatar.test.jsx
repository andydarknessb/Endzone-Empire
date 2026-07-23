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
  const img = document.querySelector('img');
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
  const img = document.querySelector('img');
  expect(img).toHaveAttribute('src', 'https://example.com/static.png');
});

test('falls back to the animated URL under prefers-reduced-motion when no static variant exists (static uploads)', () => {
  matchMediaMatches = true;
  render(<TeamAvatar name="Sunday Ballers" avatarUrl="https://example.com/logo.png" avatarStaticUrl={null} />);
  const img = document.querySelector('img');
  expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
});
