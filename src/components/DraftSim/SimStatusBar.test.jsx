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
  // Draft room). Two walks from the "Time left" label, because an aria-live in
  // EITHER direction puts the countdown in a live region:
  //   - UP through every ancestor to the document root, so an aria-live on the
  //     enclosing Paper (or any wrapper) is caught. This is the original walk,
  //     kept: ruling 4b's "down through every descendant" widened coverage to
  //     the value sibling but must not narrow it away from the ancestors.
  //   - DOWN through the shared ancestor's subtree, so an aria-live on the value
  //     SIBLING (not an ancestor of the label) is caught.
  // Red-tells (#819): aria-live on the enclosing Paper turns the upward walk
  // red; aria-live on the Time left value Typography turns the downward walk red.
  it('puts no aria-live anywhere on the Time left label/value ancestors or subtree', () => {
    renderStatusBar();
    const label = screen.getByText('Time left');

    // Upward: the label and every ancestor up to the document root.
    // eslint-disable-next-line testing-library/no-node-access
    let node = label;
    while (node) {
      expect(node).not.toHaveAttribute('aria-live');
      // eslint-disable-next-line testing-library/no-node-access
      node = node.parentElement;
    }

    // Downward: the immediate shared ancestor of the label and its value (they
    // are siblings inside one Box) and every descendant under it - the value
    // node and its children included.
    // eslint-disable-next-line testing-library/no-node-access
    const subtree = label.parentElement;
    expect(subtree).not.toHaveAttribute('aria-live');
    // eslint-disable-next-line testing-library/no-node-access
    subtree.querySelectorAll('*').forEach((descendant) => {
      expect(descendant).not.toHaveAttribute('aria-live');
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
