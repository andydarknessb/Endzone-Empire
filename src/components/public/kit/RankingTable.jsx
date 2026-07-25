import React, { Fragment, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Avatar, Box, Button, Card, Chip, IconButton, Link, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { positionColorVar } from './positionColor';
import { LoadingRows, EmptyState, ErrorState } from './DataState';
import { deriveRankingTiers, orderRowsByPosition } from './rankingTiers';
import AbbreviationTooltip from '../../common/AbbreviationTooltip';

const TREND_VALUES = { down: -1, flat: 0, up: 1 };

function TrendArrow({ trend }) {
  if (trend === 'up') return <ArrowUpwardIcon fontSize="small" sx={{ color: 'success.main' }} titleAccess="trending up" />;
  if (trend === 'down') return <ArrowDownwardIcon fontSize="small" sx={{ color: 'error.main' }} titleAccess="trending down" />;
  return <RemoveIcon fontSize="small" sx={{ color: 'text.disabled' }} titleAccess="no change" />;
}

function playerValue(row, key) {
  if (key === 'trend') return TREND_VALUES[row.trend] ?? 0;
  const value = Number(row[key]);
  return row[key] == null || !Number.isFinite(value) ? -Infinity : value;
}

function PlayerIdentity({ row }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Avatar
        src={row.photoUrl || undefined}
        alt=""
        sx={{ width: 38, height: 38, bgcolor: 'var(--surface-sunken)', color: 'text.primary', fontSize: 13 }}
      >
        {String(row.name || '').slice(0, 1)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Link component={RouterLink} to={`/players/${row.playerId}`} underline="hover" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {row.name}
        </Link>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
          <Chip label={row.position} size="small" sx={{ bgcolor: positionColorVar(row.position), color: 'var(--text-inverse)', height: 17, fontSize: 10.5 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{row.nflTeam}</Typography>
          {row.injuryStatus && <Chip label={row.injuryStatus} size="small" color="error" variant="outlined" sx={{ height: 17, fontSize: 10.5 }} />}
        </Stack>
      </Box>
    </Stack>
  );
}

function TierLabel({ row, tier }) {
  return (
    <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.8 }}>
      {row.position ? `${row.position} · ` : ''}Tier {tier}
    </Typography>
  );
}

function TrendLegend() {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ mb: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Trend: last two played weeks</Typography>
      <Tooltip title="Up or down compares a player's fantasy points in their two most recent played weeks.">
        <IconButton size="small" aria-label="About ranking trends"><HelpOutlineIcon fontSize="inherit" /></IconButton>
      </Tooltip>
    </Stack>
  );
}

function MobileRankings({ rows, tiers, showTierBands, orderBy, order, sortHandler, toggleOrder }) {
  let previousTier = null;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, overflowX: 'auto', pb: 0.5 }} aria-label="Sort rankings">
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>Sort:</Typography>
        {[
          ['projectedPoints', 'Proj'],
          ['seasonPoints', 'Season'],
          ['trend', 'Trend'],
        ].map(([key, label]) => (
          <Button key={key} size="small" variant={orderBy === key ? 'contained' : 'outlined'} onClick={sortHandler(key)}>
            {key === 'projectedPoints' ? <AbbreviationTooltip term="Projected" label={label} /> : label}
          </Button>
        ))}
        <Tooltip title={`Sort ${order === 'asc' ? 'descending' : 'ascending'}`}>
          <IconButton size="small" aria-label={`Sort ${order === 'asc' ? 'descending' : 'ascending'}`} onClick={toggleOrder}>
            <SwapVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack spacing={1.5} role="list" aria-label="NFL player rankings">
        {rows.map((row) => {
          const tier = tiers.get(row.playerId) || 1;
          const tierKey = `${row.position}-${tier}`;
          const showTier = showTierBands && tierKey !== previousTier;
          previousTier = tierKey;
          return (
            <Fragment key={row.playerId}>
              {showTier && <Box sx={{ borderTop: '1px solid var(--border-subtle)', pt: 1 }}><TierLabel row={row} tier={tier} /></Box>}
              <Card variant="outlined" role="listitem" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <Typography variant="stat" sx={{ minWidth: 24, fontWeight: 800, color: 'text.secondary' }}>{row.rank}</Typography>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}><PlayerIdentity row={row} /></Box>
                  <TrendArrow trend={row.trend} />
                </Stack>
                <Stack direction="row" divider={<Box sx={{ borderLeft: '1px solid var(--border-subtle)' }} />} sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid var(--border-subtle)' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}><AbbreviationTooltip term="Projected" /></Typography>
                    <Typography variant="stat" component="div" sx={{ fontWeight: 800 }}>{row.projectedPoints ?? '—'}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, pl: 2 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Season</Typography>
                    <Typography variant="stat" component="div" sx={{ fontWeight: 800 }}>{row.seasonPoints ?? '—'}</Typography>
                  </Box>
                </Stack>
              </Card>
            </Fragment>
          );
        })}
      </Stack>
    </Box>
  );
}

