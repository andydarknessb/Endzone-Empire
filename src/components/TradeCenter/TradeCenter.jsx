import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Chip,
  Button,
  Alert,
  Skeleton,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { isLeagueCreator } from '../../lib/teamIdentity';
import PlayerDecisionCard from '../../widgets/player-decision-card';
import { toDecisionCardEntry, PlayerNameLink } from '../../entities/player';
import TradeProposalCard from './TradeProposalCard';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// Trades still awaiting a final outcome — active either because a decision
// is pending or because they're inside the post-accept league review window.
const ACTIVE_STATUSES = new Set(['pending', 'accepted']);

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function toggleInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** Position-grouped, in QB/RB/WR/TE/K/DEF order, with anything else appended after. */
function groupPlayersByPosition(players) {
  const byPosition = new Map();
  for (const player of players) {
    const key = player.position || 'Other';
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }
  const orderedKeys = [
    ...POSITION_ORDER.filter((pos) => byPosition.has(pos)),
    ...[...byPosition.keys()].filter((pos) => !POSITION_ORDER.includes(pos)),
  ];
  return orderedKeys.map((position) => ({ position, players: byPosition.get(position) }));
}

const VERDICT_LABEL = {
  fair: 'Fair',
  favors_proposer: 'Favors Proposer',
  favors_receiver: 'Favors Receiver',
};

