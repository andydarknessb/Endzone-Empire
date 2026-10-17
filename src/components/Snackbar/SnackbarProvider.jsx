import React, { createContext, useContext, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Snackbar, Alert, Box, Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { visuallyHidden } from '@mui/utils';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';

/**
 * App-wide toast feedback. `useSnackbar()` returns a `notify` function:
 *   notify('Saved');                                  // success (default)
 *   notify('Failed to save', { severity: 'error' });
 *   notify('Player dropped', { actionLabel: 'Undo', onAction: reAdd });
 *
 * The default context value is a no-op so components that call it while
 * rendered outside the provider (e.g. isolated unit tests) don't crash.
 *
 * Live regions (spec #2347 ruling 4): a screen reader announces a CHANGE inside a live region that is already
 * in the page, and often skips one that mounts holding its text, which is what a toast remounted per message
 * is. So the provider keeps ONE screen-reader-only polite region and ONE assertive region (errors) mounted
 * for good and sets their text when a toast opens (a repeat of the same sentence clears first, then sets); the toast itself is `role="presentation"` with its
 * message `aria-hidden` (the region is the one copy a screen reader gets) and its Undo and Dismiss buttons outside
 * every live region.
 * The two regions are `aria-live` divs (what `role="status"` and `role="alert"` expand to) with no ARIA role
 * of their own: a role on a node every page carries would answer every `getByRole('status')` and
 * `getByRole('alert')` in every page's tests, and a page's own status and alert would no longer be the only one.
 * Find them by `data-testid="toast-status"` and `"toast-alert"`.
 */
const SnackbarContext = createContext(() => {});

// How long a region sits empty before the SAME sentence is set again (a repeat is not a change until it is cleared first):
// long enough that a screen reader has registered the clear.
const ANNOUNCE_DELAY_MS = 120;


export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }) {
  const [snack, setSnack] = useState(null);
  const [open, setOpen] = useState(false);
  // What the two always-mounted regions say; '' when no toast is up.
  const [live, setLive] = useState({ status: '', alert: '' });
  const announceTimer = useRef(null);
  const liveText = useRef('');
  const statusId = useId();
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const notify = useCallback((message, options = {}) => {
    setSnack({
      message,
      severity: options.severity || 'success',
      actionLabel: options.actionLabel,
      onAction: options.onAction,
      // Reversible actions linger 20s (WCAG 2.2.1 floor) so the Undo is reachable;
      // MUI still pauses the timer while the toast has focus or hover.
      duration: options.duration ?? (options.onAction ? 20000 : 4000),
      key: Date.now(),
    });
    setOpen(true);
    // The regions are already in the page, so setting their text is the change a screen reader announces. The same
    // sentence again is no change: clear it and set it after a beat.
    const text = `${message}${options.actionLabel ? `. ${options.actionLabel} available.` : ''}`;
    const next = options.severity === 'error' ? { status: '', alert: text } : { status: text, alert: '' };
    clearTimeout(announceTimer.current);
    if (liveText.current === text) {
      setLive({ status: '', alert: '' });
      announceTimer.current = setTimeout(() => setLive(next), ANNOUNCE_DELAY_MS);
    } else {
      setLive(next);
    }
    liveText.current = text;
  }, []);

  const handleClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setOpen(false);
    clearTimeout(announceTimer.current);
    liveText.current = '';
    setLive({ status: '', alert: '' });
  };

  const handleAction = (event) => {
    // The toast is about to close with the button in it: hand focus back to the page now, as the browser would when
    // the button unmounts, so a caller that restores focus after Undo sees it on <body> and not on a toast.
    event?.currentTarget?.blur?.();
    if (snack?.onAction) snack.onAction();
    setOpen(false);
    clearTimeout(announceTimer.current);
    liveText.current = '';
    setLive({ status: '', alert: '' });
  };

  return (
    <SnackbarContext.Provider value={notify}>
      {children}
      <Box component="div" id={statusId} data-testid="toast-status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>{live.status}</Box>
      <Box component="div" data-testid="toast-alert" aria-live="assertive" aria-atomic="true" sx={visuallyHidden}>{live.alert}</Box>
      <Snackbar
        key={snack?.key}
        open={open}
        autoHideDuration={snack?.duration}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack?.severity || 'success'}
          variant="filled"
          // The live region is the message text alone (below), never the Alert root: its Undo and Dismiss buttons
          // sit outside it (spec #2347 ruling 4, live regions hold text only).
          role="presentation"
          onClose={handleClose}
          sx={{ alignItems: 'center', '& .MuiAlert-message': { whiteSpace: 'pre-line' } }}
          action={
            <>
              {snack?.actionLabel && (
                // The visible message is aria-hidden, so the button says what it undoes through its description, the
                // status region's sentence (its name stays "Undo": label-in-name).
                <Button color="inherit" size="small" aria-describedby={statusId} onClick={handleAction} sx={{ fontWeight: 700, ...MIN_TOUCH_TARGET_SX }}>
                  {snack.actionLabel}
                </Button>
              )}
              <IconButton aria-label="Dismiss notification" color="inherit" size="small" onClick={handleClose} sx={MIN_TOUCH_TARGET_SX}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
        >
          {/* Hidden from assistive tech: the status region above is the one copy a screen reader gets. */}
          <Box component="span" aria-hidden="true">{snack?.message}</Box>
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export default SnackbarProvider;
