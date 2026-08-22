import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftRail from './DraftRail';

// DraftRail is provider-free (MUI only - see its own doc comment on
// RosterPanel/RosterNeedsStrip), so a bare render is enough here.
const baseProps = {
  queue: [],
  onMoveUp: jest.fn(),
  onMoveDown: jest.fn(),
  onRemoveFromQueue: jest.fn(),
  onDraft: jest.fn(),
  isMyTurn: false,
  draftPaused: false,
  teams: [],
  onTheClock: null,
  isCommissioner: false,
  userId: 1,
  draftStatus: 'active',
  draftType: 'snake',
  onToggleAutodraft: jest.fn(),
  onToggleReady: jest.fn(),
  picks: [],
  onOpenQuickView: jest.fn(),
};

test('the mobile Pick History accordion exposes exactly one named region, not a nested duplicate', async () => {
  const user = userEvent.setup();
  render(<DraftRail {...baseProps} isXs />);

  // Collapsed by default, and MUI's Collapse marks its content
  // visibility:hidden while closed - expand it first so the region under
  // test is actually in the accessibility tree, same as a sighted/keyboard
  // user would encounter it.
  await user.click(screen.getByRole('button', { name: 'Pick History' }));

  // MUI's Accordion reads its own role="region" landmark from the id on the
  // FIRST child it's handed (here, the <h2> wrapping AccordionSummary) - a
  // regression here would nest a second, identically-named region inside it.
  expect(screen.getAllByRole('region', { name: 'Pick History' })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: 'Pick History' })).toBeInTheDocument();
});

test('the desktop Pick History panel also exposes exactly one named region', () => {
  render(<DraftRail {...baseProps} isXs={false} />);

  expect(screen.getAllByRole('region', { name: 'Pick History' })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: 'Pick History' })).toBeInTheDocument();
});
