import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import DraftCentralCard from './DraftCentralCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('stays hidden when the user commissions no pending or active drafts', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<DraftCentralCard />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/draft/mine'));
  expect(screen.queryByRole('heading', { name: 'Draft Central' })).not.toBeInTheDocument();
});

test('shows live, scheduled, and unscheduled commissioner drafts with progress and links', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { id: 1, name: 'Live League', draft_status: 'active', roster_limit: 15, team_count: 10, picks_made: 37 },
      { id: 2, name: 'Scheduled League', draft_status: 'pending', draft_date: '2099-09-01T12:00:00.000Z', roster_limit: 10, team_count: 8, picks_made: 0 },
      { id: 3, name: 'Open League', draft_status: 'pending', draft_date: null, roster_limit: 10, team_count: 0, picks_made: 0 },
    ],
  });
  renderWithProviders(<DraftCentralCard />);

  expect(await screen.findByRole('heading', { name: 'Draft Central' })).toBeInTheDocument();
  expect(screen.getByText('Live now')).toBeInTheDocument();
  expect(screen.getByText('Scheduled')).toBeInTheDocument();
  expect(screen.getByText('Needs scheduling')).toBeInTheDocument();
  expect(screen.getByText('37 / 150 picks')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Draft Room' })[0]).toHaveAttribute('href', '/league/1/draft');
  expect(screen.getAllByRole('link', { name: 'Settings' })[1]).toHaveAttribute('href', '/league/2/draft-settings');
});
