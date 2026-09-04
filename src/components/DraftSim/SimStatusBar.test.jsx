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
  // The real guard (#819 ruling 4b): the per-second countdown must never be a
  // live region - DraftSimulator's own status region (SimTurnStatus) owns the
  // once-per-turn announcement (ADR 0028; mirrors PickClock's posture in the
  // Draft room). Walk the shared ancestor of the "Time left" label and its
  // value DOWN through every descendant, so an aria-live on the value SIBLING
  // is caught, not only one on an ancestor of the label. Red-tell: adding
  // aria-live="polite" to the Time left value Typography turns this red.
  it('puts no aria-live anywhere in the Time left label/value subtree', () => {
    renderStatusBar();
    const label = screen.getByText('Time left');

    // The immediate shared ancestor of the label and its value (they are
    // siblings inside one Box), then the ancestor itself and every descendant
    // under it - the value node and its children included.
    // eslint-disable-next-line testing-library/no-node-access
    const subtree = label.parentElement;
    expect(subtree).not.toHaveAttribute('aria-live');
    // eslint-disable-next-line testing-library/no-node-access
    subtree.querySelectorAll('*').forEach((node) => {
      expect(node).not.toHaveAttribute('aria-live');
    });
  });

  // NOT the aria-live red-tell (that is the test above): a restored aria-live
  // confers no role, so queryByRole('status') would stay absent and this would
  // stay green. What this guards is narrower and still worth pinning: the status
  // bar adds no EXPLICIT role="status" of its own. The turn announcement is
  // DraftSimulator's SimTurnStatus region, a sibling of this bar, never a role
  // grown inside the per-second header (#819 ruling 4a).
  it('adds no explicit role="status" element of its own', () => {
    renderStatusBar();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
