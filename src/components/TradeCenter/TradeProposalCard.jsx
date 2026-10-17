import React from 'react';
import { Box } from '@mui/material';
import { PsButton, PsLinkButton } from '../../shared/ui/playselect/Controls';
import { PixelClock } from '../../shared/ui/playselect/Icons';
import { PosTag, StatusChip, TeamMark, YouTag } from '../../shared/ui/playselect/Marks';
import { SR_ONLY_SX } from '../../shared/ui/playselect/type';
import { formatInstant } from '../../shared/lib/instantFormat';
import { formatTimeSince } from '../../shared/lib/formatTimeSince';
import { AnalysisError, AnalysisResult, useTradeAnalysis } from './TradeAnalysis';

const STATUS_WORD = {
  pending: 'Pending',
  accepted: 'Accepted',
  executed: 'Executed',
  rejected: 'Rejected',
  vetoed: 'Vetoed',
  cancelled: 'Cancelled',
  countered: 'Countered',
};

// #1585: the week's NFL opponent (CONTEXT.md). `vs BUF`, or a bare `Bye` when
// the server sent null for a player with an nfl_team; nothing when both are
// unknown. No home/away marker (MyTeamSummary / Decision card convention).
function opponentLabel(item) {
  if (item.nfl_opponent) return `vs ${item.nfl_opponent}`;
  return item.nfl_team ? 'Bye' : null;
}

