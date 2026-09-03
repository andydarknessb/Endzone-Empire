import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material';
import { formatRelative } from '../../utils/formatRelative';

/**
 * The commissioner-only pending-draft start action. Both the Draft room and
 * the full settings page use the same confirmation, disabled-state, and
 * request-error behavior so the entry point cannot change the safety model.
 *
 * `showHints` and `showMarketStatus` (#748, 758-f3) are separate switches on
 * purpose: `showHints` suppresses the team-count/auction lines when a caller
 * already shows that same information elsewhere (SchedulePanel's own "N of M
 * required teams" caption, for one) - it says nothing about whether the
 * market status has a redundant home too, so market status gets its own flag
 * rather than being unsuppressable, or suppressed as a side effect of a flag
 * about different information.
 */
export default function DraftStartControl({
  teamCount,
  minimumTeams,
  auctionUnavailable,
  market,
  onStart,
  label = 'Start Draft',
  variant = 'contained',
  disabled = false,
  showHints = true,
  showMarketStatus = true,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState('');
  const startInFlight = useRef(false);
  const insufficientTeams = teamCount < minimumTeams;
  // The player market's state (#748, amended #773): absent when fewer than
  // `floor` players carry an ADP (blocks Start the same as the team-count
  // case); stale when a market is present, its last sync is old, and that
  // sync has a timestamp worth naming (Start stays available); never-synced
  // when a market is present but no sync has ever been recorded, so there is
  // no timestamp to name (Start stays available, same as stale); or fresh
  // (no line at all). `market` is optional so a caller without it yet (a
  // stale cache, a payload that predates this field) renders none of these.
  const marketAbsent = Boolean(market) && market.adpPlayers < market.floor;
  // `market.stale` (getMarketStatus, #748) is true for two different facts:
  // the last sync is old, OR there has never been a recorded sync at all -
  // and only the first has a timestamp worth showing. `lastSyncAt` is null
  // for the second, and formatRelative(null) reads as the Unix epoch ("Dec
  // 31, 1969") rather than failing visibly (758-f1), so `marketStale` still
  // requires `lastSyncAt != null` and must never be loosened to admit the
  // null case: doing so would print a date nobody measured.
  const marketStale = Boolean(market) && !marketAbsent && market.stale && market.lastSyncAt != null;
  // The never-synced state (#773) is the other half of `market.stale`: a
  // market present with no recorded sync at all, `lastSyncAt` null. A market
  // present with no recorded sync is not evidence the market is old - it is
  // absence of evidence either way - so this branch gets its own copy that
  // never claims an age, rather than being folded into `marketStale` (which
  // would require loosening its `lastSyncAt != null` guard and reintroducing
  // the epoch bug) or left silent (which was the interim fix in #758, before
  // product ruled on copy for this state). `market.stale` is redundant here
  // (the service sets it true whenever `lastSyncAt` is null) and is
  // deliberately not part of this condition.
  const marketNeverSynced = Boolean(market) && !marketAbsent && market.lastSyncAt == null;
  const unavailable = insufficientTeams || auctionUnavailable || marketAbsent;

  const closeConfirmation = () => {
    if (startInFlight.current) return;
    setStartError('');
    setConfirmOpen(false);
  };

  const handleStart = async () => {
    if (startInFlight.current) return;
    startInFlight.current = true;
    setStartPending(true);
    setStartError('');
    try {
      const result = await onStart();
      if (!result?.success) {
        setStartError(result?.error || 'The draft could not be started.');
        return;
      }
      setConfirmOpen(false);
    } catch (error) {
      setStartError(error?.response?.data?.error || error?.message || 'The draft could not be started.');
    } finally {
      startInFlight.current = false;
      setStartPending(false);
    }
  };

  const tooltipTitle = insufficientTeams
    ? `Need at least ${minimumTeams} teams to start the draft (currently ${teamCount})`
    : auctionUnavailable
      ? 'Salary-cap auctions are not supported yet'
      : marketAbsent
        ? 'The player market has not loaded'
        : '';

  return (
    <Box>
      <Tooltip title={tooltipTitle}>
        <span>
          <Button
            variant={variant}
            onClick={() => {
              setStartError('');
              setConfirmOpen(true);
            }}
            disabled={disabled || startPending || unavailable}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
      {showHints && insufficientTeams && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          Requires a minimum of {minimumTeams} teams to start the draft.
        </Typography>
      )}
      {showHints && auctionUnavailable && !insufficientTeams && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          Live salary-cap auctions are not supported yet.
        </Typography>
      )}
      {showMarketStatus && marketAbsent && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {`The player market has not loaded (${market.adpPlayers} of ${market.floor} players carry an ADP). Ask your admin to run the ADP sync.`}
        </Typography>
      )}
      {showMarketStatus && marketStale && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {`Player market last updated ${formatRelative(market.lastSyncAt)}. Autopicks will use that market.`}
        </Typography>
      )}
      {showMarketStatus && marketNeverSynced && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {`Player market loaded (${market.adpPlayers} players carry an ADP), but no sync has been recorded. Autopicks will use that market.`}
        </Typography>
      )}
      <Dialog open={confirmOpen} onClose={closeConfirmation} aria-labelledby="start-draft-dialog-title">
        <DialogTitle id="start-draft-dialog-title">Start draft now?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This starts immediately for all {teamCount} managers and can&apos;t be easily undone.
          </DialogContentText>
          {startError && <Alert severity="error" sx={{ mt: 2 }}>{startError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={startPending} onClick={closeConfirmation}>Cancel</Button>
          <Button variant="contained" disabled={startPending} onClick={handleStart}>
            {startPending ? 'Starting…' : 'Start now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

DraftStartControl.propTypes = {
  teamCount: PropTypes.number.isRequired,
  minimumTeams: PropTypes.number.isRequired,
  auctionUnavailable: PropTypes.bool,
  market: PropTypes.shape({
    adpPlayers: PropTypes.number,
    floor: PropTypes.number,
    lastSyncAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    stale: PropTypes.bool,
  }),
  onStart: PropTypes.func.isRequired,
  label: PropTypes.string,
  variant: PropTypes.string,
  disabled: PropTypes.bool,
  showHints: PropTypes.bool,
  showMarketStatus: PropTypes.bool,
};
