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

// The quick view is a heavy dialog that only matters once a result is
// picked, so the search must not pull it into the initial load: this records
// when the module is first evaluated (a lazily imported module evaluates on
// first import(), an eager one while this test file is still importing).
// `var` so the hoisted factory can bump it even if the module were evaluated
// eagerly (while this file is still importing); reset per test below.
var mockQuickViewEvaluations = 0; // eslint-disable-line no-var
jest.mock('../PlayerQuickView/PlayerQuickView', () => {
  mockQuickViewEvaluations = (mockQuickViewEvaluations || 0) + 1;
  return jest.requireActual('../PlayerQuickView/PlayerQuickView');
});

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
beforeEach(() => {
  mockQuickViewEvaluations = 0;
});

test('searches players and opens the quick-view on select, loading the quick view only then', async () => {
  renderWithProviders(<GlobalPlayerSearch />);
  expect(mockQuickViewEvaluations).toBe(0);

  await userEvent.type(screen.getByLabelText('Search players'), 'jeff');
  const option = await screen.findByText('Justin Jefferson');

  await userEvent.click(option);

  // The players search endpoint was queried with the typed term.
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/players',
    expect.objectContaining({ params: expect.objectContaining({ search: 'jeff' }) })
  );
  // The quick-view dialog opens, and only now has its module been loaded.
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(mockQuickViewEvaluations).toBe(1);
});

test('"/" focuses the search when the shortcut is enabled', async () => {
  renderWithProviders(<GlobalPlayerSearch enableShortcut />);

  await userEvent.keyboard('/');

  expect(screen.getByLabelText('Search players')).toHaveFocus();
});
