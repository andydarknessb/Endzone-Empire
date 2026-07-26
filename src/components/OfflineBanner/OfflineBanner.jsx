import React, { useEffect, useState } from 'react';
import { Box, Alert } from '@mui/material';

/**
 * Slim, fixed banner that tells the user they've lost connectivity and any
 * league data on screen may be a cached (stale) copy served by the service
 * worker rather than a live fetch. Plain conditional render (no
 * Snackbar/transition) so it appears and disappears in lockstep with the
 * online/offline events, with nothing lingering mid-exit-animation.
 */
function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: (theme) => theme.zIndex.snackbar }}>
      <Alert severity="warning" variant="filled" square>
        You&apos;re offline, showing cached data
      </Alert>
    </Box>
  );
}

export default OfflineBanner;
