import React from 'react';
import { Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { proposeTradeHref } from '../model/proposeTradeLink';

/**
 * The Players list row's Trade action for a `rostered` player (#1310, ADR
 * 0040): a plain navigation into TradeCenter's propose-trade deep link, not a
 * submission - there is nothing to `pending` on, unlike add-player and
 * claim-player's own action components.
 */
export default function ProposeTradeAction({ leagueId, receivingTeamId, playerId, sx }) {
  return (
    <Button
      component={RouterLink}
      to={proposeTradeHref({ leagueId, receivingTeamId, playerId })}
      variant="outlined"
      size="small"
      sx={{ ...MIN_TOUCH_TARGET_SX, ...sx }}
      data-testid="propose-trade-action"
    >
      Trade
    </Button>
  );
}
