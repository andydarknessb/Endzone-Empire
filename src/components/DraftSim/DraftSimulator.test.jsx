import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import publicApiClient from '../../api/publicApiClient';
import DraftSimulator from './DraftSimulator';
import { buildPool } from '../../lib/draftSim/simFixtures';
import { SIM_STORAGE_KEY } from '../../lib/draftSim/persistence';

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

beforeEach(() => {
  window.localStorage.clear();
  publicApiClient.get.mockResolvedValue({
    data: { season: 2026, includeIdp: false, players: buildPool() },
  });
});

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

async function startDraft() {
  render(<DraftSimulator />);
  fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
  await screen.findByText('On the clock');
}

// A direct DOM query rather than getAllByRole(name: /^Draft /): computing
// accessible names for a 60-row pool table on every one of 15 rounds dominates
// the runtime of the full-draft test below.
function firstDraftButton() {
  return document.querySelector('button[aria-label^="Draft "]');
}

function draftFirstAvailable() {
  fireEvent.click(firstDraftButton());
}

describe('DraftSimulator', () => {
  it('renders the setup form with no providers at all (tree-agnostic guard)', () => {
    // No ThemeProvider, no Router, no redux Provider — if this component ever
    // grows an authed-tree import, this render throws.
    render(<DraftSimulator />);
    expect(screen.getByRole('button', { name: 'Start mock draft' })).toBeInTheDocument();
    expect(screen.getByText(/10-team Standard/)).toBeInTheDocument();
  });

  it('fetches the pool without the IDP tranche for a standard league', async () => {
    await startDraft();
    expect(publicApiClient.get).toHaveBeenCalledWith('/api/public/draft-pool', { params: {} });
  });

  it('surfaces a pool fetch failure instead of a blank screen', async () => {
    publicApiClient.get.mockRejectedValueOnce(new Error('offline'));
    render(<DraftSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(await screen.findByText(/couldn't load the player pool/i)).toBeInTheDocument();
  });

  it('puts the user on the clock first from draft slot 1 and lands their pick', async () => {
    await startDraft();
    expect(screen.getByText("You're up")).toBeInTheDocument();

    const firstRow = firstDraftButton();
    const playerName = firstRow.getAttribute('aria-label').replace('Draft ', '');
    fireEvent.click(firstRow);

    const feed = screen.getAllByLabelText('Recent picks')[0];
    await waitFor(() => expect(within(feed).getByText(playerName)).toBeInTheDocument());
    // Turn passed to a CPU manager.
    expect(screen.queryByText("You're up")).not.toBeInTheDocument();
  });

  it('animates CPU picks on a timer rather than resolving them instantly', async () => {
    jest.useFakeTimers();
    try {
      render(<DraftSimulator />);
      fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
      await act(async () => {});
      await screen.findByText('On the clock');

      draftFirstAvailable();
      const feed = () => screen.getAllByLabelText('Recent picks')[0];
      expect(within(feed()).getAllByRole('listitem')).toHaveLength(1);

      // Nothing lands before the CPU's think time elapses...
      act(() => { jest.advanceTimersByTime(200); });
      expect(within(feed()).getAllByRole('listitem')).toHaveLength(1);

      // ...and exactly one pick lands after it.
      act(() => { jest.advanceTimersByTime(300); });
      expect(within(feed()).getAllByRole('listitem')).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('jumps straight to the next user pick with Sim to my pick', async () => {
    await startDraft();
    draftFirstAvailable();

    fireEvent.click(screen.getByRole('button', { name: 'Sim to my pick' }));

    await waitFor(() => expect(screen.getByText("You're up")).toBeInTheDocument());
    // 10-team snake: the user's second pick is #20, so 18 CPU picks landed.
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('saves an in-progress draft and offers to resume it', async () => {
    await startDraft();
    draftFirstAvailable();
    await waitFor(() => expect(window.localStorage.getItem(SIM_STORAGE_KEY)).toBeTruthy());

    // A fresh mount (the hard-refresh case) finds the saved draft.
    const { unmount } = render(<DraftSimulator />);
    unmount();
    render(<DraftSimulator />);
    expect(await screen.findByText(/mock draft in progress/i)).toBeInTheDocument();
  });

  it('shows the board and roster views without leaving the draft room', async () => {
    await startDraft();
    draftFirstAvailable();

    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(await screen.findByText('Draft Board')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'My team' }));
    expect(screen.getAllByLabelText('Recent picks').length).toBeGreaterThan(0);
  });

  it('runs a whole draft through to the graded report', async () => {
    await startDraft();

    // Fifteen rounds: take the best available on every turn, then let the CPU
    // clear the board in between. Sim-to-my-pick is synchronous, so no timers.
    const simToMyPick = screen.getByRole('button', { name: 'Sim to my pick' });
    for (let round = 1; round <= 15; round++) {
      const button = firstDraftButton();
      // The pool's Draft buttons are disabled off-turn, so an enabled one is
      // proof the previous jump really landed on the user's pick.
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      fireEvent.click(simToMyPick);
    }

    const heading = await screen.findByRole('heading', { name: /^Draft grade [ABCDF]$/ });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Your picks')).toBeInTheDocument();
    expect(screen.getByText('Position balance')).toBeInTheDocument();
    // A finished draft is no longer resumable.
    expect(window.localStorage.getItem(SIM_STORAGE_KEY)).toBeNull();
  });

  it('does not show the public conversion banner unless asked to', async () => {
    render(<DraftSimulator />);
    expect(screen.queryByRole('link', { name: 'Get started free' })).not.toBeInTheDocument();
  });
});
