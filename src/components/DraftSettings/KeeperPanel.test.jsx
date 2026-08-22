import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../api/apiClient';
import KeeperPanel from './KeeperPanel';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

function renderPanel(onSaveLeague = jest.fn()) {
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: 1, keeper_lock_at: null, roster_limit: 4 }}
      teams={[]}
      keepers={[]}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={onSaveLeague}
      onSaveKeepers={jest.fn()}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  return onSaveLeague;
}

function renderAssignments({ keeperCount, keepers }) {
  const onSaveKeepers = jest.fn();
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: keeperCount, keeper_lock_at: null, roster_limit: 4 }}
      teams={[
        { id: 1, name: 'Team One' },
        { id: 2, name: 'Team Two' },
      ]}
      keepers={keepers}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={jest.fn()}
      onSaveKeepers={onSaveKeepers}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  return onSaveKeepers;
}

test.each([
  ['-1', 'Keepers per team must be between 0 and 4.'],
  ['1.5', 'Keepers per team must be a whole number between 0 and 4.'],
  ['5', 'Keepers per team must be between 0 and 4.'],
])('blocks invalid keeper count %s', (value, message) => {
  const onSaveLeague = renderPanel();
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value } });

  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save keeper settings' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));
  expect(onSaveLeague).not.toHaveBeenCalled();
});

test('blocks a custom keeper lock in the past and allows a future one (#67, mirrors the server rule)', () => {
  const onSaveLeague = jest.fn();
  renderPanel(onSaveLeague);
  fireEvent.click(screen.getByLabelText('Custom'));
  const lockField = screen.getByLabelText('Keeper lock date and time');

  fireEvent.change(lockField, { target: { value: '2020-01-01T12:00' } });
  expect(screen.getByText('Keeper lock must be in the future')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save keeper settings' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));
  expect(onSaveLeague).not.toHaveBeenCalled();

  const future = new Date(Date.now() + 24 * 3600 * 1000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  fireEvent.change(lockField, { target: { value: local } });
  expect(screen.queryByText('Keeper lock must be in the future')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));
  expect(onSaveLeague).toHaveBeenCalledWith({
    keepersEnabled: true,
    keeperCount: 1,
    keeperLockAt: new Date(local).toISOString(),
  }, 'Keeper settings saved');
});

test.each(['0', '4'])('accepts keeper count boundary %s', (value) => {
  const onSaveLeague = renderPanel();
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));

  // keeperLockAt is omitted: the lock was not touched (tri-state leave-as-is).
  expect(onSaveLeague).toHaveBeenCalledWith({
    keepersEnabled: true,
    keeperCount: Number(value),
  }, 'Keeper settings saved');
});

test('a stored lock that has since passed does not block a count-only edit: the unchanged lock is omitted (#67)', () => {
  const onSaveLeague = jest.fn();
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: 1, keeper_lock_at: '2020-01-01T12:00:00.000Z', roster_limit: 4 }}
      teams={[]}
      keepers={[]}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={onSaveLeague}
      onSaveKeepers={jest.fn()}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  expect(screen.queryByText('Keeper lock must be in the future')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));
  expect(onSaveLeague).toHaveBeenCalledWith({
    keepersEnabled: true,
    keeperCount: 2,
  }, 'Keeper settings saved');
});

