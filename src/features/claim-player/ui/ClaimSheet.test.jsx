import React from 'react';
import { render, screen } from '@testing-library/react';
import { SwapPreview } from './ClaimSheet';

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
        player={{ name: 'Carson Beck', projWeek: { points: 15.37 }, verdictReason: 'no_history', upgrade }}
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