function RankingTable({ rows = [], tierRows, loading = false, error = false, onRetry, emptyMessage }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [orderBy, setOrderBy] = useState('rank');
  const [order, setOrder] = useState('asc');
  const hasLastWeekData = rows.some((row) => row.lastWeekPoints != null);
  // Tiers derive from tierRows (the unfiltered list) when provided, so a
  // caller's search filter narrows the rows without re-tiering the survivors.
  const tierSource = tierRows || rows;
  const tiers = useMemo(() => deriveRankingTiers(tierSource), [tierSource]);

  // Ranking tiers are meaningful only in the default contiguous position layout.
  // Custom metric sorts intentionally hide them instead of fragmenting stale bands.
  const showTierBands = orderBy === 'rank';
  const sorted = useMemo(() => {
    if (orderBy === 'rank') return orderRowsByPosition(rows);
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const diff = playerValue(a.row, orderBy) - playerValue(b.row, orderBy);
        return (order === 'asc' ? diff : -diff) || a.index - b.index;
      })
      .map(({ row }) => row);
  }, [rows, orderBy, order]);

  if (loading) return <LoadingRows rows={8} />;
  if (error) return <ErrorState message="We couldn't load the rankings." onRetry={onRetry} />;
  if (!rows.length) return <EmptyState message={emptyMessage || "Rankings aren't available yet."} hint={emptyMessage ? 'Try a broader player or team search.' : 'Check back once the season is underway.'} />;

  const sortHandler = (key) => () => {
    if (orderBy === key) setOrder((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setOrderBy(key);
      setOrder('desc');
    }
  };

  const toggleOrder = () => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'));

  if (mobile) {
    return (
      <>
        <TrendLegend />
        <MobileRankings rows={sorted} tiers={tiers} showTierBands={showTierBands} orderBy={orderBy} order={order} sortHandler={sortHandler} toggleOrder={toggleOrder} />
      </>
    );
  }

  let previousTier = null;
  const columnCount = hasLastWeekData ? 6 : 5;
  return (
    <>
      <TrendLegend />
      <TableContainer sx={{ overflowX: 'hidden' }}>
        <Table stickyHeader size="small" aria-label="NFL player rankings">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Player</TableCell>
              {[
                ['projectedPoints', 'Proj'],
                ...(hasLastWeekData ? [['lastWeekPoints', 'Last Wk']] : []),
                ['seasonPoints', 'Season'],
                ['trend', 'Trend'],
              ].map(([key, label]) => (
                <TableCell key={key} align={key === 'trend' ? 'center' : 'right'} sortDirection={orderBy === key ? order : false} sx={{ fontWeight: 700 }}>
                  {key === 'lastWeekPoints' ? label : (
                    <TableSortLabel active={orderBy === key} direction={orderBy === key ? order : 'desc'} onClick={sortHandler(key)}>
                      {key === 'projectedPoints' ? <AbbreviationTooltip term="Projected" label={label} /> : label}
                    </TableSortLabel>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((row) => {
              const tier = tiers.get(row.playerId) || 1;
              const tierKey = `${row.position}-${tier}`;
              const showTier = showTierBands && tierKey !== previousTier;
              previousTier = tierKey;
              return (
                <Fragment key={row.playerId}>
                  {showTier && (
                    <TableRow>
                      <TableCell colSpan={columnCount} sx={{ py: 0.75, borderTop: '1px solid var(--border-strong)', bgcolor: 'var(--surface-sunken)' }}>
                        <TierLabel row={row} tier={tier} />
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow hover>
                    <TableCell sx={{ fontWeight: 800, color: 'text.secondary' }}>{row.rank}</TableCell>
                    <TableCell><PlayerIdentity row={row} /></TableCell>
                    <TableCell align="right"><Typography variant="stat" component="span">{row.projectedPoints ?? '—'}</Typography></TableCell>
                    {hasLastWeekData && <TableCell align="right"><Typography variant="stat" component="span">{row.lastWeekPoints ?? '—'}</Typography></TableCell>}
                    <TableCell align="right"><Typography variant="stat" component="span">{row.seasonPoints ?? '—'}</Typography></TableCell>
                    <TableCell align="center"><TrendArrow trend={row.trend} /></TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

export default RankingTable;
