import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AuctionPanel from './AuctionPanel';

function renderAuction(onSave = jest.fn()) {
  render(
    <AuctionPanel
      league={{ auction_settings: { budget: 200, nominationSeconds: 30, bidSeconds: 15, nominationOrder: 'random' } }}
      teams={[]}
      frozen={false}
      onSave={onSave}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
  return { onSave };
}

test('reconciles newly joined teams into a saved custom nomination order', () => {
  const onSave = jest.fn();
  render(
    <AuctionPanel
      league={{
        auction_settings: {
          budget: 200,
          nominationSeconds: 30,
          bidSeconds: 15,
          nominationOrder: 'custom',
          nominationCustomOrder: [2, 1],
        },
      }}
      teams={[
        { id: 1, name: 'Team One', owner: 'one' },
        { id: 2, name: 'Team Two', owner: 'two' },
        { id: 3, name: 'New Team', owner: 'three' },
      ]}
      frozen={false}
      onSave={onSave}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );

  expect(screen.getByText('1. Team Two')).toBeInTheDocument();
  expect(screen.getByText('2. Team One')).toBeInTheDocument();
  expect(screen.getByText('3. New Team')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save auction settings' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Save auction settings' }));

  expect(onSave).toHaveBeenCalledWith({
    auctionSettings: {
      budget: 200,
      nominationSeconds: 30,
      bidSeconds: 15,
      nominationOrder: 'custom',
      nominationCustomOrder: [2, 1, 3],
    },
  }, 'Auction settings saved');
});

test.each([
  ['Budget', '1.5', 'Budget must be a whole number between 1 and 10000.'],
  ['Nomination seconds', '9', 'Nomination seconds must be between 10 and 300.'],
  ['Bid seconds', '61', 'Bid seconds must be between 5 and 60.'],
])('blocks invalid %s input', (label, value, message) => {
  const { onSave } = renderAuction();
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save auction settings' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save auction settings' }));
  expect(onSave).not.toHaveBeenCalled();
});

test.each([
  [{ budget: '1', nominationSeconds: '10', bidSeconds: '5' }, { budget: 1, nominationSeconds: 10, bidSeconds: 5 }],
  [{ budget: '10000', nominationSeconds: '300', bidSeconds: '60' }, { budget: 10000, nominationSeconds: 300, bidSeconds: 60 }],
])('accepts inclusive auction boundaries', (input, expected) => {
  const { onSave } = renderAuction();
  fireEvent.change(screen.getByLabelText('Budget'), { target: { value: input.budget } });
  fireEvent.change(screen.getByLabelText('Nomination seconds'), { target: { value: input.nominationSeconds } });
  fireEvent.change(screen.getByLabelText('Bid seconds'), { target: { value: input.bidSeconds } });
  fireEvent.click(screen.getByRole('button', { name: 'Save auction settings' }));

  expect(onSave).toHaveBeenCalledWith({
    auctionSettings: {
      ...expected,
      nominationOrder: 'random',
      nominationCustomOrder: null,
    },
  }, 'Auction settings saved');
});

test.each([0, 1])('explains custom nomination order needs 2+ teams and disables it with %i team(s)', (teamCount) => {
  const teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, owner: `owner${i + 1}` }));
  render(
    <AuctionPanel
      league={{ auction_settings: { budget: 200, nominationSeconds: 30, bidSeconds: 15, nominationOrder: 'random' } }}
      teams={teams}
      frozen={false}
      onSave={jest.fn()}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );

  expect(screen.getByText('Add at least 2 teams to set a custom nomination order.')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Custom nomination order' })).toBeDisabled();
});

test('blocks saving a stale custom nomination order once a league drops below 2 teams', () => {
  const onSave = jest.fn();
  render(
    <AuctionPanel
      league={{
        auction_settings: {
          budget: 200, nominationSeconds: 30, bidSeconds: 15,
          nominationOrder: 'custom', nominationCustomOrder: [1],
        },
      }}
      teams={[{ id: 1, name: 'Solo Team', owner: 'solo' }]}
      frozen={false}
      onSave={onSave}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );

  expect(screen.getByText('Add at least 2 teams to set a custom nomination order.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save auction settings' })).toBeDisabled();
});
