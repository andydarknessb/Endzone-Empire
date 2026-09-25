import React, { createContext, useContext, useCallback, useState } from 'react';
import { Snackbar, Alert, Box, Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { visuallyHidden } from '@mui/utils';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib';

/**
 * App-wide toast feedback. `useSnackbar()` returns a `notify` function:
 *   notify('Saved');                                  // success (default)
 *   notify('Failed to save', { severity: 'error' });
 *   notify('Player dropped', { actionLabel: 'Undo', onAction: reAdd });
 *
 * The default context value is a no-op so components that call it while
 * rendered outside the provider (e.g. isolated unit tests) don't crash.
 */
const SnackbarContext = createContext(() => {});

export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }) {
  const [snack, setSnack] = useState(null);
  const [open, setOpen] = useState(false);

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
  }, []);

  const handleClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const handleAction = () => {
    if (snack?.onAction) snack.onAction();
    setOpen(false);
  };

  return (
    <SnackbarContext.Provider value={notify}>
      {children}
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
          onClose={handleClose}
          sx={{ alignItems: 'center' }}
          action={
            <>
              {snack?.actionLabel && (
                <Button color="inherit" size="small" onClick={handleAction} sx={{ fontWeight: 700, ...MIN_TOUCH_TARGET_SX }}>
                  {snack.actionLabel}
                </Button>
              )}
              <IconButton aria-label="Dismiss notification" color="inherit" size="small" onClick={handleClose} sx={MIN_TOUCH_TARGET_SX}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
        >
          {snack?.message}
          {snack?.actionLabel && <Box component="span" sx={visuallyHidden}>{`. ${snack.actionLabel} available.`}</Box>}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export default SnackbarProvider;
