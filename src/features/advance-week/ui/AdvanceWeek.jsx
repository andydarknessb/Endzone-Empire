import React, { useState } from 'react';
import { Box, Dialog } from '@mui/material';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { PsButton, PsLinkButton, psRootSx, pixelSx } from '../../../shared/ui/playselect';

/**
 * advance-week feature (ADR 0020): the commissioner's control to close the
 * current scoring week and open the next. A sentence stating the consequence, a
 * button that opens a confirm dialog, and - after a refusal - the server's own
 * message.
 *
 * This feature owns the POST and its outcome ONLY. Landing the cached league
 * refetch on success is the PANEL's job, handed in as `onAdvanced`: advancing
 * changes `league.current_week`, and the standings widgets are keyed on that
 * week (useStandings, #641), so the league refetch is what re-reads them. This
 * feature deliberately does NOT touch the standings cache. If it called
 * clearStandingsCache here, that invalidation would reload every standings
 * table still mounted on the prior week's key BEFORE the league refetch re-keys
 * them to the new week, firing one standings request that the re-key then fires
 * again - two reads where the week key already guarantees one fresh read. So a
 * clear here does not reflect the new standings any sooner; it only doubles the
 * request.
 *
 * The 409 path is a contract. The phase gate refuses a fantasy league whose
 * draft has not finished with a manager-readable sentence, and this shows that
 * sentence in an alert region, read from the failure through the shared
 * `readHttpFailure` reader (src/lib/httpFailure.js) rather than reached out of
 * `err.response.data` by hand. The reader understands the several envelope
 * shapes the server reports a failure in and returns the human sentence
 * whichever key carried it, so what shows is still the server's own sentence
 * and never a message this feature builds from the status code. The sentence is
 * shown as the server wrote it; the reader chooses which field is the sentence,
 * it does not rewrite the copy. When the failure carries no server sentence (a
 * dropped connection has no 409 body to quote), the local fallback below shows
 * instead. The button stays enabled so the commissioner can retry once the
 * draft completes.
 *
 * `disabledReason` (optional, #2330): a sentence that disables the button and is
 * shown beside it, linked with aria-describedby. Unset leaves the control as it
 * was. The caller decides when the week may not advance (see `allWeekSettled`). `onRetry` adds a "Try again" control to the reason, for a reason that is a failed check.
 *
 * Used by the League Dashboard's commissioner strip (#2330) and by the Commissioner console, in the shared Play-select controls.
 * The button is a ghost (on the dashboard the page's one filled action is the lead play in Your move, never this),
 * the sentence and the reason are Archivo on the frame, and the confirm dialog is a double-ruled frame.
 */
export default function AdvanceWeek({
  leagueId, currentWeek, onAdvanced, disabledReason, onRetry,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nextWeek = Number(currentWeek) + 1;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/scoring/league/${leagueId}/advance-week`, { week: Number(currentWeek) });
      setOpen(false);
      if (typeof onAdvanced === 'function') onAdvanced();
    } catch (err) {
      // Show the server's own failure sentence, read through the shared
      // readHttpFailure reader so the several envelope shapes the server uses
      // all resolve to the human sentence. The fallback is only for a failure
      // that carries no server sentence (a dropped connection has no 409 body
      // to quote).
      setOpen(false);
      setError(readHttpFailure(err).message || err?.message || 'Could not advance the week.');
    } finally {
      setBusy(false);
    }
  };

  const sentence = disabledReason
    || `Advancing closes Week ${currentWeek} matchups and opens Week ${nextWeek}. You'll be asked to confirm.`;
  return (
    <Box
      data-testid="advance-week"
      sx={{
        width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: '15px', fontWeight: 600 }}>Advance week</Box>
        <Box
          id={disabledReason ? 'advance-week-disabled-reason' : undefined}
          sx={{ fontSize: '14px', color: 'var(--ps-dim)', maxWidth: '60ch' }}
        >
          {sentence}
        </Box>
        {disabledReason && onRetry && (
          <PsLinkButton onClick={onRetry} aria-label={`Try checking Week ${currentWeek} games again`}>Try again</PsLinkButton>
        )}
      </Box>
      <PsButton
        variant="ghost"
        disabled={busy || !!disabledReason}
        describedBy={disabledReason ? 'advance-week-disabled-reason' : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {`Advance to Week ${nextWeek}`}
      </PsButton>
      {error && <Box role="alert" sx={{ width: '100%', fontSize: '14px' }}>{error}</Box>}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby="advance-week-dialog-title"
        aria-describedby="advance-week-dialog-description"
        PaperProps={{
          className: 'ps-root',
          sx: {
            ...psRootSx, border: '6px double var(--ps-frame)', borderRadius: 0, backgroundColor: 'var(--ps-panel)', backgroundImage: 'none', boxShadow: 'none',
          },
        }}
      >
        <Box sx={{ padding: '14px 20px', borderBottom: '2px solid var(--ps-rule)' }}>
          <Box component="h2" id="advance-week-dialog-title" sx={{ m: 0, ...pixelSx(16) }}>{`Advance to Week ${nextWeek}?`}</Box>
        </Box>
        <Box id="advance-week-dialog-description" sx={{ padding: '16px 20px', fontSize: '16px', maxWidth: '60ch' }}>
          {`This closes Week ${currentWeek} matchups and opens Week ${nextWeek}. Week ${currentWeek} is scored as played, and this cannot be undone from here.`}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '0 20px 16px' }}>
          <PsButton variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</PsButton>
          <PsButton variant="ghost" onClick={handleConfirm} disabled={busy}>Confirm</PsButton>
        </Box>
      </Dialog>
    </Box>
  );
}
