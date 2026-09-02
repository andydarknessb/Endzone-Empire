import React from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import { WAIVER_TYPE_LABELS } from '../../lib/leagueRulesFormat';
import RuleRow from './RuleRow';

// Mirrors the commissioner editor's three-way review mode: instant when the
// review window is zero, otherwise commissioner-veto or league vote depending
// on whether a vote threshold is set.
function tradeReview(league) {
  if ((league.trade_review_hours ?? 0) === 0) {
    return { value: 'Instant', detail: 'Trades execute immediately, with no review window and no vetoes.' };
  }
  if ((league.trade_veto_votes ?? 0) === 0) {
    return {
      value: 'Commissioner veto',
      detail: `Trades sit in a ${league.trade_review_hours}-hour review window; only the commissioner can veto.`,
    };
  }
  return {
    value: `League vote (${league.trade_veto_votes})`,
    detail: `${league.trade_veto_votes} veto votes during a ${league.trade_review_hours}-hour review window kill a trade.`,
  };
}

export default function WaiverTradeRulesView({ league }) {
  const waiverType = league.waiver_type || 'priority';
  const waiverPeriod = league.waiver_period_hours ?? 24;
  const review = tradeReview(league);
  const deadline = league.trade_deadline_week;

  return (
    <Stack spacing={4}>
      {league.transactions_locked && (
        <Alert severity="warning">Transactions are currently locked by the commissioner.</Alert>
      )}

      <Box>
        <Typography variant="subtitle1" component="h5" sx={{ fontWeight: 600, mb: 1 }}>Waivers</Typography>
        <RuleRow
          label="Waiver system"
          value={WAIVER_TYPE_LABELS[waiverType] || waiverType}
          detail={waiverType === 'faab' ? 'Blind bidding against a season budget.' : 'Waiver priority rotates as claims are awarded.'}
        />
        {waiverType === 'faab' && (
          <RuleRow label="FAAB budget" value={`$${league.faab_budget ?? 0}`} />
        )}
        <RuleRow
          label="Waiver clear period"
          value={waiverPeriod === 0 ? 'Continuous' : `${waiverPeriod} hours`}
          detail={waiverPeriod === 0 ? 'Dropped players clear immediately.' : 'How long a dropped player sits on waivers.'}
        />
      </Box>

      <Box>
        <Typography variant="subtitle1" component="h5" sx={{ fontWeight: 600, mb: 1 }}>Trades</Typography>
        <RuleRow label="Trade review" value={review.value} detail={review.detail} />
        <RuleRow
          label="Trade deadline"
          value={deadline ? `Week ${deadline}` : 'None'}
          detail={deadline ? 'No trades after this week.' : 'Trades stay open all season.'}
        />
      </Box>
    </Stack>
  );
}
