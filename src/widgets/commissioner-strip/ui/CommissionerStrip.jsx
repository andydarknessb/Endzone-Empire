import React, { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import {
  CountBadge, Frame, FrameHead, PixelHeading, PsLink,
} from '../../../shared/ui/playselect';
import AdvanceWeek from '../../../features/advance-week';
import useCommissionerStrip from '../model/useCommissionerStrip';

/**
 * League Dashboard commissioner strip (ADR 0067 wave 1b, ticket #1108's strip): a tertiary frame
 * (2px edge, Pixel 16 heading) for the league's commissioner, directly under the head at every width.
 * It renders nothing for a member; the page's wrapper collapses with it.
 *
 *   - The settled state of the league (the console's five facts: Transactions, Teams locked, Trade
 *     deadline, Waivers, Trade review) in one row, from `md` up. A phone keeps the controls only.
 *   - Rows with an item and an action, never filled (the one filled action is the lead play in Your
 *     move) and never red unless a lock is under an hour: the pending join requests as a link with a
 *     count badge straight to the console, the Advance week control while the season is live, and a
 *     "League administration" link. `invite` is an optional extra row (the page passes the Invite
 *     control here on a phone, where the head has no room for it).
 *
 * Paints only ps-* tokens. The Advance control is the advance-week feature (the commissioner console composes
 * the same feature), a ghost button, never filled.
 * It is disabled with its reason as text ("Opens when every Week 7 game is final") until every game of
 * the current week is final.
 */
export default function CommissionerStrip({ leagueId, invite, scoreEvent, onAdvanced }) {
  const {
    isCommissioner,
    pickemOnly,
    seasonLive,
    currentWeek,
    facts,
    pendingJoinRequests,
    advanceDisabledReason,
    advanceRetry,
    refetch,
  } = useCommissionerStrip(leagueId, { scoreEvent });
  const headingId = useId();

  if (!isCommissioner) return null;

  const showAdvance = !pickemOnly && seasonLive && currentWeek != null;
  const consoleHref = `/league/${leagueId}/commissioner`;
  const rows = [];

  if (invite) {
    rows.push(
      <Row key="invite" note="Copy the invite link for new teams" action={invite}>Invite code</Row>
    );
  }
  if (pendingJoinRequests > 0) {
    rows.push(
      <Row
        key="join"
        note={`${pendingJoinRequests} ${pendingJoinRequests === 1 ? 'manager is' : 'managers are'} waiting to join this public league.`}
        action={null}
      >
        <Box
          component={RouterLink}
          to={consoleHref}
          data-testid="commissioner-strip-join-requests"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            minHeight: '44px',
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--ps-ink)',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '5px',
            textDecorationColor: 'var(--ps-dim)',
          }}
        >
          Join requests
          <CountBadge n={pendingJoinRequests} noun="pending" />
        </Box>
      </Row>
    );
  }
  if (showAdvance) {
    rows.push(
      <Box key="advance" component="li" sx={rowSx}>
        <AdvanceWeek
          leagueId={leagueId}
          currentWeek={currentWeek}
          onAdvanced={() => {
            refetch();
            if (onAdvanced) onAdvanced();
          }}
          disabledReason={advanceDisabledReason || undefined}
          onRetry={advanceRetry}
        />
      </Box>
    );
  }
  rows.push(
    <Box key="admin" component="li" sx={{ ...rowSx, padding: 0, marginLeft: '-10px' }}>
      <PsLink to={consoleHref}>League administration</PsLink>
    </Box>
  );

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="commissioner-strip"
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>Commissioner</PixelHeading>
        </FrameHead>
      )}
    >
      {/* The settled state of the league, from fields the payload already carries. Five facts at md
          and up; hidden below it, where they pushed the matchup well down a phone. The same facts
          live on the commissioner console one tap away. */}
      {facts.length > 0 && (
        <Box
          component="dl"
          data-testid="commissioner-strip-facts"
          sx={{
            m: 0,
            display: { xs: 'none', md: 'grid' },
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: '12px 24px',
            padding: '14px 20px',
            borderBottom: '2px solid var(--ps-rule)',
          }}
        >
          {facts.map((fact) => (
            <Box key={fact.key} data-testid={`commissioner-fact-${fact.key}`}>
              <Box component="dt" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{fact.label}</Box>
              <Box component="dd" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>{fact.value}</Box>
            </Box>
          ))}
        </Box>
      )}
      <Box component="ul" sx={{ listStyle: 'none', m: 0, padding: { xs: '0 14px', md: '0 20px' } }}>
        {rows}
      </Box>
    </Frame>
  );
}

const rowSx = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px 16px',
  padding: '12px 0',
  '& + &': { borderTop: '2px solid var(--ps-rule)' },
};

// One strip row: an item (and its note) on the left, its action on the right.
function Row({ children, note, action }) {
  return (
    <Box component="li" sx={rowSx}>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: '15px', fontWeight: 600 }}>{children}</Box>
        {note && <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)', maxWidth: '60ch' }}>{note}</Box>}
      </Box>
      {action}
    </Box>
  );
}