test('shows a row error and blocks duplicate player assignments', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 2,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 2, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
    ],
  });

  expect(screen.getByText('Player One is assigned more than once.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});

test('shows a row error and blocks duplicate team and round slots', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 2,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 1, player_id: 102, name: 'Player Two', position: 'RB', draft_round: 1 },
    ],
  });

  expect(screen.getByText('Team One already has a keeper in round 1.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});

test('shows a row error when one team exceeds its keeper allowance', () => {
  const onSaveKeepers = renderAssignments({
    keeperCount: 1,
    keepers: [
      { team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 },
      { team_id: 1, player_id: 102, name: 'Player Two', position: 'RB', draft_round: 2 },
    ],
  });

  expect(screen.getByText('Team One exceeds the 1 keeper limit.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignments' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(onSaveKeepers).not.toHaveBeenCalled();
});

function renderWithSearchableRow({ teamCount = 2, keeperCount = 2 } = {}) {
  const teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` }));
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: keeperCount, keeper_lock_at: null, roster_limit: 4 }}
      teams={teams}
      keepers={[]}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={jest.fn()}
      onSaveKeepers={jest.fn()}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add keeper' }));
}

describe('keeper player search', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); apiClient.get.mockReset(); });

  test('discards a stale player-search response after a newer search resolves first', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let resolveFirst;
    let resolveSecond;
    apiClient.get.mockImplementation((url, config) => {
      const query = config.params.search;
      if (query === 'aar') return new Promise((resolve) => { resolveFirst = resolve; });
      if (query === 'aaron') return new Promise((resolve) => { resolveSecond = resolve; });
      return Promise.resolve({ data: [] });
    });
    renderWithSearchableRow();

    const input = screen.getByRole('combobox', { name: 'Player' });
    await user.type(input, 'aar');
    await act(async () => { jest.advanceTimersByTime(250); });

    await user.clear(input);
    await user.type(input, 'aaron');
    await act(async () => { jest.advanceTimersByTime(250); });

    await act(async () => {
      resolveSecond({ data: { players: [{ id: 2, name: 'Aaron Rodgers' }] } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole('option', { name: 'Aaron Rodgers' })).toBeInTheDocument();

    await act(async () => {
      resolveFirst({ data: { players: [{ id: 1, name: 'Aaron Stale' }] } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('option', { name: 'Aaron Stale' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Aaron Rodgers' })).toBeInTheDocument();
  });

  test('shows a distinct error state when the player search request fails', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    apiClient.get.mockRejectedValue(new Error('players service unavailable'));
    renderWithSearchableRow();

    const input = screen.getByRole('combobox', { name: 'Player' });
    await user.type(input, 'aaron');
    await act(async () => { jest.advanceTimersByTime(250); });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Unable to search players right now.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /aaron/i })).not.toBeInTheDocument();
  });
});

describe('zero/one-team empty states', () => {
  test('explains that keeper assignment needs at least 2 teams and disables Add keeper', () => {
    render(
      <KeeperPanel
        league={{ keepers_enabled: true, keeper_count: 2, keeper_lock_at: null, roster_limit: 4 }}
        teams={[{ id: 1, name: 'Solo Team' }]}
        keepers={[]}
        keeperCandidates={[]}
        frozen={false}
        onSaveLeague={jest.fn()}
        onSaveKeepers={jest.fn()}
        saving={false}
        onSettingsDirtyChange={jest.fn()}
        onAssignmentsDirtyChange={jest.fn()}
      />
    );

    expect(screen.getByText('Add at least 2 teams to assign keepers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add keeper' })).toBeDisabled();
  });

  test('explains that keeper assignment needs at least 2 teams with zero teams', () => {
    render(
      <KeeperPanel
        league={{ keepers_enabled: true, keeper_count: 2, keeper_lock_at: null, roster_limit: 4 }}
        teams={[]}
        keepers={[]}
        keeperCandidates={[]}
        frozen={false}
        onSaveLeague={jest.fn()}
        onSaveKeepers={jest.fn()}
        saving={false}
        onSettingsDirtyChange={jest.fn()}
        onAssignmentsDirtyChange={jest.fn()}
      />
    );

    expect(screen.getByText('Add at least 2 teams to assign keepers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add keeper' })).toBeDisabled();
  });
});

// The keeper form mirrors the server bound: the IR slot is not a round (#96).
test('bounds the keeper count by the draft roster size, not the IR-inclusive roster limit', () => {
  render(
    <KeeperPanel
      league={{ keepers_enabled: true, keeper_count: 1, keeper_lock_at: null, roster_limit: 4, ir_slots: 1 }}
      teams={[]}
      keepers={[]}
      keeperCandidates={[]}
      frozen={false}
      onSaveLeague={jest.fn()}
      onSaveKeepers={jest.fn()}
      saving={false}
      onSettingsDirtyChange={jest.fn()}
      onAssignmentsDirtyChange={jest.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText('Keepers per team'), { target: { value: '4' } });

  expect(screen.getByText('Keepers per team must be between 0 and 3.')).toBeInTheDocument();
});
