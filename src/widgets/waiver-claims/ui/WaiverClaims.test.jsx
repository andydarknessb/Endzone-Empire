import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import WaiverClaims, { resultView } from './WaiverClaims';

const pendingClaim = (over) => ({
  id: 1, playerId: 10, playerName: 'Rashid Shaheed', dropPlayerId: 3, dropPlayerName: 'Tyler Allgeier', bid: 14, claimOrder: 1, clearAt: null, sharesDropWith: [], ...over,
});
const claimsOf = (over = {}) => ({
  pending: [], sharedDrops: [], resultsByWeek: [], ...over,
});
const render = (claims, props = {}) => renderWithProviders(
  <WaiverClaims claims={claims} onMove={() => {}} onEdit={() => {}} onCancel={() => {}} showBid {...props} />,
);

describe('resultView', () => {
  test('the chip holds the outcome, the detail sits beneath it', () => {
    expect(resultView({ result: 'won', bid: 12 }, true)).toEqual({ head: 'Won · $12', detail: null });
    expect(resultView({ result: 'won', bid: 0 }, false)).toEqual({ head: 'Won', detail: null });
    expect(resultView({ result: 'lost', bid: 9, winningTeam: 'Waiver Wolves', winningBid: 17 }, true)).toEqual({
      head: 'Lost', detail: 'to Waiver Wolves · won at $17 · your bid $9',
    });
    expect(resultView({ result: 'lost', bid: 9, winningTeam: 'Waiver Wolves', winningBid: null }, false)).toEqual({ head: 'Lost', detail: 'to Waiver Wolves' });
    expect(resultView({ result: 'lost', bid: 9, winningTeam: null, winningBid: null }, false)).toEqual({ head: 'Lost', detail: null });
    expect(resultView({ result: 'didnt-go-through', reason: 'Your roster was full.' }, true)).toEqual({ head: "Didn't go through", detail: 'Your roster was full.' });
  });
});

test('a pending row prints its bid in a FAAB league and none in a priority league', () => {
  const claims = claimsOf({ pending: [pendingClaim()] });
  const { unmount } = render(claims);
  expect(screen.getByText('Drop: Tyler Allgeier · Bid $14')).toBeInTheDocument();
  unmount();
  render(claims, { showBid: false });
  expect(screen.getByText('Drop: Tyler Allgeier')).toBeInTheDocument();
});

test('result chips hold the outcome and the line beneath is its own text, joined for a screen reader', () => {
  render(claimsOf({
    resultsByWeek: [{
      week: 6,
      results: [{ id: 5, playerName: 'Elijah Moore', result: 'lost', bid: 9, winningTeam: 'Waiver Wolves', winningBid: 17 }],
    }],
  }));
  const line = screen.getByTestId('claim-result-line');
  expect(within(line).getByText('Lost')).toHaveStyle({ border: '2px solid var(--ps-ink)' });
  expect(line).toHaveTextContent('Lost to Waiver Wolves · won at $17 · your bid $9');
});

test('claims that share a drop get one note for the group, under its last claim, with the warning pictogram', () => {
  const claims = claimsOf({
    pending: [pendingClaim({ id: 1, claimOrder: 1 }), pendingClaim({ id: 2, claimOrder: 2, playerName: 'Jalen McMillan', bid: 5 })],
    sharedDrops: [{ dropPlayerId: 3, claimIds: [1, 2] }],
  });
  render(claims);
  const notes = screen.getAllByRole('note');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toHaveTextContent('Only one of these can go through: #1 and #2 both drop Tyler Allgeier.');
  expect(notes[0].querySelector('svg')).not.toBeNull();
  expect(notes[0].closest('li')).toHaveTextContent('Jalen McMillan');
});

test('every control is a 44px square, the first Move up and the last Move down are disabled', () => {
  render(claimsOf({ pending: [pendingClaim({ id: 1 }), pendingClaim({ id: 2, claimOrder: 2, playerName: 'Jalen McMillan' })] }));
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(8);
  buttons.forEach((b) => expect(b).toHaveStyle({ minWidth: '44px', minHeight: '44px' }));
  expect(screen.getByRole('button', { name: 'Move Rashid Shaheed up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Jalen McMillan down' })).toBeDisabled();
});

test('the order error is an alert holding text only', () => {
  render(claimsOf({ pending: [pendingClaim()] }), { orderError: 'We could not save your claim order.' });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('We could not save your claim order.');
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
});
