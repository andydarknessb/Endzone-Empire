import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import DraftGradesCard from './DraftGradesCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const gradesResponse = () => ({
  data: {
    computedAt: '2026-07-10T00:00:00.000Z',
    grades: [
      { teamId: 1, name: 'Sunday Ballers', grade: 'A', rosterValue: 240.5, rank: 1 },
      { teamId: 2, name: "Bob's Team", grade: 'C', rosterValue: 190.2, rank: 2 },
    ],
  },
});

test('renders draft grades for each team', async () => {
  apiClient.get.mockResolvedValue(gradesResponse());

  renderWithProviders(<DraftGradesCard leagueId={1} />);

  expect(await screen.findByTestId('draft-grades-card')).toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText("Bob's Team")).toBeInTheDocument();
  expect(screen.getByText('A')).toBeInTheDocument();
  expect(screen.getByText('C')).toBeInTheDocument();
  expect(screen.getByText('240.5')).toBeInTheDocument();
});

test('renders nothing while loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(<DraftGradesCard leagueId={1} />);
  expect(screen.queryByTestId('draft-grades-card')).not.toBeInTheDocument();
});

test('hides itself when the draft-grades endpoint 404s', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });

  renderWithProviders(<DraftGradesCard leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('draft-grades-card')).not.toBeInTheDocument();
});
