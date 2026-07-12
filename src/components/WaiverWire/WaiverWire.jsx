import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Alert,
  Box,
  Chip,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  TableSortLabel,
} from '@mui/material';
import apiClient from '../../api/apiClient';

function statusColor(status) {
  if (status === 'won') return 'success';
  if (status === 'lost' || status === 'invalid') return 'error';
  return 'default'; // pending, cancelled
}

function WaiverWire() {
  const { leagueId } = useParams();
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [claimPlayer, setClaimPlayer] = useState(null);
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bid, setBid] = useState(0);

  const [suggestions, setSuggestions] = useState([]);
  const [sortByUpgrade, setSortByUpgrade] = useState(false);
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    fetchAll();
  }, [leagueId]);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const [waiversRes, rosterRes] = await Promise.all([
        apiClient.get(`/api/waivers?leagueId=${leagueId}`),
        apiClient.get(`/api/team/roster?leagueId=${leagueId}`),
      ]);
      setData(waiversRes.data);
      setRoster(rosterRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }

    try {
      const suggestionsRes = await apiClient.get(`/api/waivers/suggestions?leagueId=${leagueId}`);
      setSuggestions(
        Array.isArray(suggestionsRes.data?.suggestions) ? suggestionsRes.data.suggestions : []
      );
    } catch (err) {
      // Suggestions are supplementary — fail silently and just skip the badges.
      setSuggestions([]);
    }
  };

  const upgradeByPlayerId = new Map(suggestions.map((s) => [s.playerId, s.upgradeDelta]));

  const handleSortUpgrade = () => {
    if (!sortByUpgrade) {
      setSortByUpgrade(true);
      setSortDir('desc');
    } else {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    }
  };

  const sortedOnWaivers = data
    ? [...data.onWaivers].sort((a, b) => {
        if (!sortByUpgrade) return 0;
        const av = upgradeByPlayerId.has(a.id) ? upgradeByPlayerId.get(a.id) : -Infinity;
        const bv = upgradeByPlayerId.has(b.id) ? upgradeByPlayerId.get(b.id) : -Infinity;
        return sortDir === 'desc' ? bv - av : av - bv;
      })
    : [];

  const isFaab = data?.league?.waiver_type === 'faab';

  const handleOpenClaim = (player) => {
    setError(null);
    setSuccessMessage(null);
    setClaimPlayer(player);
    setDropPlayerId('');
    setBid(0);
  };

  const handleCloseClaim = () => {
    setClaimPlayer(null);
  };

  const handleSubmitClaim = async () => {
    try {
      setError(null);
      await apiClient.post('/api/waivers/claim', {
        leagueId: Number(leagueId),
        playerId: claimPlayer.id,
        dropPlayerId: dropPlayerId === '' ? null : Number(dropPlayerId),
        bid: isFaab ? Number(bid) : 0,
      });
      setSuccessMessage('Claim submitted');
      setClaimPlayer(null);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleCancelClaim = async (claim) => {
    try {
      setError(null);
      await apiClient.delete(`/api/waivers/claim/${claim.id}?leagueId=${leagueId}`);
      setSuccessMessage('Claim cancelled');
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  if (loading && !data) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }} data-testid="page-skeleton">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Skeleton variant="text" width={200} height={48} />
          <Skeleton variant="rounded" width={140} height={32} />
        </Box>
        <Skeleton variant="text" width={140} height={32} sx={{ mb: 1 }} />
        <Skeleton variant="rectangular" height={160} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="text" width={140} height={32} sx={{ mb: 1 }} />
        <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
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

      {data && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Typography variant="h4">Waiver Wire</Typography>
            {isFaab ? (
              <Chip label={`FAAB remaining: $${data.myTeam.faab_remaining}`} />
            ) : (
              <Chip label={`Waiver priority: #${data.myTeam.waiver_priority}`} />
            )}
          </Box>

          <Paper sx={{ p: 2, mb: 3 }} data-testid="on-waivers-panel">
            <Typography variant="h6" sx={{ mb: 2 }}>
              On Waivers
            </Typography>
            {data.onWaivers.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>No players on waivers</Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Position</TableCell>
                      <TableCell>NFL Team</TableCell>
                      <TableCell>Clears</TableCell>
                      <TableCell align="center">
                        <TableSortLabel
                          active={sortByUpgrade}
                          direction={sortDir}
                          onClick={handleSortUpgrade}
                        >
                          Upgrade
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedOnWaivers.map((player) => {
                      const delta = upgradeByPlayerId.get(player.id);
                      return (
                        <TableRow key={player.id}>
                          <TableCell>{player.name}</TableCell>
                          <TableCell>{player.position}</TableCell>
                          <TableCell>{player.nfl_team}</TableCell>
                          <TableCell>{new Date(player.available_at).toLocaleString()}</TableCell>
                          <TableCell align="center">
                            {delta != null && (
                              <Chip
                                label={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`}
                                size="small"
                                color={delta > 0 ? 'success' : 'default'}
                              />
                            )}
                          </TableCell>
                          <TableCell align="center">
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => handleOpenClaim(player)}
                            >
                              Claim
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          <Paper sx={{ p: 2, mb: 3 }} data-testid="my-claims-panel">
            <Typography variant="h6" sx={{ mb: 2 }}>
              My Claims
            </Typography>
            {data.myClaims.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>No claims yet</Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Player</TableCell>
                      <TableCell>Status</TableCell>
                      {isFaab && <TableCell>Bid</TableCell>}
                      <TableCell align="center">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.myClaims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell>
                          <Typography variant="body2">{claim.player_name}</Typography>
                          {claim.note && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {claim.note}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip label={claim.status} size="small" color={statusColor(claim.status)} />
                        </TableCell>
                        {isFaab && <TableCell>${claim.bid}</TableCell>}
                        <TableCell align="center">
                          {claim.status === 'pending' && (
                            <Button size="small" onClick={() => handleCancelClaim(claim)}>
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </>
      )}

      <Dialog open={!!claimPlayer} onClose={handleCloseClaim}>
        <DialogTitle>Claim {claimPlayer?.name}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, minWidth: 250 }}>
            <InputLabel id="drop-player-select-label">Drop a player (optional)</InputLabel>
            <Select
              labelId="drop-player-select-label"
              id="drop-player-select"
              value={dropPlayerId}
              label="Drop a player (optional)"
              onChange={(e) => setDropPlayerId(e.target.value)}
            >
              <MenuItem value="">No drop</MenuItem>
              {roster.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.position})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {isFaab && (
            <TextField
              label="Bid"
              type="number"
              fullWidth
              sx={{ mt: 2 }}
              value={bid}
              onChange={(e) => setBid(e.target.value)}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseClaim}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmitClaim}>
            Submit Claim
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default WaiverWire;
