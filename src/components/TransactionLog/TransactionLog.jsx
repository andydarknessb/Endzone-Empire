import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  List,
  ListSubheader,
  ListItem,
  Alert,
  Chip,
  Box,
  Button,
  Skeleton,
  ToggleButtonGroup,
  ToggleButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { formatRelative } from '../../utils/formatRelative';

const PAGE_SIZE = 30;

const TYPE_COLORS = {
  add: 'success',
  drop: 'default',
  waiver: 'info',
  trade: 'warning',
  commissioner: 'secondary',
  stat_correction: 'error',
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'add', label: 'Adds' },
  { value: 'drop', label: 'Drops' },
  { value: 'waiver', label: 'Waivers' },
  { value: 'trade', label: 'Trades' },
  { value: 'commissioner', label: 'Commissioner' },
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// "Today"/"Yesterday" close in, a short date beyond that (year included only
// when it isn't the current one) — mirrors formatRelative's date fallback.
function dayLabel(dateLike) {
  const date = new Date(dateLike);
  const now = new Date(Date.now());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function renderPlayerList(items, onOpenPlayer) {
  return items.map((item, i) => (
    <React.Fragment key={item.playerId}>
      {i > 0 && ', '}
      <PlayerNameLink name={item.playerName} playerId={item.playerId} onOpen={onOpenPlayer} />
    </React.Fragment>
  ));
}

function TransactionDescription({ txn, onOpenPlayer }) {
  const detail = txn.detail || {};
  switch (txn.type) {
    case 'add':
      return (
        <>
          added <PlayerNameLink name={txn.player_name} playerId={detail.playerId} onOpen={onOpenPlayer} />
        </>
      );
    case 'drop':
      return (
        <>
          dropped <PlayerNameLink name={txn.player_name} playerId={detail.playerId} onOpen={onOpenPlayer} />
        </>
      );
    case 'waiver': {
      const bidSuffix = typeof detail.bid === 'number' ? ` ($${detail.bid})` : '';
      return (
        <>
          claimed <PlayerNameLink name={txn.player_name} playerId={detail.playerId} onOpen={onOpenPlayer} />
          {bidSuffix}
          {detail.droppedPlayerId && txn.dropped_player_name && (
            <>
              , dropped{' '}
              <PlayerNameLink
                name={txn.dropped_player_name}
                playerId={detail.droppedPlayerId}
                onOpen={onOpenPlayer}
              />
            </>
          )}
        </>
      );
    }
    case 'trade': {
      const items = Array.isArray(detail.items) ? detail.items : [];
      // Older trade rows were logged before names/team ids were baked into
      // detail — fall back to the generic sentence rather than rendering
      // blanks for them.
      if (items.length === 0 || !detail.receivingTeamName) {
        return 'completed a trade';
      }
      const sent = items.filter((i) => i.fromTeamId === detail.proposingTeamId);
      const received = items.filter((i) => i.toTeamId === detail.proposingTeamId);
      return (
        <>
          traded {renderPlayerList(sent, onOpenPlayer)} to {detail.receivingTeamName} for{' '}
          {renderPlayerList(received, onOpenPlayer)}
        </>
      );
    }
    case 'commissioner':
      return 'commissioner action';
    case 'stat_correction': {
      const changed = Array.isArray(detail.changes) ? detail.changes.length : 0;
      const week = detail.week;
      return `NFL stat correction updated ${changed} matchup score${changed === 1 ? '' : 's'}${
        week ? ` in week ${week}` : ''
      }`;
    }
    default:
      return '';
  }
}

function TransactionLog() {
  const { leagueId } = useParams();
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [quickViewId, setQuickViewId] = useState(null);

  useEffect(() => {
    fetchTransactions();
  }, [leagueId]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [typeFilter, teamFilter]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/transactions`);
      setTransactions(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !transactions) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" width="100%" height={40} sx={{ mb: 3, borderRadius: 5 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
            <Skeleton variant="rectangular" height={40} sx={{ flex: 1, borderRadius: 1 }} />
          </Box>
        ))}
      </Container>
    );
  }

  const teamNames = transactions
    ? Array.from(new Set(transactions.map((t) => t.team_name).filter(Boolean))).sort()
    : [];

  const filtered = (transactions || []).filter((t) => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;
    if (teamFilter !== 'all' && t.team_name !== teamFilter) return false;
    return true;
  });
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Typography variant="h4" sx={{ mb: 3 }}>
        League Activity
      </Typography>

      {transactions && (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 3 }}>
            <ToggleButtonGroup
              value={typeFilter}
              exclusive
              onChange={(e, value) => value && setTypeFilter(value)}
              size="small"
              color="primary"
              aria-label="Filter by transaction type"
            >
              {FILTER_OPTIONS.map((opt) => (
                <ToggleButton key={opt.value} value={opt.value}>
                  {opt.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="txn-team-filter-label">Team</InputLabel>
              <Select
                labelId="txn-team-filter-label"
                id="txn-team-filter"
                value={teamFilter}
                label="Team"
                onChange={(e) => setTeamFilter(e.target.value)}
              >
                <MenuItem value="all">All Teams</MenuItem>
                {teamNames.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {filtered.length === 0 ? (
            <Typography sx={{ color: 'text.secondary' }}>
              {transactions.length === 0 ? 'No activity yet' : 'No activity matches these filters'}
            </Typography>
          ) : (
            <Paper sx={{ p: 2 }}>
              <List sx={{ py: 0 }}>
                {visible.map((txn, idx) => {
                  const label = dayLabel(txn.created_at);
                  const prevLabel = idx > 0 ? dayLabel(visible[idx - 1].created_at) : null;
                  return (
                    <React.Fragment key={txn.id}>
                      {label !== prevLabel && (
                        <ListSubheader disableSticky data-testid="day-header">
                          {label}
                        </ListSubheader>
                      )}
                      <ListItem
                        data-testid={`txn-${txn.id}`}
                        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1 }}
                      >
                        <Chip
                          label={txn.type}
                          size="small"
                          color={TYPE_COLORS[txn.type] || 'default'}
                          sx={{ mt: 0.25 }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" component="div" data-testid="txn-desc">
                            {txn.team_name && (
                              <Box component="span" sx={{ fontWeight: 'bold' }}>
                                {txn.team_name}{' '}
                              </Box>
                            )}
                            <TransactionDescription txn={txn} onOpenPlayer={setQuickViewId} />
                          </Typography>
                        </Box>
                        <Tooltip title={new Date(txn.created_at).toLocaleString()}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
                          >
                            {formatRelative(txn.created_at)}
                          </Typography>
                        </Tooltip>
                      </ListItem>
                    </React.Fragment>
                  );
                })}
              </List>
              {hasMore && (
                <Box sx={{ textAlign: 'center', pt: 2 }}>
                  <Button onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>Show more</Button>
                </Box>
              )}
            </Paper>
          )}
        </>
      )}

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
      />
    </Container>
  );
}

export default TransactionLog;
