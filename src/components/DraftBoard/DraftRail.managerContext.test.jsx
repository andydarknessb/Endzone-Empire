import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftRail from './DraftRail';

/**
 * Issue #124: readiness as progress, the manager's own row and Pick numbers in
 * the Draft order, and help attached to the control it explains.
 *
 * Split from DraftRail.test.jsx, which owns issue #123's question - which
 * panels a draft status composes, and in what order - the way
 * PlayerPoolTable.filterCopy.test.jsx sits beside PlayerPoolTable.test.jsx.
 * This file asks what is inside those panels.
 *
 * DraftRail is provider-free (MUI only), so a bare render is enough.
 */

const TEAMS = [
  { teamId: 1, teamName: 'Ridge Runners', draft_position: 1, draft_ready: false },
  { teamId: 2, teamName: 'Harbor Hawks', draft_position: 2, draft_ready: true },
];

const ROSTER_VIEW = {
  rosterSlots: [{ key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] }],
  benchCount: 4,
  irCount: 1,
  rounds: 6,
  picks: [],
  remainingPicks: 5,
  nextPickLabel: '2.02',
  slotTags: new Map(),
};

const UPCOMING = [
  { pickNumber: 2, pickLabel: '1.02', teamId: 2, teamName: 'Harbor Hawks' },
  { pickNumber: 3, pickLabel: '2.01', teamId: 2, teamName: 'Harbor Hawks' },
  { pickNumber: 4, pickLabel: '2.02', teamId: 1, teamName: 'Ridge Runners' },
];

const VIEWER_PICKS = {
  all: [
    { pickNumber: 1, pickLabel: '1.01' },
    { pickNumber: 4, pickLabel: '2.02' },
    { pickNumber: 5, pickLabel: '3.01' },
    { pickNumber: 8, pickLabel: '4.02' },
  ],
  next: [
    { pickNumber: 1, pickLabel: '1.01' },
    { pickNumber: 4, pickLabel: '2.02' },
    { pickNumber: 5, pickLabel: '3.01' },
  ],
};

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
  viewerPicks: { all: [], next: [] },
};

/** A league of `total` Teams with the first `readyCount` of them ready. */
const lobby = (readyCount, total) => Array.from({ length: total }, (_unused, index) => ({
  teamId: index + 1,
  teamName: `Team ${index + 1}`,
  draft_position: index + 1,
  draft_ready: index < readyCount,
}));

const readinessRegion = () => screen.getByRole('region', { name: 'Readiness' });

describe('Readiness reads as progress rather than a chip per manager', () => {
  test('a progress bar carries the same ready-over-total reading as the text', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(3, 8)} />);

    const readiness = readinessRegion();
    expect(within(readiness).getByText('3 of 8 managers ready')).toBeInTheDocument();

    const bar = within(readiness).getByRole('progressbar', { name: 'Managers ready' });
    // The bar's width is a rounding of the fraction, so the exact reading is
    // carried as valuetext rather than left to 38 to imply.
    expect(bar).toHaveAttribute('aria-valuenow', '38');
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 8 managers ready');
  });

  test('no Team wears a Ready or Not ready chip of its own any more', () => {
    // The exact set of Teams named in the collapsed panel, not "Team 4 is
    // absent": an assertion naming one Team would still pass for a panel that
    // listed the other seven.
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(3, 8)} />);

    const readiness = readinessRegion();
    const named = lobby(3, 8)
      .map((team) => team.teamName)
      .filter((name) => within(readiness).queryByText(new RegExp(name)) !== null);
    expect(named).toEqual([]);
  });
});

describe('which group Readiness names', () => {
  test('at or below half, the ready Teams are the ones listed', async () => {
    const user = userEvent.setup();
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(2, 6)} />);

    await user.click(within(readinessRegion()).getByRole('button', { name: 'Ready managers (2)' }));

    const listed = within(readinessRegion()).getAllByRole('listitem').map((item) => item.textContent);
    expect(listed).toEqual(['Team 1', 'Team 2']);
  });

  test('above half, the Not ready Teams are, and they are never called holdouts', async () => {
    // CONTEXT.md reserves holdout for the Evaluation context's Holdout ledger
    // and names this group Not ready.
    const user = userEvent.setup();
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(4, 6)} />);

    await user.click(within(readinessRegion()).getByRole('button', { name: 'Not ready managers (2)' }));

    const listed = within(readinessRegion()).getAllByRole('listitem').map((item) => item.textContent);
    expect(listed).toEqual(['Team 5', 'Team 6']);
  });

  test('at full readiness no expandable exception list remains', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(6, 6)} />);

    const readiness = readinessRegion();
    // The exact set of controls, not "there is no button called X": a label
    // change would slip past that, and an exact set would not.
    expect(within(readiness).queryAllByRole('button')).toEqual([]);
    expect(within(readiness).getByRole('checkbox', { name: 'I am ready for the draft' })).toBeInTheDocument();
    expect(within(readiness).getByText('6 of 6 managers ready')).toBeInTheDocument();
  });

  test('with nobody ready yet the count stands alone, with no empty list to open', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(0, 6)} />);

    expect(within(readinessRegion()).queryAllByRole('button')).toEqual([]);
    expect(within(readinessRegion()).getByText('0 of 6 managers ready')).toBeInTheDocument();
  });

  test('the list inverts as the lobby fills, without the panel changing shape', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(2, 6)} />
    );
    expect(within(readinessRegion()).getByRole('button', { name: 'Ready managers (2)' })).toBeInTheDocument();

    rerender(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(5, 6)} />);
    const trigger = within(readinessRegion()).getByRole('button', { name: 'Not ready managers (1)' });
    await user.click(trigger);
    expect(within(readinessRegion()).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Team 6']);

    rerender(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(6, 6)} />);
    expect(within(readinessRegion()).queryAllByRole('button')).toEqual([]);
  });
});

