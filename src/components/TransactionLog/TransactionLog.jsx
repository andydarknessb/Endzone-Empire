import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Alert,
  Chip,
  Box,
  Stack,
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
import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
} from '@mui/lab';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import RuleIcon from '@mui/icons-material/Rule';
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

// Timeline dot icon + color per transaction type — reuses the theme's
// semantic palette roles (no hard-coded color literals) rather than the
// TYPE_COLORS chip mapping above, since the two conventions serve different
// visual jobs (a filled chip label vs. a small dot icon).
const TYPE_ICON_META = {
  add: { Icon: AddCircleIcon, color: 'success' },
  drop: { Icon: RemoveCircleOutlineIcon, color: 'error' },
  waiver: { Icon: AddCircleIcon, color: 'info' },
  trade: { Icon: SwapHorizIcon, color: 'info' },
  commissioner: { Icon: AdminPanelSettingsIcon, color: 'warning' },
  stat_correction: { Icon: RuleIcon, color: 'error' },
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

// One row of the activity timeline: a colored dot/icon keyed off the
// transaction type, the team + action description, and a relative
// timestamp aligned to the right.
function ActivityFeedItem({ txn, onOpenPlayer, isLast }) {
  const { Icon, color } = TYPE_ICON_META[txn.type] || { Icon: HistoryOutlinedIcon, color: 'grey' };
  return (
    <TimelineItem data-testid={`txn-${txn.id}`}>
      <TimelineSeparator>
        <TimelineDot color={color} variant="outlined">
          <Icon fontSize="small" />
        </TimelineDot>
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ py: 0, pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Chip
              label={txn.type}
              size="small"
              color={TYPE_COLORS[txn.type] || 'default'}
              sx={{ mb: 0.5 }}
            />
            <Typography variant="body2" component="div" data-testid="txn-desc">
              {txn.team_name && (
                <Box component="span" sx={{ fontWeight: 'bold' }}>
                  {txn.team_name}{' '}
                </Box>
              )}
              <TransactionDescription txn={txn} onOpenPlayer={onOpenPlayer} />
            </Typography>
          </Box>
          <Tooltip title={new Date(txn.created_at).toLocaleString()}>
            <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {formatRelative(txn.created_at)}
            </Typography>
          </Tooltip>
        </Box>
      </TimelineContent>
    </TimelineItem>
  );
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
    // fetchTransactions closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Cluster consecutive same-day rows so each day renders as its own
  // mini-timeline under a single date heading (assumes `visible` is already
  // ordered newest-first, same assumption the old flat list relied on).
  const dayGroups = [];
  visible.forEach((t) => {
    const label = dayLabel(t.created_at);
    const lastGroup = dayGroups[dayGroups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(t);
    } else {
      dayGroups.push({ label, items: [t] });
    }
  });

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
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            spacing={2}
            sx={{ mb: 3 }}
          >
            <Box sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', pb: { xs: 0.5, sm: 0 } }}>
              <ToggleButtonGroup
                value={typeFilter}
                exclusive
                onChange={(e, value) => value && setTypeFilter(value)}
                size="small"
                color="primary"
                aria-label="Filter by transaction type"
                sx={{ flexWrap: { xs: 'nowrap', sm: 'wrap' } }}
              >
                {FILTER_OPTIONS.map((opt) => (
                  <ToggleButton key={opt.value} value={opt.value} sx={{ whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <FormControl size="small" sx={{ minWidth: 160, alignSelf: { xs: 'stretch', sm: 'center' } }}>
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
          </Stack>

          {filtered.length === 0 ? (
            transactions.length === 0 ? (
              <Stack
                alignItems="center"
                justifyContent="center"
                spacing={2}
                sx={{ py: 8, minHeight: 240 }}
              >
                <HistoryOutlinedIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
                <Typography sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 380 }}>
                  The league is quiet. Recent transactions, trades, and commissioner actions will
                  appear here.
                </Typography>
              </Stack>
            ) : (
              <Typography sx={{ color: 'text.secondary' }}>No activity matches these filters</Typography>
            )
          ) : (
            <Paper sx={{ p: 2 }}>
              {dayGroups.map((group) => (
                <Box key={`${group.label}-${group.items[0].id}`} sx={{ mb: 1 }}>
                  <Typography
                    variant="overline"
                    sx={{ color: 'text.secondary', pl: 1 }}
                    data-testid="day-header"
                  >
                    {group.label}
                  </Typography>
                  <Timeline
                    position="right"
                    sx={{
                      p: 0,
                      m: 0,
                      '& .MuiTimelineItem-root:before': { flex: 0, padding: 0 },
                    }}
                  >
                    {group.items.map((txn, i) => (
                      <ActivityFeedItem
                        key={txn.id}
                        txn={txn}
                        onOpenPlayer={setQuickViewId}
                        isLast={i === group.items.length - 1}
                      />
                    ))}
                  </Timeline>
                </Box>
              ))}
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
