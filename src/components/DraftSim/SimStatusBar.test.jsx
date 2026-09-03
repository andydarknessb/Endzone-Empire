import React from 'react';
import { render, screen } from '@testing-library/react';
import SimStatusBar from './SimStatusBar';

function renderStatusBar(overrides = {}) {
  return render(
    <SimStatusBar
      round={1}
      rounds={15}
      pickNumber={1}
      totalPicks={150}
      onTheClockName="You"
      myTurn
      secondsLeft={45}
      clockSeconds={60}
      onSimToMyPick={() => {}}
      onRestart={() => {}}
      {...overrides}
    />
  );
}

describe('SimStatusBar (#805)', () => {
  // Red-tell: restoring aria-live="polite" on the Time left Box turns this
  // assertion red. The per-second countdown must never be a live region -
  // DraftSimulator's own status region owns the once-per-turn announcement
  // (ADR 0028; mirrors PickClock's posture in the Draft room).
  it('never puts aria-live anywhere in the Time left value\'s ancestor chain', () => {
    renderStatusBar();
    const label = screen.getByText('Time left');

    // eslint-disable-next-line testing-library/no-node-access
    let node = label.parentElement;
    while (node) {
      expect(node).not.toHaveAttribute('aria-live');
      // eslint-disable-next-line testing-library/no-node-access
      node = node.parentElement;
    }
  });

  it('renders no role="status" element at all', () => {
    renderStatusBar();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
