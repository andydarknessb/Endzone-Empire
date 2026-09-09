import React, { useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';

/**
 * decide-join-request feature (#1109): the pair of MUI Buttons a commissioner
 * uses to decide one pending join request - Deny (outlined) and Approve
 * (contained) - POSTing `/api/league/:id/join-requests/:requestId/decide`
 * with `{ approve }`, the mutation CommissionerTools' own Join Requests tab
 * fires today (CommissionerTools.jsx's `handleDecideJoinRequest`).
 *
 * This feature owns the POST and its outcome ONLY, the same split
 * `advance-week` draws with the panel that composes it (AdvanceWeek.jsx's own
 * docblock): re-reading the queue is the `join-requests` widget's job, handed
 * in as `onDecided` and called only after a successful decision. Both buttons
 * disable together while a decision is in flight, so a slow network cannot
 * let a second click fire a second POST for the same request.
 *
 * The refusal is shown as the server wrote it, read through the shared
 * `readHttpFailure` reader (src/lib/httpFailure.js) exactly as `AdvanceWeek`
 * does, never rebuilt from the status code. The local fallback below is only
 * for a failure that carries no server sentence (a dropped connection has no
 * 409 body to quote). The row stays in the list either way - this feature
 * never removes it; only the widget's own re-read (after a successful
 * decision) changes what the list shows.
 */
export default function DecideJoinRequest({ leagueId, requestId, onDecided }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const decide = async (approve) => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/league/${leagueId}/join-requests/${requestId}/decide`, { approve });
      if (typeof onDecided === 'function') await onDecided();
    } catch (err) {
      setError(readHttpFailure(err).message || err?.message || 'Could not record that decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {/* Deny first, outlined: the mockup's error-toned refusal button, the
            same order and emphasis CommissionerTools' own tab uses. Full-width
            below `md` (the ticket's own responsive rule), auto width from
            there. */}
        <Button
          type="button"
          variant="outlined"
          color="error"
          disabled={busy}
          onClick={() => decide(false)}
          sx={{ ...MIN_TOUCH_TARGET_SX, width: { xs: '100%', md: 'auto' }, textTransform: 'none' }}
        >
          Deny
        </Button>
        <Button
          type="button"
          variant="contained"
          color="success"
          disabled={busy}
          onClick={() => decide(true)}
          sx={{ ...MIN_TOUCH_TARGET_SX, width: { xs: '100%', md: 'auto' }, textTransform: 'none' }}
        >
          Approve
        </Button>
      </Box>

      {/* The server's refusal. MUI Alert carries role="alert", so a screen
          reader hears it when it appears. */}
      {error && (
        <Alert severity="error" sx={{ fontSize: '13px' }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
