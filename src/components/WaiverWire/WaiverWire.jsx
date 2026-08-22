import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
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
  Tooltip,
  Stack,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddDisabledIcon from '@mui/icons-material/PersonAddDisabled';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import WaiverClaimItem from './WaiverClaimItem';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { formatRelative } from '../../utils/formatRelative';

// Mirrors DraftBoard's sticky-action-column pattern, but this table has no
// zebra striping to inherit an opaque background from, so both the header and
// cell pin against an explicit background.paper.
const stickyActionHeadSx = {
  position: 'sticky',
  right: 0,
  bgcolor: 'background.paper',
  fontWeight: 'bold',
  zIndex: 3,
};
const stickyActionCellSx = { position: 'sticky', right: 0, bgcolor: 'background.paper', zIndex: 1 };

// Worst-projection-first so the natural cut order comes first; roster entries
// without a weekly projection sort after ones that have it and fall back to
// server order (position, name) among themselves.
function sortRosterForDrop(roster) {
  const projectionOf = (p) => (
    p.projected_weekly_points != null ? Number(p.projected_weekly_points) : null
  );
  return [...roster].sort((a, b) => {
    const av = projectionOf(a);
    const bv = projectionOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });
}

function WaiverWire() {
  const { leagueId } = useParams();
  const notify = useSnackbar();
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [claimPlayer, setClaimPlayer] = useState(null);
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bid, setBid] = useState('');

  const [suggestions, setSuggestions] = useState([]);
  const [sortByUpgrade, setSortByUpgrade] = useState(false);
  const [sortDir, setSortDir] = useState('desc');
  const [quickViewId, setQuickViewId] = useState(null);
  // Once the user manually touches the Upgrade sort, stop auto-defaulting it
  // on every suggestions refresh.
  const manualSortRef = useRef(false);

  useEffect(() => {
    fetchAll();
    // fetchAll closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const fetchAll = async () => {
    let waiversData = null;
    try {
      setLoading(true);
      setError(null);
      const [waiversRes, rosterRes] = await Promise.all([
        apiClient.get(`/api/waivers?leagueId=${leagueId}`),
        apiClient.get(`/api/team/roster?leagueId=${leagueId}`),
      ]);
      waiversData = waiversRes.data;
      setData(waiversRes.data);
      setRoster(rosterRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }

    // Best ball leagues manage their own optimal lineup — the upgrade
    // suggestions strip doesn't apply, so skip fetching it entirely.
    if (waiversData?.league?.best_ball) {
      setSuggestions([]);
      return;
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

  // Default to the upgrade-desc sort once suggestions are available, but only
  // until the user manually touches the sort control themselves.
  useEffect(() => {
    if (suggestions.length > 0 && !manualSortRef.current) {
      setSortByUpgrade(true);
    }
  }, [suggestions]);

  const upgradeByPlayerId = new Map(suggestions.map((s) => [s.playerId, s.upgradeDelta]));

  const handleSortUpgrade = () => {
    manualSortRef.current = true;
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
  const isBestBall = !!data?.league?.best_ball;
  const faabRemaining = data?.myTeam?.faab_remaining ?? 0;
  const sortedRosterForDrop = sortRosterForDrop(roster);

  const bidIsValidNumber = bid !== '' && !Number.isNaN(Number(bid));
  const bidInvalid =
    isFaab && (!bidIsValidNumber || Number(bid) < 0 || Number(bid) > faabRemaining);

  const handleOpenClaim = (player) => {
    setError(null);
    setClaimPlayer(player);
    // If a waiver suggestion pairs this pickup with a specific bench player
    // to cut, preselect it — otherwise leave the drop select on "No drop".
    const suggestion = suggestions.find((s) => s.playerId === player.id);
    const suggestedDropId = suggestion?.dropPlayerId;
    const suggestedDropOnRoster =
      suggestedDropId != null && roster.some((p) => p.id === suggestedDropId);
    setDropPlayerId(suggestedDropOnRoster ? suggestedDropId : '');
    setBid('');
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
      notify('Waiver claim submitted');
      setClaimPlayer(null);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const handleCancelClaim = async (claim) => {
    try {
      setError(null);
      await apiClient.delete(`/api/waivers/claim/${claim.id}?leagueId=${leagueId}`);
      notify('Waiver claim cancelled', { severity: 'info' });
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
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
      <LeagueBreadcrumb />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Typography variant="h4">Waiver Wire</Typography>
            {isFaab ? (
              <Chip label={`FAAB remaining: $${data.myTeam.faab_remaining}`} />
            ) : (
              <Chip
                label={
                  data.myTeam.waiver_priority != null
                    ? `Waiver priority: #${data.myTeam.waiver_priority}`
                    : 'Waiver priority: TBD'
                }
              />
            )}
          </Box>

          <Paper sx={{ p: 2, mb: 3 }} data-testid="on-waivers-panel">
            <Typography variant="h6" sx={{ mb: 2 }}>
              On Waivers
            </Typography>
            {data.onWaivers.length === 0 ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  py: 6,
                }}
              >
                <SearchIcon sx={{ fontSize: 48, mb: 1, color: 'text.disabled' }} />
                <Typography sx={{ color: 'text.secondary', mb: 2 }}>No players on waivers</Typography>
                <Button component={RouterLink} to="/player?hide=1" variant="outlined">
                  Browse Players
                </Button>
              </Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Position</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>NFL Team</TableCell>
                      <TableCell>Clears</TableCell>
                      {!isBestBall && (
                        <TableCell align="center">
                          <TableSortLabel
                            active={sortByUpgrade}
                            direction={sortDir}
                            onClick={handleSortUpgrade}
                          >
                            Upgrade
                          </TableSortLabel>
                        </TableCell>
                      )}
                      <TableCell align="center" sx={stickyActionHeadSx}>
                        Action
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedOnWaivers.map((player) => {
                      const delta = upgradeByPlayerId.get(player.id);
                      return (
                        <TableRow key={player.id}>
                          <TableCell>
                            <PlayerNameLink name={player.name} playerId={player.id} onOpen={setQuickViewId} />
                          </TableCell>
                          <TableCell>{player.position}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            {player.nfl_team}
                          </TableCell>
                          <TableCell>
                            <Tooltip title={new Date(player.available_at).toLocaleString()}>
                              <span>{formatRelative(player.available_at)}</span>
                            </Tooltip>
                          </TableCell>
                          {!isBestBall && (
                            <TableCell align="center">
                              {delta != null && (
                                <Chip
                                  label={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`}
                                  size="small"
                                  color={delta > 0 ? 'success' : 'default'}
                                />
                              )}
                            </TableCell>
                          )}
                          <TableCell align="center" sx={stickyActionCellSx}>
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
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  py: 6,
                }}
              >
                <PersonAddDisabledIcon sx={{ fontSize: 48, mb: 1, color: 'text.disabled' }} />
                <Typography sx={{ color: 'text.secondary' }}>No claims yet</Typography>
              </Box>
            ) : (
              <Stack spacing={1.5}>
                {data.myClaims.map((claim) => (
                  <WaiverClaimItem
                    key={claim.id}
                    claim={claim}
                    isFaab={isFaab}
                    onCancel={handleCancelClaim}
                  />
                ))}
              </Stack>
            )}
          </Paper>
        </>
      )}

      <Dialog open={!!claimPlayer} onClose={handleCloseClaim}>
        <DialogTitle>
          Claim{' '}
          {claimPlayer && (
            <PlayerNameLink name={claimPlayer.name} playerId={claimPlayer.id} onOpen={setQuickViewId} />
          )}
        </DialogTitle>
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
              {sortedRosterForDrop.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.position})
                  {p.projected_weekly_points != null && (
                    <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                      weekly proj {p.projected_weekly_points}
                    </Typography>
                  )}
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
              error={bidInvalid}
              helperText={
                bidInvalid
                  ? `Enter a bid between $0 and $${faabRemaining}`
                  : `$${faabRemaining} remaining`
              }
              inputProps={{ min: 0, max: faabRemaining }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseClaim}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmitClaim} disabled={bidInvalid}>
            Submit Claim
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

export default WaiverWire;
