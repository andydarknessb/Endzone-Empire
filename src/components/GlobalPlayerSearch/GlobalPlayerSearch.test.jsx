import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import GlobalPlayerSearch from './GlobalPlayerSearch';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const JJ = { id: 7, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN' };

beforeEach(() => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/summary')) {
      return Promise.resolve({
        data: { player: JJ, fantasy: {}, currentSeason: null, previousSeasons: [] },
      });
    }
    return Promise.resolve({ data: { players: [JJ] } });
  });
});

afterEach(() => jest.clearAllMocks());

test('searches players and opens the quick-view on select', async () => {
  renderWithProviders(<GlobalPlayerSearch />);

  await userEvent.type(screen.getByLabelText('Search players'), 'jeff');
  const option = await screen.findByText('Justin Jefferson');

  await userEvent.click(option);

  // The players search endpoint was queried with the typed term.
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/players',
    expect.objectContaining({ params: expect.objectContaining({ search: 'jeff' }) })
  );
  // The quick-view dialog opens.
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('"/" focuses the search when the shortcut is enabled', async () => {
  renderWithProviders(<GlobalPlayerSearch enableShortcut />);

  await userEvent.keyboard('/');

  expect(screen.getByLabelText('Search players')).toHaveFocus();
});
