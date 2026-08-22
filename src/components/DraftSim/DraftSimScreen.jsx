import React from 'react';
import { Box, Container, Typography } from '@mui/material';
import DraftSimulator from './DraftSimulator';

/**
 * The logged-in wrapper for the mock draft. Thin on purpose: the simulator is
 * fully client-side and identical for signed-in and signed-out visitors, so the
 * only difference here is the app chrome around it (Nav/Footer come from
 * AppLayout) and the absence of the public tree's conversion banner.
 */
function DraftSimScreen() {
  return (
    <Container maxWidth="lg" sx={{ pb: 6 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
          Mock Draft
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1, maxWidth: 720 }}>
          Practice your draft against CPU managers before the real thing. Nothing here touches your
          leagues. It&apos;s a sandbox, and your in-progress draft survives a refresh.
        </Typography>
      </Box>
      <DraftSimulator />
    </Container>
  );
}

export default DraftSimScreen;
