import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import { clearLeagueCache } from '../../hooks/useLeague';
import FantasyOnly from './FantasyOnly';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
import apiClient from '../../api/apiClient';

const renderGuarded = (league) => {
  apiClient.get.mockResolvedValue({ data: { league, teams: [] } });
  return renderWithProviders(
    <FantasyOnly>
      <div>Fantasy page body</div>
    </FantasyOnly>,
    { route: '/league/7/lineup', path: '/league/:leagueId/lineup' }
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
});

test("a pick'em-only league gets the explanation and a way back, never the fantasy page", async () => {
  renderGuarded({ id: 7, name: 'Office Pool', pickem_only: true });

  expect(
    await screen.findByText("This is a pick'em league. Drafts, rosters, and matchups are not part of it.")
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Office Pool/ })).toHaveAttribute('href', '/league/7');
  expect(screen.queryByText('Fantasy page body')).not.toBeInTheDocument();
});

test('a fantasy league renders the wrapped page unchanged', async () => {
  renderGuarded({ id: 7, name: 'Sunday Ballers', pickem_only: false });

  expect(await screen.findByText('Fantasy page body')).toBeInTheDocument();
  expect(screen.queryByText(/This is a pick'em league/)).not.toBeInTheDocument();
});

test('the wrapped page waits for the league row rather than flashing before the verdict', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(
    <FantasyOnly>
      <div>Fantasy page body</div>
    </FantasyOnly>,
    { route: '/league/7/lineup', path: '/league/:leagueId/lineup' }
  );

  expect(screen.getByRole('status', { name: 'Loading league' })).toBeInTheDocument();
  expect(screen.queryByText('Fantasy page body')).not.toBeInTheDocument();
});

test('when the league row cannot be loaded the page itself gets to report the failure', async () => {
  apiClient.get.mockRejectedValue(new Error('network down'));
  renderWithProviders(
    <FantasyOnly>
      <div>Fantasy page body</div>
    </FantasyOnly>,
    { route: '/league/7/lineup', path: '/league/:leagueId/lineup' }
  );

  expect(await screen.findByText('Fantasy page body')).toBeInTheDocument();
});

// --- mainContentId (issue #121): the Draft route's skip link still has a
// real, focusable target when FantasyOnly blocks or is still loading, not
// only once its wrapped page (DraftBoard) actually mounts. ---

test('mainContentId marks the pick\'em-only blocked page as a focusable skip-link target', async () => {
  apiClient.get.mockResolvedValue({ data: { league: { id: 7, name: 'Office Pool', pickem_only: true }, teams: [] } });
  renderWithProviders(
    <FantasyOnly mainContentId="draft-main-content">
      <div>Fantasy page body</div>
    </FantasyOnly>,
    { route: '/league/7/lineup', path: '/league/:leagueId/lineup' }
  );

  const blocked = await screen.findByText("This is a pick'em league. Drafts, rosters, and matchups are not part of it.");
  const target = screen.getByRole('main');
  expect(target).toHaveAttribute('id', 'draft-main-content');
  expect(target).toContainElement(blocked);
  expect(target).toHaveAttribute('tabIndex', '-1');
});

test('mainContentId also marks the loading state as a <main> landmark, not just the blocked page', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(
    <FantasyOnly mainContentId="draft-main-content">
      <div>Fantasy page body</div>
    </FantasyOnly>,
    { route: '/league/7/lineup', path: '/league/:leagueId/lineup' }
  );

  // A bare role="status" would win over <main>'s implicit role, so this
  // variant announces via aria-live instead - still gets read by a screen
  // reader, without hiding the landmark the skip link needs.
  const target = screen.getByRole('main', { name: 'Loading league' });
  expect(target).toHaveAttribute('id', 'draft-main-content');
  expect(target).toHaveAttribute('tabIndex', '-1');
  expect(target).toHaveAttribute('aria-live', 'polite');
  expect(within(target).getByRole('progressbar')).toBeInTheDocument();
});

test('without mainContentId, nothing carries that id (every other FantasyOnly caller is unaffected)', async () => {
  renderGuarded({ id: 7, name: 'Office Pool', pickem_only: true });

  await screen.findByText("This is a pick'em league. Drafts, rosters, and matchups are not part of it.");
  expect(document.getElementById('draft-main-content')).toBeNull();
});
