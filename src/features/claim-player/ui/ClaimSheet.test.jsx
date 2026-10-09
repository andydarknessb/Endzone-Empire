import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ClaimSheet, { SwapPreview } from './ClaimSheet';
import { usePlayerCard } from '../../../entities/player';

jest.mock('../model/useClaimPlayer', () => ({
  useClaimPlayer: () => ({ submitClaim: jest.fn(), pending: false }),
}));

jest.mock('../../../entities/player', () => ({
  usePlayerCard: jest.fn(),
}));

const upgrade = { points: 3.2, overPlayer: { id: 9, name: 'Starter', points: 12.2 } };

describe('SwapPreview', () => {
  it('prints the claimed player number, the starter number and the gain for a projected row', () => {
    render(<SwapPreview player={{ name: 'Carson Beck', projWeek: { points: 15.37 }, upgrade }} />);
    expect(screen.getByText('Carson Beck 15.4')).toBeInTheDocument();
    expect(screen.getByText('Starter 12.2')).toBeInTheDocument();
    expect(screen.getByText('+3.2 this week')).toBeInTheDocument();
  });

  it('prints "no history" and no gain line for a Position-baseline row, keeping the starter number', () => {
    render(
      <SwapPreview
        player={{ name: 'Carson Beck', projWeek: { points: 15.37 }, startVerdict: { outcome: 'not_recommended', reason: 'no_history', numberTrusted: false }, upgrade }}
      />,
    );
    expect(screen.getByText('Carson Beck no history')).toBeInTheDocument();
    expect(screen.getByText('Starter 12.2')).toBeInTheDocument();
    expect(screen.queryByText(/this week$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/15\.4/)).not.toBeInTheDocument();
  });

  // #2168 (ADR 0062): the net of the drop the manager picked, signed.
  it('prints the net of the picked drop with its minus sign when the drop is worth more', () => {
    render(<SwapPreview player={{ name: 'Carson Beck', projWeek: { points: 15.37 }, upgrade, swapNet: { points: -2.4, week: 1 } }} />);
    expect(screen.getByText('-2.4 this week')).toBeInTheDocument();
    expect(screen.queryByText('+3.2 this week')).not.toBeInTheDocument();
  });

  it('prints a positive net with a plus sign, and still renders when the Upgrade is 0 with no overPlayer', () => {
    render(<SwapPreview player={{ name: 'Carson Beck', projWeek: { points: 8 }, upgrade: { points: 0, overPlayer: null }, swapNet: { points: -6, week: 1 } }} />);
    expect(screen.getByText('-6.0 this week')).toBeInTheDocument();
  });

  it('renders nothing when the row has no upgrade', () => {
    const { container } = render(<SwapPreview player={{ name: 'Carson Beck', upgrade: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// #1912: the drop preselect is the server's `dropSuggestion`, never `overPlayer`.
describe('ClaimSheet drop preselect', () => {
  const roster = [7, 9].map((id) => ({ id, name: `Roster ${id}`, position: 'RB', projected_weekly_points: 5 }));
  const player = { id: 1, name: 'Carson Beck', upgrade: { points: 3.2, overPlayer: { id: 7, name: 'Roster 7', points: 12 } } };
  const sheet = (props) => render(
    <ClaimSheet open player={player} leagueId={1} availability={{ rosterCount: 2, rosterCapacity: 3 }} roster={roster} onClose={() => {}} {...props} />,
  );
  const checked = () => screen.getAllByRole('radio').find((r) => r.checked);
  // The app's jest config resets mock implementations between tests.
  beforeEach(() => usePlayerCard.mockReturnValue({ status: 'loading', card: null }));

  it('preselects dropSuggestion, not the player the Upgrade displaces', () => {
    sheet({ dropSuggestion: { id: 9, name: 'Roster 9' } });
    expect(checked()).toBe(screen.getByRole('radio', { name: /Roster 9/ }));
  });

  it('preselects no drop when there is no suggestion, even with an available overPlayer', () => {
    sheet({ dropSuggestion: null });
    expect(checked()).toBe(screen.getByRole('radio', { name: 'No drop' }));
  });

  it('preselects no drop when the suggested player is not in the roster list', () => {
    sheet({ dropSuggestion: { id: 99, name: 'Gone' } });
    expect(checked()).toBe(screen.getByRole('radio', { name: 'No drop' }));
  });

  it('re-reads the card with the drop the manager picks, and shows its net', () => {
    sheet({});
    expect(usePlayerCard).toHaveBeenLastCalledWith(expect.objectContaining({ playerId: null }));
    fireEvent.click(screen.getByRole('radio', { name: /Roster 9/ }));
    expect(usePlayerCard).toHaveBeenLastCalledWith({ leagueId: 1, playerId: 1, dropPlayerId: 9 });
    fireEvent.click(screen.getByRole('radio', { name: /Roster 7/ }));
    expect(usePlayerCard).toHaveBeenLastCalledWith({ leagueId: 1, playerId: 1, dropPlayerId: 7 });
  });

  it('shows the swapNet of the card read for the picked drop', () => {
    usePlayerCard.mockReturnValue({ status: 'ready', card: { decision: { swapNet: { points: -2.4, week: 1 } } } });
    sheet({ dropSuggestion: { id: 9, name: 'Roster 9' } });
    expect(screen.getByText('-2.4 this week')).toBeInTheDocument();
  });

  it('opens an edited claim on its own drop, whatever the suggestion', () => {
    sheet({ dropSuggestion: { id: 9, name: 'Roster 9' }, claim: { id: 4, bid: 0, dropPlayerId: 7 }, onSave: jest.fn() });
    expect(checked()).toBe(screen.getByRole('radio', { name: /Roster 7/ }));
  });
});
