import React, { useState } from 'react';
import { Box } from '@mui/material';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { PsButton } from '../../../shared/ui/playselect';

/**
 * decide-join-request feature (#1109): the pair of Play-select buttons a
 * commissioner uses to decide one pending join request - Deny (ghost) and
 * Approve (fill on the `lead` request, else ghost) - POSTing `/api/league/:id/join-requests/:requestId/decide`
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
 * `<body>` before the request even lands. `aria-disabled` keeps the control
 * focusable and announced as disabled without that blur; the `busy` guard at
 * the top of `decide` is what actually blocks a second submit, from a pointer
 * click or from Enter/Space alike, since `aria-disabled` does not stop a click.
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
export default function DecideJoinRequest({ leagueId, requestId, teamName, lead = false, onDecided }) {
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

  // aria-disabled, never native disabled, while busy: see the note above. PsButton styles
  // [aria-disabled="true"] as disabled.
  const busyProps = busy ? { 'aria-disabled': 'true' } : null;

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {/* Deny first, always a ghost. Approve is the page's one filled action
            only on the `lead` (first pending) request; every other is a ghost
            (RULINGS: at most one filled action per page). */}
        <PsButton variant="ghost" ariaLabel={label('Deny')} onClick={() => decide(false)} {...busyProps}>
          Deny
        </PsButton>
        <PsButton variant={lead ? 'fill' : 'ghost'} ariaLabel={label('Approve')} onClick={() => decide(true)} {...busyProps}>
          Approve
        </PsButton>
      </Box>

      {/* The server's refusal. role="alert" makes a screen reader announce
          it when it appears. Prefixed with the Team name (see
          docblock) so it is attributable when more than one row is pending. */}
      {error && (
        <Box
          role="alert"
          sx={{ fontSize: '14px', padding: '8px 12px', border: '2px solid var(--ps-danger)' }}
        >
          {error}
        </Box>
      )}
    </Box>
  );
}
