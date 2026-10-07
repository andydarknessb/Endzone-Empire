import React from 'react';
import { render, screen } from '@testing-library/react';
import ClaimSheet, { SwapPreview } from './ClaimSheet';

jest.mock('../model/useClaimPlayer', () => ({
  useClaimPlayer: () => ({ submitClaim: jest.fn(), pending: false }),
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

  it('opens an edited claim on its own drop, whatever the suggestion', () => {
    sheet({ dropSuggestion: { id: 9, name: 'Roster 9' }, claim: { id: 4, bid: 0, dropPlayerId: 7 }, onSave: jest.fn() });
    expect(checked()).toBe(screen.getByRole('radio', { name: /Roster 7/ }));
  });
});
