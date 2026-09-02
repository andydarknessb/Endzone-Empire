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
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState('');
  const startInFlight = useRef(false);
  const insufficientTeams = teamCount < minimumTeams;
  // The player market's state (#748): absent when fewer than `floor` players
  // carry an ADP (blocks Start the same as the team-count case), stale when a
  // market is present but its last sync is old (Start stays available), or
  // fresh (no line at all). `market` is optional so a caller without it yet
  // (a stale cache, a payload that predates this field) renders neither state.
  const marketAbsent = Boolean(market) && market.adpPlayers < market.floor;
  const marketStale = Boolean(market) && !marketAbsent && market.stale;
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
      {marketAbsent && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {`The player market has not loaded (${market.adpPlayers} of ${market.floor} players carry an ADP). Ask your admin to run the ADP sync.`}
        </Typography>
      )}
      {marketStale && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {`Player market last updated ${formatRelative(market.lastSyncAt)}. Autopicks will use that market.`}
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
};
