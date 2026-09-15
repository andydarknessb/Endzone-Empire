import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableContainer,
  TableHead,
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
  Stack,
  Pagination,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddDisabledIcon from '@mui/icons-material/PersonAddDisabled';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerDecisionCard from '../../widgets/player-decision-card';
import { toDecisionCardEntry, PlayerNameLink } from '../../entities/player';
import PlayerRow, { PlayerRowTableHead } from '../../widgets/player-row';
import { useClaimPlayer } from '../../features/claim-player';
import WaiverClaimItem from './WaiverClaimItem';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { sortRosterForDrop } from '../../shared/lib';

// #1310 formal review f2: the On waivers table reuses `player-row` (the same
// widget PlayerManagement's Players list renders), read from
// `GET /api/players?view=cards&availability=waivers` rather than
// `/api/waivers`'s own raw `onWaivers` rows - the view=cards shape is what
// PlayerRow's columns (Proj Wk, ROS, Ownership, Upgrade, Weeks, Status) need.
// `/api/waivers` itself is untouched and still fetched, for `league`/`myTeam`/
// `myClaims` (the claims panel keeps its own read) - only the on-waivers ROWS
// move to the paginated cards endpoint.
//
// That endpoint pages at 25 (server-side, unconfigurable from the client).
// #1399: the table pages with it, the same way the Players list does
// (`?page=` in the URL, one cards read per page). It used to loop every page
// before first paint on the assumption that a waiver period holds fewer than
// 25 players; the kickoff hold (#1375, ADR 0043) puts every unrostered
// player on waivers for the week, so a real league has 3,500+ rows and that
// loop never finished.