function PlayerRow({ item, last, onOpenPlayer }) {
  const opponent = opponentLabel(item);
  return (
    <Box
      component="li"
      sx={{
        display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <PosTag position={item.position} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <PsLinkButton onClick={() => onOpenPlayer(item.player_id)}>{item.name}</PsLinkButton>
      </Box>
      {opponent && <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>{opponent}</Box>}
    </Box>
  );
}

function Column({
  id, label, items, onOpenPlayer, divided,
}) {
  return (
    <Box
      sx={divided ? {
        minWidth: 0,
        borderTop: { xs: '2px solid var(--ps-rule)', sm: 0 },
        pt: { xs: '12px', sm: 0 },
        borderLeft: { sm: '2px solid var(--ps-rule)' },
        pl: { sm: '24px' },
      } : { minWidth: 0, pr: { sm: '24px' } }}
    >
      <Box component="h3" id={id} sx={{ m: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>{label}</Box>
      <Box component="ul" aria-labelledby={id} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {items.map((item, i) => (
          <PlayerRow key={item.player_id} item={item} last={i === items.length - 1} onOpenPlayer={onOpenPlayer} />
        ))}
      </Box>
    </Box>
  );
}

// One side of the title: avatar, name and the You badge are one unit, so a narrow card breaks between
// the two teams before it breaks inside one.
function Side({
  name, avatarUrl, avatarStaticUrl, you, arrow,
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0, maxWidth: '100%' }}>
      <TeamMark name={name} avatarUrl={avatarUrl} avatarStaticUrl={avatarStaticUrl} size={28} />
      {/* shortcut: a name wider than the card wraps inside its own unit (a 120 character team name), never past the card;
          the You badge and the arrow sit inline after the last word, so they follow the name. */}
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {name}
        {you && <Box component="span" sx={{ display: 'inline-block', ml: '8px', verticalAlign: 'middle' }}><YouTag /></Box>}
        {arrow && (
          <>
            <Box component="span" aria-hidden="true" sx={{ ml: '8px', fontWeight: 400, color: 'var(--ps-dim)' }}>⇄</Box>
            <Box component="span" sx={SR_ONLY_SX}>to</Box>
          </>
        )}
      </Box>
    </Box>
  );
}

const bar = {
  display: 'flex', flexWrap: 'wrap', gap: '8px', padding: { xs: '12px 14px', sm: '12px 20px' }, borderTop: '2px solid var(--ps-rule)',
};

/**
 * One trade, as a tertiary frame (Play-select, docs/design/league Trades board): the head "{team} ⇄ {team}"
 * with both avatars, the age, the review end of an accepted trade and the Pixel status chip; two columns of
 * players with position tags; then, when it has one, the analysis; then the footer row. Every action is a
 * ghost button and "Analyze Trade" is always the last of its row; the commissioner's overrides sit on their
 * own labelled row. `cursor` marks the page's one cursor (the oldest incoming pending offer).
 *
 * Analysis is the card's own request: POST /api/trades/analyze with the trade's id, so any league member
 * reads the trade as its own proposing and receiving teams.
 */
function TradeProposalCard({
  trade,
  leagueId,
  viewerTeamId,
  leftLabel,
  leftItems,
  rightLabel,
  rightItems,
  onOpenPlayer,
  actions = [],
  commissionerActions = [],
  cursor = false,
  busy = false,
  headingRef,
}) {
  const analysis = useTradeAnalysis(leagueId);
  const id = `trade-${trade.id}`;
  const age = trade.created_at ? formatTimeSince(trade.created_at) : null;
  const reviewEnds = trade.status === 'accepted' ? formatInstant(trade.review_ends_at, 'weekdayTime') : null;
  const isYou = (teamId) => viewerTeamId != null && viewerTeamId === teamId;

  const card = (
    <Box
      component="article"
      aria-labelledby={`${id}-h`}
      data-testid={id}
      sx={{
        border: '2px solid var(--ps-frame-2)', backgroundColor: 'var(--ps-panel)', color: 'var(--ps-ink)', minWidth: 0, flex: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: { xs: '10px', sm: '8px 16px' },
          padding: { xs: '10px 14px 12px', sm: '16px 20px 12px' },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
          <Box
            component="h2"
            id={`${id}-h`}
            ref={headingRef}
            tabIndex={-1}
            sx={{
              m: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: '17px', fontWeight: 700, lineHeight: 1.3,
            }}
          >
            <Side
              name={trade.proposing_team_name}
              avatarUrl={trade.proposing_team_avatar_url}
              avatarStaticUrl={trade.proposing_team_avatar_static_url}
              you={isYou(trade.proposing_team_id)}
              arrow
            />
            <Side
              name={trade.receiving_team_name}
              avatarUrl={trade.receiving_team_avatar_url}
              avatarStaticUrl={trade.receiving_team_avatar_static_url}
              you={isYou(trade.receiving_team_id)}
            />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 14px', fontSize: '14px', color: 'var(--ps-dim)' }}>
            {age && <span title={new Date(trade.created_at).toLocaleString()}>{age}</span>}
            {reviewEnds && (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--ps-ink)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <PixelClock />
                {`League review ends ${reviewEnds}`}
              </Box>
            )}
          </Box>
        </Box>
        <StatusChip>{STATUS_WORD[trade.status] || trade.status}</StatusChip>
      </Box>

      <Box
        sx={{
          display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: '12px', sm: 0 }, padding: { xs: '4px 14px 12px', sm: '4px 20px 12px' },
        }}
      >
        <Column id={`${id}-l`} label={leftLabel} items={leftItems} onOpenPlayer={onOpenPlayer} />
        <Column id={`${id}-r`} label={rightLabel} items={rightItems} onOpenPlayer={onOpenPlayer} divided />
      </Box>

      {(analysis.result || analysis.error) && (
        <Box sx={{ padding: { xs: '12px 14px', sm: '12px 20px' }, borderTop: '2px solid var(--ps-rule)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AnalysisError error={analysis.error} />
          {analysis.result && <AnalysisResult result={analysis.result} onOpenPlayer={onOpenPlayer} />}
        </Box>
      )}

      {/* Two to a row on a phone with Analyze last (the TradesPhone board); one row from sm up, Analyze at the end. */}
      <Box
        sx={{
          ...bar,
          display: { xs: 'grid', sm: 'flex' },
          gridTemplateColumns: { xs: '1fr 1fr' },
          '& button': { width: { xs: '100%', sm: 'auto' } },
        }}
      >
        {actions.map((action) => (
          <PsButton key={action.key} variant="ghost" disabled={busy} onClick={action.onClick}>{action.label}</PsButton>
        ))}
        {/* Analysis reads today's rosters, which an executed trade has already changed: nothing to analyze. */}
        {trade.status !== 'executed' && (
          <Box sx={{ ml: { sm: 'auto' }, display: 'flex' }}>
            <PsButton variant="ghost" disabled={analysis.analyzing} onClick={() => analysis.run({ tradeId: trade.id })}>
              {analysis.analyzing ? 'Analyzing…' : 'Analyze Trade'}
            </PsButton>
          </Box>
        )}
      </Box>

      {commissionerActions.length > 0 && (
        <Box role="group" aria-label="Commissioner" sx={{ ...bar, alignItems: 'center', gap: '8px 12px' }}>
          <Box
            component="span"
            sx={{
              width: { xs: '100%', sm: '112px' }, fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)',
            }}
          >
            Commissioner
          </Box>
          {commissionerActions.map((action) => (
            <PsButton key={action.key} variant="ghost" disabled={busy} onClick={action.onClick}>{action.label}</PsButton>
          ))}
        </Box>
      )}
    </Box>
  );

  return (
    <Box
      className={cursor ? 'cursor slot' : undefined}
      sx={{
        '--cur': 'var(--ps-cursor)',
        padding: { xs: 0, sm: '4px' },
        border: `4px solid ${cursor ? 'var(--ps-cursor)' : 'transparent'}`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {cursor && <Box component="span" sx={SR_ONLY_SX}>Next move: respond to this offer</Box>}
      {card}
    </Box>
  );
}

export default TradeProposalCard;
