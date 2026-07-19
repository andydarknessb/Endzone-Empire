import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import MatchupLiveModal from './MatchupLiveModal';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

function setReducedMotion(reduced = false) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

const homeStarter = { id: 5, name: 'P. Mahomes', points: 10 };
const awayStarter = { id: 6, name: 'D. Adams', points: 8 };

const detailResponse = (overrides = {}) => ({
  data: {
    matchup: {
      id: 9,
      week: 3,
      season: 2026,
      home_score: 10,
      away_score: 8,
      final: false,
      is_playoff: false,
      home_team_name: 'Team A',
      away_team_name: 'Team B',
      ...(overrides.matchup || {}),
    },
    home: { teamId: 1, projectedTotal: 20, starters: [homeStarter] },
    away: { teamId: 2, projectedTotal: 18, starters: [awayStarter] },
    viewerTeamId: overrides.viewerTeamId === undefined ? 1 : overrides.viewerTeamId,
  },
});

function renderModal(props = {}) {
  const utils = render(
    <MemoryRouter>
      <MatchupLiveModal
        leagueId={1}
        matchupId={9}
        celebrationsEnabled
        lastScoreEvent={null}
        onClose={jest.fn()}
        {...props}
      />
    </MemoryRouter>
  );
  const rerenderWithProps = (nextProps) =>
    utils.rerender(
      <MemoryRouter>
        <MatchupLiveModal
          leagueId={1}
          matchupId={9}
          celebrationsEnabled
          lastScoreEvent={null}
          onClose={jest.fn()}
          {...props}
          {...nextProps}
        />
      </MemoryRouter>
    );
  return { ...utils, rerenderWithProps };
}

beforeEach(() => {
  setReducedMotion(false);
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('shows the sticky scoreboard once the detail fetch resolves', async () => {
  apiClient.get.mockResolvedValue(detailResponse());

  renderModal();

  expect(await screen.findByText('Week 3 Matchup')).toBeInTheDocument();
  expect(screen.getAllByText(/Team A/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Team B/).length).toBeGreaterThan(0);
});

test('shows an error alert when the detail fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'not a member of this league' } } });

  renderModal();

  expect(await screen.findByText('not a member of this league')).toBeInTheDocument();
});

test("a TD by the viewer's own starter appends to the ticker and fires a cutscene", async () => {
  apiClient.get.mockResolvedValue(detailResponse()); // viewerTeamId 1 === home.teamId 1

  const { rerenderWithProps } = renderModal({ celebrationsEnabled: true });
  await screen.findByText('Week 3 Matchup');

  act(() => {
    rerenderWithProps({
      celebrationsEnabled: true,
      lastScoreEvent: {
        seq: 1,
        data: {
          scored: [{ matchupId: 9, homeScore: 17, awayScore: 8 }],
          plays: [{ playerId: 5, name: 'P. Mahomes', type: 'rushing', pointsDelta: 7 }],
        },
      },
    });
  });

  expect(await screen.findByText('TOUCHDOWN')).toBeInTheDocument();
  expect(screen.getAllByText(/rushing TD/).length).toBeGreaterThan(0);
});

test('celebrations off: no cutscene fires, but the ticker still updates', async () => {
  apiClient.get.mockResolvedValue(detailResponse());

  const { rerenderWithProps } = renderModal({ celebrationsEnabled: false });
  await screen.findByText('Week 3 Matchup');

  act(() => {
    rerenderWithProps({
      celebrationsEnabled: false,
      lastScoreEvent: {
        seq: 1,
        data: {
          scored: [{ matchupId: 9, homeScore: 17, awayScore: 8 }],
          plays: [{ playerId: 5, name: 'P. Mahomes', type: 'rushing', pointsDelta: 7 }],
        },
      },
    });
  });

  expect(screen.queryByText('TOUCHDOWN')).not.toBeInTheDocument();
  expect(screen.getAllByText(/rushing TD/).length).toBeGreaterThan(0);
});

test("an opponent starter's TD shows a toast, not a cutscene", async () => {
  apiClient.get.mockResolvedValue(detailResponse()); // viewer is home; away starter id 6 is the opponent

  const { rerenderWithProps } = renderModal({ celebrationsEnabled: true });
  await screen.findByText('Week 3 Matchup');

  act(() => {
    rerenderWithProps({
      celebrationsEnabled: true,
      lastScoreEvent: {
        seq: 1,
        data: {
          scored: [{ matchupId: 9, homeScore: 10, awayScore: 15 }],
          plays: [{ playerId: 6, name: 'D. Adams', type: 'receiving', pointsDelta: 7 }],
        },
      },
    });
  });

  expect(screen.queryByText('TOUCHDOWN')).not.toBeInTheDocument();
  const matches = await screen.findAllByText(/D\. Adams.*receiving TD/);
  expect(matches.length).toBeGreaterThan(0);
});

test('the footer links to the full box score page', async () => {
  apiClient.get.mockResolvedValue(detailResponse());

  renderModal();
  await screen.findByText('Week 3 Matchup');

  const link = screen.getByRole('link', { name: 'View full box score' });
  expect(link).toHaveAttribute('href', '/league/1/matchups/9');
});