function WaiverWire() {
  const { leagueId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const notify = useSnackbar();
  const [data, setData] = useState(null);
  const [cardsPlayers, setCardsPlayers] = useState([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsTotalPages, setCardsTotalPages] = useState(1);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [claimPlayer, setClaimPlayer] = useState(null);
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bid, setBid] = useState('');

  const [sortByUpgrade, setSortByUpgrade] = useState(false);
  const [sortDir, setSortDir] = useState('desc');
  const [quickViewId, setQuickViewId] = useState(null);
  // Once the user manually touches the Upgrade sort, stop auto-defaulting it
  // on every refetch.
  const manualSortRef = useRef(false);
  const claimTargetRequestRef = useRef(null);
  const pageNumber = Math.max(1, Number(searchParams.get('page')) || 1);
  const claimTargetParam = searchParams.get('playerId');
  const claimTargetId = /^\d+$/.test(claimTargetParam || '') ? Number(claimTargetParam) : null;

  useEffect(() => {
    fetchAll();
    // fetchAll closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // A page change re-reads the cards page only - the claims panel and the
  // roster are league facts, not page facts. Skipped on mount, where fetchAll
  // above already reads the requested page.
  const mountedPageRef = useRef(pageNumber);
  useEffect(() => {
    if (mountedPageRef.current === pageNumber) return;
    mountedPageRef.current = pageNumber;
    fetchCardsPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  useEffect(() => {
    if (!claimTargetId || claimTargetRequestRef.current === claimTargetId) return undefined;

    let cancelled = false;
    claimTargetRequestRef.current = claimTargetId;
    apiClient
      .get(`/api/waivers/claim-target?leagueId=${leagueId}&playerId=${claimTargetId}`)
      .then((response) => {
        if (cancelled) return;
        setError(null);
        setClaimPlayer(response.data.player);
        setDropPlayerId('');
        setBid('');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(readHttpFailure(err).message || err.message);
      })
      .finally(() => {
        if (!cancelled) {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete('playerId');
            return next;
          }, { replace: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [claimTargetId, leagueId, setSearchParams]);

  // ONE page of on-waivers players, view=cards-shaped (#1399).
  const fetchOnWaiversCards = async () => {
    const res = await apiClient.get('/api/players', {
      params: {
        view: 'cards',
        leagueId: Number(leagueId),
        availability: 'waivers',
        position: 'All',
        page: pageNumber,
      },
    });
    return {
      players: res.data.players || [],
      total: res.data.total ?? (res.data.players || []).length,
      totalPages: res.data.totalPages || 1,
    };
  };

  const applyCardsPage = ({ players, total, totalPages }) => {
    setCardsPlayers(players);
    setCardsTotal(total);
    setCardsTotalPages(totalPages);
    // A claim or a clear can shrink the list under a deep-linked page; land
    // on the last real page instead of an empty one.
    if (players.length === 0 && pageNumber > totalPages) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (totalPages <= 1) next.delete('page');
        else next.set('page', String(totalPages));
        return next;
      }, { replace: true });
    }
  };

  const fetchCardsPage = async () => {
    try {
      setError(null);
      applyCardsPage(await fetchOnWaiversCards());
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    }
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const [waiversRes, rosterRes, onWaiversCards] = await Promise.all([
        apiClient.get(`/api/waivers?leagueId=${leagueId}`),
        apiClient.get(`/api/team/roster?leagueId=${leagueId}`),
        // Required, not best-effort (formal review f2 constraint 3): a
        // failed read must surface the existing error state, not silently
        // render an empty table - the same Promise.all a rejection here
        // fails takes `data` down with it, and the page's own `{data && ...}`
        // gate is what keeps a stale or empty table from rendering instead
        // of the error Alert.
        fetchOnWaiversCards(),
      ]);
      setData(waiversRes.data);
      setRoster(rosterRes.data);
      applyCardsPage(onWaiversCards);
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
  };

  // Formal review round 1, f4: the submission itself is the one
  // implementation `claim-player` and this dialog now share - the dialog
  // stays as this page's own UI, and its `?playerId=` deep link above is
  // untouched.
  const { submitClaim } = useClaimPlayer({ leagueId, onDone: fetchAll });

  const isFaab = data?.league?.waiver_type === 'faab';
  const isBestBall = !!data?.league?.best_ball;

  // Default to the upgrade-desc sort once the cards read has landed, but only
  // until the user manually touches the sort control themselves. Upgrade is
  // never a real ranking in a best ball league (#1310, ADR 0040 Lead
  // correction item 5).
  useEffect(() => {
    if (!isBestBall && cardsPlayers.length > 0 && !manualSortRef.current) {
      setSortByUpgrade(true);
    }
  }, [isBestBall, cardsPlayers]);

  const handleSortUpgrade = () => {
    manualSortRef.current = true;
    if (!sortByUpgrade) {
      setSortByUpgrade(true);
      setSortDir('desc');
    } else {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    }
  };

  // Sorted within the page on hand, the same as the Players list.
  const sortedOnWaivers = [...cardsPlayers].sort((a, b) => {
    if (!sortByUpgrade || isBestBall) return 0;
    const av = a.upgrade?.points ?? -Infinity;
    const bv = b.upgrade?.points ?? -Infinity;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const faabRemaining = data?.myTeam?.faab_remaining ?? 0;
  const sortedRosterForDrop = sortRosterForDrop(roster);

  const bidIsValidNumber = bid !== '' && !Number.isNaN(Number(bid));
  const bidInvalid =
    isFaab && (!bidIsValidNumber || Number(bid) < 0 || Number(bid) > faabRemaining);

  // #1310 formal review f2 constraint 2: the suggested drop pick used to come
  // from a separate `/api/waivers/suggestions` read (`dropPlayerId`); the
  // view=cards payload's own per-row `upgrade.overPlayer` is the same fact
  // (the starter this player would replace), so it takes over that pairing
  // and the suggestions endpoint is never called from here anymore. A
  // `claimPlayer` opened from the blanket-waiver deep link (`claim-target`,
  // above) carries no `upgrade` at all, and falls back to no preselection,
  // exactly as it did when no suggestion matched before.
  const handleOpenClaim = (player) => {
    setError(null);
    setClaimPlayer(player);
    const suggestedDropId = player.upgrade?.overPlayer?.id ?? null;
    const suggestedDropOnRoster =
      suggestedDropId != null && roster.some((p) => p.id === suggestedDropId);
    setDropPlayerId(suggestedDropOnRoster ? suggestedDropId : '');
    setBid('');
  };

  const handleCloseClaim = () => {
    setClaimPlayer(null);
  };

  const handleSubmitClaim = async () => {
    setError(null);
    const { ok, message } = await submitClaim({
      playerId: claimPlayer.id,
      dropPlayerId: dropPlayerId === '' ? null : dropPlayerId,
      bid: isFaab ? Number(bid) : 0,
    });
    if (ok) setClaimPlayer(null);
    else setError(message);
  };

  const handleCancelClaim = async (claim) => {
    try {
      setError(null);
      await apiClient.delete(`/api/waivers/claim/${claim.id}?leagueId=${leagueId}`);
      notify('Waiver claim cancelled', { severity: 'info' });
      await fetchAll();
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      setError(message);
      notify(message, { severity: 'error' });
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
            <Typography id="on-waivers-table-heading" variant="h6" sx={{ mb: 2 }}>
              On Waivers
            </Typography>
            {cardsPlayers.length === 0 ? (
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
                <Table size="small" aria-labelledby="on-waivers-table-heading">
                  <TableHead>
                    <PlayerRowTableHead
                      bestBall={isBestBall}
                      upgradeSort={
                        isBestBall
                          ? undefined
                          : { active: sortByUpgrade, direction: sortDir, onClick: handleSortUpgrade }
                      }
                    />
                  </TableHead>
                  <TableBody>
                    {sortedOnWaivers.map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        bestBall={isBestBall}
                        onOpenPlayer={setQuickViewId}
                        action={{ kind: 'button', label: 'Claim', onClick: () => handleOpenClaim(player) }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {cardsTotal > 0 && (
              <Stack alignItems="center" spacing={0.75} sx={{ pt: 2 }}>
                {cardsTotalPages > 1 && (
                  <Pagination
                    count={cardsTotalPages}
                    page={Math.min(pageNumber, cardsTotalPages)}
                    onChange={(event, value) =>
                      setSearchParams((current) => {
                        const next = new URLSearchParams(current);
                        if (value <= 1) next.delete('page');
                        else next.set('page', String(value));
                        return next;
                      })
                    }
                    shape="rounded"
                  />
                )}
                <Typography variant="caption" color="text.secondary">
                  {cardsTotal} player{cardsTotal === 1 ? '' : 's'} on waivers
                </Typography>
              </Stack>
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

      <PlayerDecisionCard
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        entry={toDecisionCardEntry(
          cardsPlayers.find((p) => p.id === quickViewId) ||
            (claimPlayer && claimPlayer.id === quickViewId ? claimPlayer : null)
        )}
        leagueId={Number(leagueId)}
        context="waivers"
        availability={{
          waiverPriority: !isFaab ? data?.myTeam?.waiver_priority : undefined,
          faabRemaining: isFaab ? faabRemaining : undefined,
        }}
        roster={roster}
        onActionDone={fetchAll}
        // Second risk review, finding 3: the table renders `sortedOnWaivers`
        // (the Upgrade sort, on by default once the cards read loads), not
        // the raw fetch order - `playerIds` must name the SAME order or the
        // "Player N of M" caption and Next both point at the wrong row.
        playerIds={sortedOnWaivers.map((p) => p.id)}
        onNavigate={setQuickViewId}
      />
    </Container>
  );
}

export default WaiverWire;
