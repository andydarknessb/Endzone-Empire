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
 * in as `onDecided` and called only after a successful decision, with
 * `{ approve, teamName }` so the widget can announce what happened.
 *
 * `teamName` (a11y risk review, #1109): CommissionerTools' own Join Requests
 * section (GeneralSettingsPanel, `is_public && join_approval`) mounts by
 * default alongside this widget on the commissioner-console page - its
 * `selectedTab` starts on `'general'`, the tab that section lives on - so a
 * bare "Approve"/"Deny" accessible name here would collide with that
 * component's own same-named buttons, and with every OTHER pending row's
 * buttons in this same list. `aria-label` folds the proposed Team name in
 * (still leading with the visible word, so WCAG 2.5.3 Label-in-Name holds for
 * voice control), which is the same fix CommissionerTools' own per-row Remove
 * button already uses (`aria-label={`Remove ${team.name}`}`, CommissionerTools
 * .jsx). A caller with no name to give still gets a working, merely
 * ambiguous, control rather than a crash.
 *
 * Busy uses `aria-disabled`, never the native `disabled` attribute (a11y risk
 * review): disabling a native button the instant it is activated forces the
 * browser to blur it (the HTML "focus fixup" rule), dropping keyboard focus to
 * `<body>` before the request even lands. `aria-disabled` plus `pointerEvents:
 * 'none'` keeps the control focusable and announced as disabled without that
 * blur; the `busy` guard at the top of `decide` is what actually blocks a
 * second submit, since a focused native button still dispatches a `click` on
 * Enter/Space regardless of `pointer-events` (a CSS hit-testing property, not
 * a keyboard gate).
 *
 * The refusal is shown as the server wrote it, read through the shared
 * `readHttpFailure` reader (src/lib/httpFailure.js) exactly as `AdvanceWeek`
 * does, never rebuilt from the status code, prefixed with the Team name so a
 * screen-reader user - whose focus is not necessarily still on this row - can
 * tell which request failed. The local fallback below is only for a failure
 * that carries no server sentence (a dropped connection has no 409 body to
 * quote). The row stays in the list either way - this feature never removes
 * it; only the widget's own re-read (after a successful decision) changes
 * what the list shows.
 */
export default function DecideJoinRequest({ leagueId, requestId, teamName, onDecided }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const decide = async (approve) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/league/${leagueId}/join-requests/${requestId}/decide`, { approve });
      if (typeof onDecided === 'function') await onDecided({ approve, teamName });
    } catch (err) {
      const message = readHttpFailure(err).message || err?.message || 'Could not record that decision.';
      setError(teamName ? `${teamName}: ${message}` : message);
    } finally {
      setBusy(false);
    }
  };

  const label = (verb) => (teamName ? `${verb} ${teamName}'s join request` : verb);

  // Only the CSS half of "looks and behaves disabled" while busy - see the
  // aria-disabled note above for why the native attribute is never used.
  const busySx = busy ? { pointerEvents: 'none', opacity: 0.6 } : null;

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
          aria-disabled={busy || undefined}
          aria-label={label('Deny')}
          onClick={() => decide(false)}
          sx={{ ...MIN_TOUCH_TARGET_SX, width: { xs: '100%', md: 'auto' }, textTransform: 'none', ...busySx }}
        >
          Deny
        </Button>
        <Button
          type="button"
          variant="contained"
          color="success"
          aria-disabled={busy || undefined}
          aria-label={label('Approve')}
          onClick={() => decide(true)}
          sx={{ ...MIN_TOUCH_TARGET_SX, width: { xs: '100%', md: 'auto' }, textTransform: 'none', ...busySx }}
        >
          Approve
        </Button>
      </Box>

      {/* The server's refusal. MUI Alert carries role="alert", so a screen
          reader hears it when it appears. Prefixed with the Team name (see
          docblock) so it is attributable when more than one row is pending. */}
      {error && (
        <Alert severity="error" sx={{ fontSize: '13px' }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
