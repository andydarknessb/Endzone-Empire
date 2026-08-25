import React from 'react';
import { render, screen } from '@testing-library/react';

import RootRouter from './RootRouter';

// Stub both trees so this test exercises only RootRouter's decision, not the
// full authed app or the lazy public bundle.
jest.mock('./App', () => () => <div>AUTHED APP</div>);
jest.mock('../public/PublicApp', () => () => <div>PUBLIC APP</div>);

/**
 * §5 dual-router hard-refresh guarantee: loading a deep public URL directly
 * (a hard refresh / shared link, where the browser's real pathname is the
 * public path, not "/") must mount the public shell — never the authed app.
 */
describe('RootRouter dual-router shell', () => {
  it('mounts the public shell on a hard refresh of a deep public path', () => {
    window.history.pushState({}, '', '/players/12345');
    render(<RootRouter />);
    expect(screen.getByText('PUBLIC APP')).toBeInTheDocument();
    expect(screen.queryByText('AUTHED APP')).not.toBeInTheDocument();
  });

  it('mounts the public shell for /recaps/:gameId and /strategy/:slug', () => {
    window.history.pushState({}, '', '/recaps/20260112_KC@BUF');
    const { unmount } = render(<RootRouter />);
    expect(screen.getByText('PUBLIC APP')).toBeInTheDocument();
    unmount();

    window.history.pushState({}, '', '/strategy/draft-by-tiers');
    render(<RootRouter />);
    expect(screen.getByText('PUBLIC APP')).toBeInTheDocument();
  });

  it('mounts the public shell for the mock draft simulator', () => {
    window.history.pushState({}, '', '/draft-simulator');
    render(<RootRouter />);
    expect(screen.getByText('PUBLIC APP')).toBeInTheDocument();
    expect(screen.queryByText('AUTHED APP')).not.toBeInTheDocument();
  });

  it('mounts the authed app for a non-public path', () => {
    window.history.pushState({}, '', '/');
    render(<RootRouter />);
    expect(screen.getByText('AUTHED APP')).toBeInTheDocument();
    expect(screen.queryByText('PUBLIC APP')).not.toBeInTheDocument();
  });
});
