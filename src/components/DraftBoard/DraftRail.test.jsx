import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftRail from './DraftRail';

// Issue #123 acceptance criteria 1-4: the rail's composition follows draft
// status. DraftRail is provider-free (MUI only - see its own doc comment on
// RosterPanel/RosterNeedsStrip), so a bare render is enough here.

const TEAMS = [
  { teamId: 1, teamName: 'Ridge Runners', draft_position: 1, draft_ready: false },
  { teamId: 2, teamName: 'Harbor Hawks', draft_position: 2, draft_ready: true },
];

const ROSTER_VIEW = {
  rosterSlots: [{ key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] }],
  benchCount: 4,
  irCount: 1,
  rounds: 6,
  picks: [{ pickNumber: 1, pickLabel: '1.01', playerId: 10, name: 'Bijan Robinson', position: 'RB', nflTeam: 'ATL' }],
  remainingPicks: 5,
  nextPickLabel: '2.02',
  slotTags: new Map(),
};

// Deliberately the snake-turn case: Harbor Hawks holds 1.02 and 2.01 back to
// back, so the same Team appears twice. That is the honest reading (see
// upcomingTeams.js) but only if each entry says which Pick it is - two
// identical-looking rows read as a duplicate-render bug, and a manager who
// discounts the strip as glitchy loses the wait it exists to tell them.
const UPCOMING = [
  { pickNumber: 2, pickLabel: '1.02', teamId: 2, teamName: 'Harbor Hawks' },
  { pickNumber: 3, pickLabel: '2.01', teamId: 2, teamName: 'Harbor Hawks' },
  { pickNumber: 4, pickLabel: '2.02', teamId: 1, teamName: 'Ridge Runners' },
];

const baseProps = {
  queue: [],
  onMoveUp: jest.fn(),
  onMoveDown: jest.fn(),
  onRemoveFromQueue: jest.fn(),
  onDraft: jest.fn(),
  isMyTurn: false,
  draftPaused: false,
  teams: TEAMS,
  onTheClock: null,
  isCommissioner: false,
  viewerTeamId: 1,
  draftStatus: 'active',
  draftType: 'snake',
  onToggleAutodraft: jest.fn(),
  onToggleReady: jest.fn(),
  onOpenQuickView: jest.fn(),
  rosterView: ROSTER_VIEW,
  upcoming: UPCOMING,
};

/** The rail's panels in the order a manager meets them, top to bottom. */
const panelOrder = () => screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

test('pending composes Readiness, Draft order, then My Queue', () => {
  render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} />);

  expect(panelOrder()).toEqual(['Readiness', 'Draft order', 'My Queue']);
});

test('active composes My Queue, My Roster, then the compact Upcoming strip', () => {
  render(<DraftRail {...baseProps} draftStatus="active" />);

  expect(panelOrder()).toEqual(['My Queue', 'My Roster', 'Upcoming']);
});

test('complete composes My Roster alone', () => {
  render(<DraftRail {...baseProps} draftStatus="complete" upcoming={[]} />);

  expect(panelOrder()).toEqual(['My Roster']);
});

test('before the first draft:state frame the rail is My Queue alone', () => {
  // An unknown status composes as active, but nothing in the active
  // composition has anything to say yet: no teams, no roster, no settled
  // order. So the fallback cannot show a live draft's panels over a pending
  // one - the panels themselves decline - and My Queue, which needs no draft
  // state at all, is what stands there while the socket connects.
  render(<DraftRail
    {...baseProps}
    draftStatus={undefined}
    teams={[]}
    rosterView={null}
    upcoming={[]}
  />);

  expect(panelOrder()).toEqual(['My Queue']);
});

test('Readiness disappears once the draft starts', () => {
  // A fact of the pending lobby only; it has no meaning once the draft
  // starts (CONTEXT.md: Readiness).
  const { rerender } = render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} />);
  expect(screen.getByRole('region', { name: 'Readiness' })).toBeInTheDocument();

  rerender(<DraftRail {...baseProps} draftStatus="active" />);
  expect(screen.queryByRole('region', { name: 'Readiness' })).not.toBeInTheDocument();

  rerender(<DraftRail {...baseProps} draftStatus="complete" upcoming={[]} />);
  expect(screen.queryByRole('region', { name: 'Readiness' })).not.toBeInTheDocument();
});

test('the not-yet-ready group is named Not ready', () => {
  render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} />);

  const readiness = screen.getByRole('region', { name: 'Readiness' });
  expect(within(readiness).getByText('Ridge Runners: Not ready')).toBeInTheDocument();
  expect(within(readiness).getByText('Harbor Hawks: Ready')).toBeInTheDocument();
  expect(within(readiness).getByText('1 of 2 managers ready')).toBeInTheDocument();
});

test('full Pick history is gone from the rail in every status', () => {
  // It is the chronological view of the Draft board's own committed Picks
  // (CONTEXT.md: Draft board), so it lives there, not here.
  for (const draftStatus of ['pending', 'active', 'complete']) {
    const { unmount } = render(<DraftRail {...baseProps} draftStatus={draftStatus} />);
    expect(screen.queryByRole('region', { name: /Pick history/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pick history/i })).not.toBeInTheDocument();
    unmount();
  }
});

