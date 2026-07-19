import React from 'react';
import { Card, CardContent, CardActions, Box, Typography, Chip, Avatar, Button, Stack, Tooltip } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { formatRelative } from '../../utils/formatRelative';

const STATUS_COLOR = {
  pending: 'warning',
  accepted: 'info',
  executed: 'success',
  rejected: 'error',
  vetoed: 'error',
  cancelled: 'default',
  countered: 'default',
};

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function PlayerRow({ item, onOpenPlayer }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'action.selected', color: 'text.secondary' }}>
        {initialsFor(item.name)}
      </Avatar>
      <Typography variant="body2">
        <PlayerNameLink name={item.name} playerId={item.player_id} onOpen={onOpenPlayer} /> ({item.position})
      </Typography>
    </Stack>
  );
}

/**
 * One trade proposal, symmetric two-column "who gets what" layout with a
 * high-contrast Accept/Decline pair plus whatever role-specific secondary
 * actions apply (Counter, Cancel, Vote to Veto, commissioner overrides).
 */
function TradeProposalCard({
  trade,
  leftLabel,
  leftItems,
  rightLabel,
  rightItems,
  onOpenPlayer,
  canAccept,
  onAccept,
  canReject,
  onReject,
  secondaryActions = [],
  analysis,
}) {
  const hasActions = canAccept || canReject || secondaryActions.length > 0;

  return (
    <Card sx={{ mb: 2 }} data-testid={`trade-${trade.id}`}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h6">
              {trade.proposing_team_name} ⇄ {trade.receiving_team_name}
            </Typography>
            {trade.created_at && (
              <Tooltip title={new Date(trade.created_at).toLocaleString()}>
                <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
                  {formatRelative(trade.created_at)}
                </Typography>
              </Tooltip>
            )}
          </Box>
          <Chip label={trade.status} color={STATUS_COLOR[trade.status] || 'default'} size="small" />
        </Box>

        <Grid container spacing={2}>
          <Grid xs={12} sm={6}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              {leftLabel}
            </Typography>
            <Stack spacing={1}>
              {leftItems.map((item) => (
                <PlayerRow key={item.player_id} item={item} onOpenPlayer={onOpenPlayer} />
              ))}
            </Stack>
          </Grid>
          <Grid xs={12} sm={6} sx={{ borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' }, pl: { sm: 3 } }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              {rightLabel}
            </Typography>
            <Stack spacing={1}>
              {rightItems.map((item) => (
                <PlayerRow key={item.player_id} item={item} onOpenPlayer={onOpenPlayer} />
              ))}
            </Stack>
          </Grid>
        </Grid>

        {analysis}
      </CardContent>

      {hasActions && (
        <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap', gap: 1 }}>
          {canAccept && (
            <Button variant="contained" color="success" onClick={onAccept}>
              Accept Trade
            </Button>
          )}
          {canReject && (
            <Button variant="outlined" color="error" onClick={onReject}>
              Decline
            </Button>
          )}
          {secondaryActions.map((action) => (
            <Button
              key={action.key}
              size="small"
              variant={action.variant || 'text'}
              color={action.color || 'primary'}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </CardActions>
      )}
    </Card>
  );
}

export default TradeProposalCard;
