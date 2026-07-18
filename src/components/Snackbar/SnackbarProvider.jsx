import React, { createContext, useContext, useCallback, useState } from 'react';
import { Snackbar, Alert, Button, IconButton } from '@mui/material';

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
      // Reversible actions linger longer so the Undo is reachable.
      duration: options.duration ?? (options.onAction ? 8000 : 4000),
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
                <Button color="inherit" size="small" onClick={handleAction} sx={{ fontWeight: 700 }}>
                  {snack.actionLabel}
                </Button>
              )}
              <IconButton aria-label="Dismiss notification" color="inherit" size="small" onClick={handleClose}>
                ✕
              </IconButton>
            </>
          }
        >
          {snack?.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export default SnackbarProvider;
