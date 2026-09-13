import { proposeTradeHref } from './proposeTradeLink';

test('builds the TradeCenter deep link with the owning team and the player preselected', () => {
  expect(proposeTradeHref({ leagueId: 4, receivingTeamId: 77, playerId: 900 })).toBe(
    '/league/4/trades?receivingTeamId=77&playerId=900',
  );
});