// Self-contained "Analyze trade" control: posts to /api/trades/analyze and
// renders the verdict + per-player breakdown. Used both in the compose
// dialog and on each existing trade card, so it owns its own request state.
// autoRun (compose dialog only) fires the request ~600ms after the offered/
// requested ids last changed instead of waiting for a button click; existing
// trade cards leave autoRun off and keep the manual button.
function TradeAnalysisPanel({ leagueId, receivingTeamId, offeredPlayerIds, requestedPlayerIds, onOpenPlayer, autoRun = false }) {
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  const handleAnalyze = async () => {
    try {
      setAnalyzing(true);
      setAnalyzeError(null);
      const res = await apiClient.post('/api/trades/analyze', {
        leagueId: Number(leagueId),
        receivingTeamId,
        offeredPlayerIds,
        requestedPlayerIds,
      });
      setResult(res.data);
    } catch (err) {
      setAnalyzeError(readHttpFailure(err).message || err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!autoRun) return undefined;
    if (offeredPlayerIds.length === 0 || requestedPlayerIds.length === 0) return undefined;
    const handle = setTimeout(() => {
      handleAnalyze();
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, receivingTeamId, offeredPlayerIds.join(','), requestedPlayerIds.join(',')]);

  return (
    <Box sx={{ mt: 2 }}>
      {!autoRun && (
        <Button size="small" variant="outlined" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? 'Analyzing…' : 'Analyze Trade'}
        </Button>
      )}
      {autoRun && analyzing && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Analyzing…
        </Typography>
      )}
      {analyzeError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {analyzeError}
        </Alert>
      )}
      {result && (
        <Box sx={{ mt: 1 }}>
          <Chip
            label={VERDICT_LABEL[result.verdict] || result.verdict}
            color={result.verdict === 'fair' ? 'success' : 'warning'}
            size="small"
            sx={{ mb: 1 }}
          />
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid xs={6}>
              <Typography variant="body2">
                Proposer: gives {result.proposerGives} · gets {result.proposerGets}
              </Typography>
            </Grid>
            <Grid xs={6}>
              <Typography variant="body2">
                Receiver: gives {result.receiverGives} · gets {result.receiverGets}
              </Typography>
            </Grid>
          </Grid>
          {(result.players || []).map((p) => (
            <Typography key={p.playerId} variant="body2">
              <PlayerNameLink name={p.name} playerId={p.playerId} onOpen={onOpenPlayer} /> ({p.position}):{' '}
              {p.rosValue} → {p.fitAdjustedValue}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** One roster column in the propose dialog: players grouped under position subheaders. */
function RosterColumn({ label, players, selectedIds, onToggle, testId }) {
  const groups = groupPlayersByPosition(players || []);
  return (
    <Grid xs={12} sm={6} data-testid={testId}>
      <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {groups.map(({ position, players: groupPlayers }) => (
        <Box key={position} sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', color: 'text.secondary' }}>
            {position}
          </Typography>
          {groupPlayers.map((player) => (
            <FormControlLabel
              key={player.id}
              control={
                <Checkbox
                  checked={selectedIds.has(player.id)}
                  onChange={() => onToggle(player.id)}
                />
              }
              label={[
                `${player.name} (${player.position})`,
                player.projected_weekly_points != null ? `weekly proj ${player.projected_weekly_points}` : null,
                player.rest_of_season_points != null ? `ROS ${player.rest_of_season_points}` : null,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </Box>
      ))}
    </Grid>
  );
}

/** A "You send (n): <chips>" / "You receive (n): <chips>" scannable summary row. */
function SummaryChipRow({ label, ids, roster }) {
  const idList = [...ids];
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
        {label} ({idList.length}):
      </Typography>
      {idList.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          none selected
        </Typography>
      ) : (
        idList.map((id) => (
          <Chip key={id} size="small" label={roster?.players?.find((p) => p.id === id)?.name || `#${id}`} />
        ))
      )}
    </Box>
  );
}

function TradeCenter() {
  const { leagueId } = useParams();
  const notify = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();

  const [trades, setTrades] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);
  const [rosters, setRosters] = useState([]);
  const { league, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(leagueId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [sendIds, setSendIds] = useState(new Set());
  const [receiveIds, setReceiveIds] = useState(new Set());
  const [counterTradeId, setCounterTradeId] = useState(null);
  const [decisionCardPlayerId, setDecisionCardPlayerId] = useState(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    fetchAll();
    // fetchAll closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setRosters((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, { name: 'teamName' })));
    setTrades((prev) => prev?.map((trade) => {
      let next = trade;
      if (Number(trade.proposing_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { proposing_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { proposing_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { proposing_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      if (Number(trade.receiving_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { receiving_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { receiving_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { receiving_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      return next;
    }) ?? prev);
  }), [leagueId]);

  // The Players list row's Trade action deep-links here as
  // `?receivingTeamId=&playerId=` (#1310, `src/features/propose-trade`):
  // once rosters have loaded, preselect that team in the propose dialog and
  // check the player in "You receive" - the row's Trade action only ever
  // fires for a player rostered by ANOTHER team, so the deep link's player
  // belongs on the RECEIVING side, never "You send". Applied once per visit
  // (dealLinkAppliedRef) and the params are then dropped from the URL so
  // closing and reopening the dialog by hand doesn't resurrect it.
  const dealLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (dealLinkAppliedRef.current) return;
    const receivingTeamIdParam = searchParams.get('receivingTeamId');
    if (!receivingTeamIdParam || rosters.length === 0) return;
    const teamId = Number(receivingTeamIdParam);
    const team = rosters.find((r) => r.teamId === teamId && r.teamId !== myTeamId);
    if (!team) return;
    dealLinkAppliedRef.current = true;
    const playerIdParam = searchParams.get('playerId');
    // Formal review formal-1310-f4: a stale or mistyped playerId (the player
    // has since been traded/dropped) must not land in `receiveIds` uncheck-
    // able - RosterColumn only renders a checkbox for a player actually on
    // `team.players`, so a playerId that fails this same test would sit in
    // receiveIds with no checkbox to represent it, yet still ride along in
    // handleSendOffer's `[...sendIds, ...receiveIds]`. Preselect it only when
    // the receiving team's own roster actually carries that id.
    const playerId = playerIdParam ? Number(playerIdParam) : null;
    const playerOnTeam = playerId != null && (team.players || []).some((p) => p.id === playerId);
    setSelectedTeamId(teamId);
    setSendIds(new Set());
    setReceiveIds(playerOnTeam ? new Set([playerId]) : new Set());
    setCounterTradeId(null);
    setDialogOpen(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('receivingTeamId');
      next.delete('playerId');
      return next;
    }, { replace: true });
  }, [rosters, myTeamId, searchParams, setSearchParams]);

  const fetchTrades = async () => {
    const res = await apiClient.get(`/api/trades?leagueId=${leagueId}`);
    setMyTeamId(res.data.myTeamId);
    setTrades(res.data.trades || []);
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const [tradesRes, rostersRes] = await Promise.all([
        apiClient.get(`/api/trades?leagueId=${leagueId}`),
        apiClient.get(`/api/league/${leagueId}/rosters`),
      ]);
      setMyTeamId(tradesRes.data.myTeamId);
      setTrades(tradesRes.data.trades || []);
      setRosters(rostersRes.data || []);
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setSelectedTeamId('');
    setSendIds(new Set());
    setReceiveIds(new Set());
    setCounterTradeId(null);
    setDialogOpen(true);
  };

  // Opens the propose dialog pre-filled with the trade inverted: the team
  // that sent the original offer, with the sides swapped from the viewer's
  // perspective, so the user only has to adjust before sending.
  const handleOpenCounter = (trade) => {
    const requestedFromMe = (trade.items || []).filter((i) => i.from_team_id === trade.receiving_team_id);
    const offeredToMe = (trade.items || []).filter((i) => i.from_team_id === trade.proposing_team_id);
    setSelectedTeamId(trade.proposing_team_id);
    setSendIds(new Set(requestedFromMe.map((i) => i.player_id)));
    setReceiveIds(new Set(offeredToMe.map((i) => i.player_id)));
    setCounterTradeId(trade.id);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCounterTradeId(null);
  };

  const handleTeamChange = (e) => {
    setSelectedTeamId(e.target.value);
    setSendIds(new Set());
    setReceiveIds(new Set());
  };

  const handleSendOffer = async () => {
    try {
      setError(null);
      const playerIds = [...sendIds, ...receiveIds];
      if (counterTradeId) {
        await apiClient.post(`/api/trades/${counterTradeId}/counter`, { playerIds });
      } else {
        await apiClient.post('/api/trades', {
          leagueId: Number(leagueId),
          receivingTeamId: selectedTeamId,
          playerIds,
        });
      }
      setDialogOpen(false);
      notify(counterTradeId ? 'Counter offer sent' : 'Trade offer sent');
      setCounterTradeId(null);
      await fetchTrades();
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      setError(message);
      notify(message, { severity: 'error' });
    }
  };

  const performAction = async (url, body, message) => {
    try {
      setError(null);
      await apiClient.post(url, body);
      notify(message);
      await fetchTrades();
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      setError(message);
      notify(message, { severity: 'error' });
    }
  };

  const handleAccept = (trade) =>
    performAction(`/api/trades/${trade.id}/respond`, { action: 'accept' }, 'Trade accepted');

  const handleReject = (trade) =>
    performAction(`/api/trades/${trade.id}/respond`, { action: 'reject' }, 'Trade rejected');

  const handleCancel = (trade) =>
    performAction(`/api/trades/${trade.id}/cancel`, {}, 'Trade cancelled');

  const handleVeto = (trade) =>
    performAction(`/api/trades/${trade.id}/veto`, {}, 'Veto vote recorded');

  const handleForceApprove = (trade) =>
    performAction(`/api/trades/${trade.id}/decide`, { approve: true }, 'Trade approved');

  const handleCommissionerVeto = (trade) =>
    performAction(`/api/trades/${trade.id}/decide`, { approve: false }, 'Trade vetoed');

  if ((loading || leagueLoading) && trades === null) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }} data-testid="page-skeleton">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Skeleton variant="text" width={200} height={48} />
          <Skeleton variant="rounded" width={140} height={36} />
        </Box>
        <Skeleton variant="rectangular" height={140} sx={{ mb: 2, borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={140} sx={{ mb: 2, borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
      </Container>
    );
  }

  const myRoster = rosters.find((r) => r.teamId === myTeamId);
  const otherTeams = rosters.filter((r) => r.teamId !== myTeamId);
  const theirRoster = rosters.find((r) => r.teamId === selectedTeamId);

  // The Decision card's entry for whichever player a PlayerNameLink opened
  // (#1311, ADR 0040 ruling d): looked up first off a roster row (the fuller
  // shape RosterColumn/SummaryChipRow already read), falling back to the
  // trade item itself (name/position/nfl_team, all a trade row carries) for
  // a player on neither roster the viewer has loaded (e.g. a third team's in
  // a veto vote). `context` is 'my_team' only when the player sits on the
  // viewer's own roster, else 'rostered' - TradeCenter never opens the card
  // for a free agent or a waivers player.
  const decisionCardPlayer = decisionCardPlayerId == null
    ? null
    : rosters.flatMap((r) => r.players || []).find((p) => p.id === decisionCardPlayerId)
      || (() => {
        const item = trades?.flatMap((t) => t.items || []).find((i) => i.player_id === decisionCardPlayerId);
        return item
          ? { id: item.player_id, name: item.name, position: item.position, nfl_team: item.nfl_team }
          : null;
      })();
  const decisionCardEntry = toDecisionCardEntry(decisionCardPlayer);
  const decisionCardContext = (myRoster?.players || []).some((p) => p.id === decisionCardPlayerId) ? 'my_team' : 'rostered';
  // The creator's Team against the reader's own, both from league detail
  // (#113): the same question as before, with no account id in the client.
  const isCommissioner = !!(league && (league.is_commissioner || isLeagueCreator(league, viewerTeamId)));

  const pendingTrades = (trades || []).filter((t) => ACTIVE_STATUSES.has(t.status));
  const completedTrades = (trades || []).filter((t) => !ACTIVE_STATUSES.has(t.status));

  const renderTradeCard = (trade) => {
    const itemsFromProposing = (trade.items || []).filter(
      (i) => i.from_team_id === trade.proposing_team_id
    );
    const itemsFromReceiving = (trade.items || []).filter(
      (i) => i.from_team_id === trade.receiving_team_id
    );
    const isReceivingTeam = myTeamId === trade.receiving_team_id;
    const isProposingTeam = myTeamId === trade.proposing_team_id;
    const notInTrade = !isReceivingTeam && !isProposingTeam;
    const isPendingOrAccepted = trade.status === 'pending' || trade.status === 'accepted';

    // The left column is always "You Receive" when the viewer is a party to
    // the trade; an uninvolved league member (e.g. voting to veto) sees both
    // sides labeled by team name instead.
    let leftLabel;
    let leftItems;
    let rightLabel;
    let rightItems;
    if (isReceivingTeam) {
      leftLabel = 'You Receive';
      leftItems = itemsFromProposing;
      rightLabel = `${trade.proposing_team_name} Receives`;
      rightItems = itemsFromReceiving;
    } else if (isProposingTeam) {
      leftLabel = 'You Receive';
      leftItems = itemsFromReceiving;
      rightLabel = `${trade.receiving_team_name} Receives`;
      rightItems = itemsFromProposing;
    } else {
      leftLabel = `${trade.proposing_team_name} Receives`;
      leftItems = itemsFromProposing;
      rightLabel = `${trade.receiving_team_name} Receives`;
      rightItems = itemsFromReceiving;
    }

    const secondaryActions = [];
    if (isReceivingTeam && trade.status === 'pending') {
      secondaryActions.push({
        key: 'counter',
        label: 'Counter',
        variant: 'outlined',
        onClick: () => handleOpenCounter(trade),
      });
    }
    if (isProposingTeam && trade.status === 'pending') {
      secondaryActions.push({ key: 'cancel', label: 'Cancel', onClick: () => handleCancel(trade) });
    }
    if (notInTrade && trade.status === 'accepted') {
      secondaryActions.push({
        key: 'veto',
        label: 'Vote to Veto',
        color: 'error',
        onClick: () => handleVeto(trade),
      });
    }
    if (isCommissioner && isPendingOrAccepted) {
      secondaryActions.push({
        key: 'force-approve',
        label: 'Force Approve',
        variant: 'outlined',
        onClick: () => handleForceApprove(trade),
      });
      secondaryActions.push({
        key: 'commissioner-veto',
        label: 'Commissioner Veto',
        variant: 'outlined',
        color: 'error',
        onClick: () => handleCommissionerVeto(trade),
      });
    }

    return (
      <TradeProposalCard
        key={trade.id}
        trade={trade}
        leftLabel={leftLabel}
        leftItems={leftItems}
        rightLabel={rightLabel}
        rightItems={rightItems}
        onOpenPlayer={setDecisionCardPlayerId}
        canAccept={isReceivingTeam && trade.status === 'pending'}
        onAccept={() => handleAccept(trade)}
        canReject={isReceivingTeam && trade.status === 'pending'}
        onReject={() => handleReject(trade)}
        secondaryActions={secondaryActions}
        analysis={
          <TradeAnalysisPanel
            leagueId={leagueId}
            receivingTeamId={trade.receiving_team_id}
            offeredPlayerIds={itemsFromProposing.map((i) => i.player_id)}
            requestedPlayerIds={itemsFromReceiving.map((i) => i.player_id)}
            onOpenPlayer={setDecisionCardPlayerId}
          />
        }
      />
    );
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">Trade Center</Typography>
        <Button variant="contained" onClick={handleOpenDialog}>
          Propose Trade
        </Button>
      </Box>

      <Tabs value={tab} onChange={(e, value) => setTab(value)} sx={{ mb: 3 }}>
        <Tab label="Pending" />
        <Tab label="Completed" />
        <Tab label="Trade Block" />
      </Tabs>

      {(error || leagueError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || leagueError}
        </Alert>
      )}

      {tab === 0 &&
        (pendingTrades.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: 8 }}>
            <HandshakeOutlinedIcon sx={{ fontSize: 56, mb: 2, color: 'text.disabled' }} />
            <Typography variant="h6">No Pending Trades</Typography>
            <Typography sx={{ color: 'text.secondary' }}>
              Trades proposed by you or to you will appear here.
            </Typography>
          </Box>
        ) : (
          pendingTrades.map(renderTradeCard)
        ))}

      {tab === 1 &&
        (completedTrades.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: 8 }}>
            <HistoryOutlinedIcon sx={{ fontSize: 56, mb: 2, color: 'text.disabled' }} />
            <Typography variant="h6">No Completed Trades</Typography>
            <Typography sx={{ color: 'text.secondary' }}>
              Executed, declined, and cancelled trades will show up here.
            </Typography>
          </Box>
        ) : (
          completedTrades.map(renderTradeCard)
        ))}

      {tab === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: 8 }}>
          <ConstructionOutlinedIcon sx={{ fontSize: 56, mb: 2, color: 'text.disabled' }} />
          <Typography variant="h6">Trade Block</Typography>
          <Typography sx={{ color: 'text.secondary' }}>
            Mark players as available so the rest of the league can make an offer. Coming soon.
          </Typography>
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>{counterTradeId ? 'Counter Trade' : 'Propose Trade'}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }} disabled={counterTradeId != null}>
            <InputLabel id="trade-with-select-label">Trade with</InputLabel>
            <Select
              labelId="trade-with-select-label"
              id="trade-with-select"
              value={selectedTeamId}
              label="Trade with"
              onChange={handleTeamChange}
            >
              {otherTeams.map((team) => (
                <MenuItem key={team.teamId} value={team.teamId}>
                  {team.teamName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedTeamId !== '' && (
            <Grid container spacing={2}>
              <RosterColumn
                label="You send"
                players={myRoster?.players}
                selectedIds={sendIds}
                onToggle={(id) => setSendIds((prev) => toggleInSet(prev, id))}
                testId="roster-column-send"
              />
              <RosterColumn
                label="You receive"
                players={theirRoster?.players}
                selectedIds={receiveIds}
                onToggle={(id) => setReceiveIds((prev) => toggleInSet(prev, id))}
                testId="roster-column-receive"
              />
            </Grid>
          )}

          {selectedTeamId !== '' && sendIds.size > 0 && receiveIds.size > 0 && (
            <TradeAnalysisPanel
              leagueId={leagueId}
              receivingTeamId={selectedTeamId}
              offeredPlayerIds={[...sendIds]}
              requestedPlayerIds={[...receiveIds]}
              onOpenPlayer={setDecisionCardPlayerId}
              autoRun
            />
          )}

          {selectedTeamId !== '' && (
            <Box sx={{ mt: 2 }}>
              <SummaryChipRow label="You send" ids={sendIds} roster={myRoster} />
              <SummaryChipRow label="You receive" ids={receiveIds} roster={theirRoster} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            variant="contained"
            disabled={sendIds.size === 0 || receiveIds.size === 0}
            onClick={handleSendOffer}
          >
            Send Offer
          </Button>
        </DialogActions>
      </Dialog>

      <PlayerDecisionCard
        open={decisionCardPlayerId != null}
        onClose={() => setDecisionCardPlayerId(null)}
        entry={decisionCardEntry}
        leagueId={Number(leagueId)}
        context={decisionCardContext}
      />
    </Container>
  );
}

export default TradeCenter;
