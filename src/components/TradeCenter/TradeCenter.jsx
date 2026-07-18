import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Container,
  Typography,
  Paper,
  Box,
  Grid,
  Chip,
  Button,
  Alert,
  CircularProgress,
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
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';

const STATUS_COLOR = {
  pending: 'warning',
  accepted: 'info',
  executed: 'success',
  rejected: 'error',
  vetoed: 'error',
  cancelled: 'default',
  countered: 'default',
};

function toggleInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

const VERDICT_LABEL = {
  fair: 'Fair',
  favors_proposer: 'Favors Proposer',
  favors_receiver: 'Favors Receiver',
};

// Self-contained "Analyze trade" control: posts to /api/trades/analyze and
// renders the verdict + per-player breakdown. Used both in the compose
// dialog and on each existing trade card, so it owns its own request state.
function TradeAnalysisPanel({ leagueId, receivingTeamId, offeredPlayerIds, requestedPlayerIds, onOpenPlayer }) {
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
      setAnalyzeError(err.response?.data?.error || err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Button size="small" variant="outlined" onClick={handleAnalyze} disabled={analyzing}>
        {analyzing ? 'Analyzing…' : 'Analyze Trade'}
      </Button>
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
            <Grid item xs={6}>
              <Typography variant="body2">
                Proposer: gives {result.proposerGives} · gets {result.proposerGets}
              </Typography>
            </Grid>
            <Grid item xs={6}>
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

function TradeCenter() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);

  const [trades, setTrades] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);
  const [rosters, setRosters] = useState([]);
  const [league, setLeague] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [sendIds, setSendIds] = useState(new Set());
  const [receiveIds, setReceiveIds] = useState(new Set());
  const [quickViewId, setQuickViewId] = useState(null);

  useEffect(() => {
    fetchAll();
  }, [leagueId]);

  const fetchTrades = async () => {
    const res = await apiClient.get(`/api/trades?leagueId=${leagueId}`);
    setMyTeamId(res.data.myTeamId);
    setTrades(res.data.trades || []);
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const [tradesRes, rostersRes, leagueRes] = await Promise.all([
        apiClient.get(`/api/trades?leagueId=${leagueId}`),
        apiClient.get(`/api/league/${leagueId}/rosters`),
        apiClient.get(`/api/league/${leagueId}`),
      ]);
      setMyTeamId(tradesRes.data.myTeamId);
      setTrades(tradesRes.data.trades || []);
      setRosters(rostersRes.data || []);
      setLeague(leagueRes.data.league);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setSelectedTeamId('');
    setSendIds(new Set());
    setReceiveIds(new Set());
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const handleTeamChange = (e) => {
    setSelectedTeamId(e.target.value);
    setSendIds(new Set());
    setReceiveIds(new Set());
  };

  const handleSendOffer = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post('/api/trades', {
        leagueId: Number(leagueId),
        receivingTeamId: selectedTeamId,
        playerIds: [...sendIds, ...receiveIds],
      });
      setDialogOpen(false);
      setSuccessMessage('Trade offer sent');
      await fetchTrades();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const performAction = async (url, body, message) => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(url, body);
      setSuccessMessage(message);
      await fetchTrades();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
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

  if (loading && trades === null) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  const myRoster = rosters.find((r) => r.teamId === myTeamId);
  const otherTeams = rosters.filter((r) => r.teamId !== myTeamId);
  const theirRoster = rosters.find((r) => r.teamId === selectedTeamId);
  const isCommissioner = !!(league && user && league.owner_id === user.id);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Trade Center</Typography>
        <Button variant="contained" onClick={handleOpenDialog}>
          Propose Trade
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      {(trades || []).length === 0 && <Typography color="text.secondary">No trades yet</Typography>}

      {(trades || []).map((trade) => {
        const itemsFromProposing = (trade.items || []).filter(
          (i) => i.from_team_id === trade.proposing_team_id
        );
        const itemsFromReceiving = (trade.items || []).filter(
          (i) => i.from_team_id === trade.receiving_team_id
        );
        const isReceivingTeam = myTeamId === trade.receiving_team_id;
        const isProposingTeam = myTeamId === trade.proposing_team_id;
        const notInTrade = !isReceivingTeam && !isProposingTeam;

        return (
          <Paper key={trade.id} sx={{ p: 2, mb: 2 }} data-testid={`trade-${trade.id}`}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">
                {trade.proposing_team_name} ⇄ {trade.receiving_team_name}
              </Typography>
              <Chip
                label={trade.status}
                color={STATUS_COLOR[trade.status] || 'default'}
                size="small"
              />
            </Box>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <Typography variant="subtitle2">{trade.proposing_team_name} sends</Typography>
                {itemsFromProposing.map((item) => (
                  <Typography key={item.player_id} variant="body2">
                    <PlayerNameLink name={item.name} playerId={item.player_id} onOpen={setQuickViewId} />{' '}
                    ({item.position})
                  </Typography>
                ))}
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle2">{trade.receiving_team_name} sends</Typography>
                {itemsFromReceiving.map((item) => (
                  <Typography key={item.player_id} variant="body2">
                    <PlayerNameLink name={item.name} playerId={item.player_id} onOpen={setQuickViewId} />{' '}
                    ({item.position})
                  </Typography>
                ))}
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {isReceivingTeam && trade.status === 'pending' && (
                <>
                  <Button size="small" variant="contained" onClick={() => handleAccept(trade)}>
                    Accept
                  </Button>
                  <Button size="small" color="error" onClick={() => handleReject(trade)}>
                    Reject
                  </Button>
                </>
              )}
              {isProposingTeam && trade.status === 'pending' && (
                <Button size="small" onClick={() => handleCancel(trade)}>
                  Cancel
                </Button>
              )}
              {notInTrade && trade.status === 'accepted' && (
                <Button size="small" color="error" onClick={() => handleVeto(trade)}>
                  Vote to Veto
                </Button>
              )}
              {isCommissioner && (trade.status === 'pending' || trade.status === 'accepted') && (
                <>
                  <Button size="small" variant="outlined" onClick={() => handleForceApprove(trade)}>
                    Force Approve
                  </Button>
                  <Button size="small" color="error" variant="outlined" onClick={() => handleCommissionerVeto(trade)}>
                    Commissioner Veto
                  </Button>
                </>
              )}
            </Box>

            <TradeAnalysisPanel
              leagueId={leagueId}
              receivingTeamId={trade.receiving_team_id}
              offeredPlayerIds={itemsFromProposing.map((i) => i.player_id)}
              requestedPlayerIds={itemsFromReceiving.map((i) => i.player_id)}
              onOpenPlayer={setQuickViewId}
            />
          </Paper>
        );
      })}

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>Propose Trade</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
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
              <Grid item xs={6}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  You send
                </Typography>
                {(myRoster?.players || []).map((player) => (
                  <FormControlLabel
                    key={player.id}
                    control={
                      <Checkbox
                        checked={sendIds.has(player.id)}
                        onChange={() => setSendIds((prev) => toggleInSet(prev, player.id))}
                      />
                    }
                    label={`${player.name} (${player.position})`}
                  />
                ))}
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  You receive
                </Typography>
                {(theirRoster?.players || []).map((player) => (
                  <FormControlLabel
                    key={player.id}
                    control={
                      <Checkbox
                        checked={receiveIds.has(player.id)}
                        onChange={() => setReceiveIds((prev) => toggleInSet(prev, player.id))}
                      />
                    }
                    label={`${player.name} (${player.position})`}
                  />
                ))}
              </Grid>
            </Grid>
          )}

          {selectedTeamId !== '' && sendIds.size > 0 && receiveIds.size > 0 && (
            <TradeAnalysisPanel
              leagueId={leagueId}
              receivingTeamId={selectedTeamId}
              offeredPlayerIds={[...sendIds]}
              requestedPlayerIds={[...receiveIds]}
              onOpenPlayer={setQuickViewId}
            />
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

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
      />
    </Container>
  );
}

export default TradeCenter;
