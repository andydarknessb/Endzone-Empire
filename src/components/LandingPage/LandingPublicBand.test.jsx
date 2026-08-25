import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import publicApiClient from '../../api/publicApiClient';
import LandingPublicBand from './LandingPublicBand';

jest.mock('../../api/publicApiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

function mockEndpoints({ rankings, recaps, fail = false }) {
  publicApiClient.get.mockImplementation((url) => {
    if (fail) return Promise.reject(new Error('network'));
    if (url.includes('/rankings')) return Promise.resolve({ data: { rankings } });
    if (url.includes('/recaps')) return Promise.resolve({ data: { recaps } });
    return Promise.resolve({ data: {} });
  });
}

afterEach(() => jest.clearAllMocks());

describe('LandingPublicBand', () => {
  it('renders live rankings and recaps teasers plus static strategy', async () => {
    mockEndpoints({
      rankings: [{ playerId: 9, rank: 1, name: 'Star Back', projectedPoints: 22.4 }],
      recaps: [{ gameId: 'g1', week: 3, homeTeam: 'BUF', awayTeam: 'KC', homeScore: 24, awayScore: 27, hook: 'KC edged BUF.' }],
    });
    render(<LandingPublicBand />);

    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(await screen.findByText('Top rankings')).toBeInTheDocument();
    expect(screen.getByText('Star Back')).toBeInTheDocument();
    expect(await screen.findByText('Latest recaps')).toBeInTheDocument();
    expect(screen.getByText('Strategy')).toBeInTheDocument(); // static, always present

    // Public links are plain <a href> (cross into the public BrowserRouter).
    expect(screen.getByRole('link', { name: /Star Back/ })).toHaveAttribute('href', '/players/9');
  });

  it('advertises the mock draft simulator as a free tool', async () => {
    mockEndpoints({ rankings: [], recaps: [] });
    render(<LandingPublicBand />);
    expect(
      screen.getByRole('link', { name: 'Try the Mock Draft Simulator' })
    ).toHaveAttribute('href', '/draft-simulator');
    await waitFor(() => expect(publicApiClient.get).toHaveBeenCalled());
  });

  it('degrades gracefully: a failed fetch hides that teaser but never breaks the band', async () => {
    mockEndpoints({ fail: true });
    render(<LandingPublicBand />);

    // The band and the static strategy teaser always render...
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.getByText('Strategy')).toBeInTheDocument();

    // ...and the data teasers are simply absent after the fetch fails.
    await waitFor(() => expect(publicApiClient.get).toHaveBeenCalled());
    expect(screen.queryByText('Top rankings')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest recaps')).not.toBeInTheDocument();
  });
});
