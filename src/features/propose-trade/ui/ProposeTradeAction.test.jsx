import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import ProposeTradeAction from './ProposeTradeAction';

test('links into TradeCenter with the owning team and this player preselected', () => {
  renderWithProviders(<ProposeTradeAction leagueId={4} receivingTeamId={77} playerId={900} />);

  expect(screen.getByRole('link', { name: 'Trade' })).toHaveAttribute(
    'href',
    '/league/4/trades?receivingTeamId=77&playerId=900',
  );
});