describe("the manager's own row in the Draft order", () => {
  const orderRows = () => within(screen.getByRole('region', { name: 'Draft order' }))
    .getAllByRole('listitem');

  test('is marked You in words, not by an accent alone', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} viewerTeamId={2} />);

    expect(orderRows().map((row) => row.textContent.includes('You'))).toEqual([false, true]);
  });

  test('a spectator sees a Draft order with no You on any row', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} viewerTeamId={null} />);

    const rows = orderRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent.includes('You'))).toEqual([false, false]);
  });

  test('rows read in Draft order whatever order the socket sent them in', () => {
    render(<DraftRail
      {...baseProps}
      draftStatus="pending"
      upcoming={[]}
      viewerTeamId={4}
      teams={[
        { teamId: 7, teamName: 'Coastal Kings', draft_position: 3, draft_ready: false },
        { teamId: 1, teamName: 'Ridge Runners', draft_position: 1, draft_ready: false },
        { teamId: 4, teamName: 'Harbor Hawks', draft_position: 2, draft_ready: false },
      ]}
    />);

    expect(orderRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('1.Ridge Runners'),
      expect.stringContaining('2.Harbor Hawks'),
      expect.stringContaining('3.Coastal Kings'),
    ]);
  });
});

describe("the manager's own Pick numbers", () => {
  const myPicks = () => within(screen.getByRole('region', { name: 'Upcoming' }))
    .getByRole('group', { name: 'My picks' });

  test('the next three are inline, without opening anything', () => {
    render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={VIEWER_PICKS} />);

    expect(within(myPicks()).getByText('1.01 · 2.02 · 3.01')).toBeInTheDocument();
  });

  test('a manager with fewer than three picks left sees only the ones they hold', () => {
    const one = [{ pickNumber: 8, pickLabel: '4.02' }];
    render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={{ all: one, next: one }} />);

    expect(within(myPicks()).getByText('4.02')).toBeInTheDocument();
  });

  test('the complete list opens in a popover with a real accessible name', async () => {
    const user = userEvent.setup();
    render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={VIEWER_PICKS} />);

    const trigger = within(myPicks()).getByRole('button', { name: 'All 4 of my picks' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);

    const popover = screen.getByRole('dialog', { name: 'All my picks' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Every pick, not just the three the strip named.
    expect(within(popover).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['1.01', '2.02', '3.01', '4.02']);
  });

  test('the popover is keyboard operable and hands focus back when it closes', async () => {
    const user = userEvent.setup();
    render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={VIEWER_PICKS} />);

    const trigger = within(myPicks()).getByRole('button', { name: 'All 4 of my picks' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'All my picks' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'All my picks' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('a manager with no picks left is offered no strip at all', () => {
    render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={{ all: [], next: [] }} />);

    const upcoming = screen.getByRole('region', { name: 'Upcoming' });
    // The panel still stands on its league-wide strip and its disclosure; it
    // is only the viewer-relative group that is gone.
    expect(within(upcoming).queryByRole('group', { name: 'My picks' })).not.toBeInTheDocument();
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('the rail\'s ids are unique, because ARIA resolves them by id', () => {
  // MUI's Accordion renders its own <div role="region" id={summary aria-controls}>
  // around whatever it is given, so an AccordionDetails carrying that same id
  // puts it in the document twice. Every aria-controls and aria-labelledby in
  // this rail is resolved by id, and a duplicate makes which element they
  // resolve to a matter of document order rather than intent (axe:
  // duplicate-id-aria).
  const duplicateIds = (root) => {
    const seen = new Map();
    root.querySelectorAll('[id]').forEach((node) => {
      seen.set(node.id, (seen.get(node.id) || 0) + 1);
    });
    return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  };

  test('with the Readiness exception list open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DraftRail {...baseProps} draftStatus="pending" upcoming={[]} teams={lobby(2, 6)} />
    );
    await user.click(screen.getByRole('button', { name: 'Ready managers (2)' }));

    expect(duplicateIds(container)).toEqual([]);
  });

  test('with the full Draft order disclosure open', async () => {
    const user = userEvent.setup();
    const { container } = render(<DraftRail {...baseProps} draftStatus="active" viewerPicks={VIEWER_PICKS} />);
    await user.click(screen.getByRole('button', { name: 'Full Draft order' }));

    expect(duplicateIds(container)).toEqual([]);
  });
});

describe('help sits with the control it explains', () => {
  test('every Auto-draft switch is described by the autodraft help', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} isCommissioner />);

    const order = screen.getByRole('region', { name: 'Draft order' });
    const switches = within(order).getAllByRole('checkbox');
    expect(switches).toHaveLength(2);

    for (const control of switches) {
      const describedBy = control.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy)).toHaveTextContent(/Turn on Auto-draft/);
    }
  });

  test('the empty Queue names the Queue action and points nowhere on the page', () => {
    render(<DraftRail {...baseProps} draftStatus="pending" upcoming={[]} queue={[]} />);

    const queue = screen.getByRole('region', { name: 'My Queue' });
    const copy = within(queue).getByText(/Queue is empty/).textContent;
    // The exact string, and nothing after it. A follow-up
    // `expect(copy).not.toMatch(/below|above|right|left/)` was here and has
    // been removed: once the copy is pinned verbatim, no implementation can
    // reach that line and fail it, so it read as a guarantee against layout
    // words while guaranteeing nothing. The word this test exists to keep out
    // is kept out by the assertion below being exact.
    expect(copy).toBe('Queue is empty. Choose Queue on a player to add them here.');
  });
});
