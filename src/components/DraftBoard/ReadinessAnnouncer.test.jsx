import React from 'react';
import { render, screen } from '@testing-library/react';
import ReadinessAnnouncer from './ReadinessAnnouncer';

// Issue #164. The Draft room's persistence property - that this is one node
// across a tab switch - is asserted in DraftBoard.test.jsx, where the tabs
// are. What is asserted here is the narrower question this component owns:
// when it has something to announce at all, and what it says.

const lobby = (readyCount, total) => Array.from(
  { length: total },
  (_unused, index) => ({
    teamId: index + 1,
    teamName: `Team ${index + 1}`,
    draft_position: index + 1,
    draft_ready: index < readyCount,
  })
);

const base = { teams: lobby(3, 8), viewerTeamId: 1, draftStatus: 'pending' };

test('announces the ready count for a pending lobby, politely', () => {
  render(<ReadinessAnnouncer {...base} />);

  const region = screen.getByRole('status');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('3 of 8 managers ready');
});

test('says nothing once the draft is under way', () => {
  // Readiness is a fact of the pending lobby and has no meaning after that
  // (CONTEXT.md: Readiness; railComposition composes it into `pending`
  // alone), so there is no region to leave sitting beside LiveDraftBanner's.
  render(<ReadinessAnnouncer {...base} draftStatus="active" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  render(<ReadinessAnnouncer {...base} draftStatus="complete" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('says nothing to a spectator, who has no readiness to be told about', () => {
  // Readiness is a declaration about a Team, so the panel renders only for a
  // viewer who holds one and the announcement follows it. `viewerTeamId` is
  // the join acknowledgement's answer (#113) and is null for a spectator.
  render(<ReadinessAnnouncer {...base} viewerTeamId={null} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('says nothing to a viewer whose Team is not in the frame it was handed', () => {
  // A stale viewerTeamId against a fresh team list would otherwise announce a
  // count for a lobby the viewer is not in.
  render(<ReadinessAnnouncer {...base} viewerTeamId={99} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('leaves the region untouched by a frame that does not move the count', () => {
  // Snapshot frames arrive far more often than readiness changes, and what an
  // assistive technology announces is a MUTATION of the region - so "does the
  // DOM under it change" is the question, not "does it still read the same".
  // A new teams array with the same counts is exactly the tick this must
  // stay silent for.
  const { rerender } = render(<ReadinessAnnouncer {...base} />);
  const region = screen.getByRole('status');

  const observer = new MutationObserver(() => {});
  observer.observe(region, { childList: true, characterData: true, subtree: true });
  try {
    rerender(<ReadinessAnnouncer {...base} teams={lobby(3, 8)} />);
    expect(observer.takeRecords()).toHaveLength(0);

    // And a frame that does move it mutates the same region rather than
    // building a new one.
    rerender(<ReadinessAnnouncer {...base} teams={lobby(4, 8)} />);
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('4 of 8 managers ready');
  } finally {
    observer.disconnect();
  }
});