test('Upcoming names the next three Teams with the Pick each one holds', () => {
  render(<DraftRail {...baseProps} draftStatus="active" />);

  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  const entries = within(upcoming).getAllByRole('listitem');
  expect(entries).toHaveLength(3);
  // Each entry leads with its own Pick, which is what makes the repeated
  // Harbor Hawks read as two picks across a snake turn rather than as the
  // same row rendered twice.
  expect(entries.map((entry) => entry.textContent)).toEqual([
    '1.02 Harbor Hawks', '2.01 Harbor Hawks', '2.02 Ridge Runners',
  ]);
});

test('Upcoming names no picks at all when the Draft order says nothing yet', () => {
  render(<DraftRail {...baseProps} draftStatus="active" upcoming={[]} />);

  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  expect(within(upcoming).queryAllByRole('listitem')).toHaveLength(0);
  // Neutral copy rather than a heading standing over nothing - and it does
  // not guess at which of the two possible reasons applies.
  expect(within(upcoming).getByText('No upcoming picks to show.')).toBeInTheDocument();
  // The panel still stands, because the full Draft order lives inside it.
  expect(panelOrder()).toEqual(['My Queue', 'My Roster', 'Upcoming']);
});

test('the Draft order disclosure names the region it opens', async () => {
  const user = userEvent.setup();
  render(<DraftRail {...baseProps} draftStatus="active" />);
  await user.click(screen.getByRole('button', { name: 'Full Draft order' }));

  // MUI builds a role="region" inside the Accordion and names it from the
  // summary's own id. Unnamed, it announces as a bare region inside a panel
  // already called Upcoming, which says nothing about what was opened.
  const region = screen.getByRole('region', { name: 'Full Draft order' });
  expect(region).toBeInTheDocument();
  // And the trigger says what it expands, not just that it is expanded.
  expect(screen.getByRole('button', { name: 'Full Draft order' }))
    .toHaveAttribute('aria-controls', region.getAttribute('id'));
});

test('the full Draft order is reachable from Upcoming, collapsed until asked for', async () => {
  const user = userEvent.setup();
  render(<DraftRail {...baseProps} draftStatus="active" />);

  const trigger = screen.getByRole('button', { name: 'Full Draft order' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // A control within the Upcoming panel, not another panel: the composition's
  // H2s are its panels, and adding one here would make active read as four.
  expect(screen.queryByRole('heading', { name: 'Full Draft order' })).not.toBeInTheDocument();
  expect(panelOrder()).toEqual(['My Queue', 'My Roster', 'Upcoming']);

  await user.click(trigger);

  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // Every Team in the league, not just the three the strip named.
  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  expect(within(upcoming).getByRole('checkbox', { name: 'Autodraft for Ridge Runners' })).toBeInTheDocument();
  expect(within(upcoming).getByText(/Turn on/)).toBeInTheDocument();
});

test('the Auto-draft switches survive the move into that disclosure', async () => {
  // They are the only client surface that posts to the autodraft endpoint,
  // and the draft's own copy says autodraft switches itself on after two
  // missed picks - so this is how a manager who stepped away turns it off.
  const onToggleAutodraft = jest.fn();
  const user = userEvent.setup();
  render(<DraftRail {...baseProps} draftStatus="active" onToggleAutodraft={onToggleAutodraft} />);

  await user.click(screen.getByRole('button', { name: 'Full Draft order' }));
  await user.click(screen.getByRole('checkbox', { name: 'Autodraft for Ridge Runners' }));

  expect(onToggleAutodraft).toHaveBeenCalledWith(1, true);
});

test('a completed draft offers no Draft order disclosure - there is nothing left to automate', () => {
  render(<DraftRail {...baseProps} draftStatus="complete" upcoming={[]} />);

  expect(screen.queryByRole('button', { name: 'Full Draft order' })).not.toBeInTheDocument();
});

test('a viewer with no Team sees neither Readiness nor My Roster, and is told where the record is', () => {
  render(<DraftRail
    {...baseProps}
    draftStatus="complete"
    upcoming={[]}
    viewerTeamId={null}
    rosterView={null}
  />);

  expect(panelOrder()).toEqual([]);
  expect(screen.getByText('This draft is complete. Open the Board for the full record.')).toBeInTheDocument();
});

test('Draft order still marks who is on the clock and offers the autodraft toggle', () => {
  render(<DraftRail
    {...baseProps}
    draftStatus="pending"
    upcoming={[]}
    onTheClock={{ teamId: 2, teamName: 'Harbor Hawks' }}
  />);

  const order = screen.getByRole('region', { name: 'Draft order' });
  expect(within(order).getByText('Ridge Runners')).toBeInTheDocument();
  // The viewer's own row can always be toggled; another Team's cannot unless
  // the viewer is the commissioner.
  expect(within(order).getByRole('checkbox', { name: 'Autodraft for Ridge Runners' })).toBeInTheDocument();
  expect(within(order).queryByRole('checkbox', { name: 'Autodraft for Harbor Hawks' })).not.toBeInTheDocument();
});
