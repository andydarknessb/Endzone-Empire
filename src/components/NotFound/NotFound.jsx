import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Typography, Button, Stack } from '@mui/material';

/**
 * Themed 404 fallback. Replaces the old bare <h1>404</h1>, which rendered
 * unstyled default text (unreadable in dark mode).
 */
function NotFound() {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 8, md: 12 } }}>
      <Stack spacing={2} alignItems="center" textAlign="center">
        <Typography variant="h1" component="h1" sx={{ fontWeight: 800, lineHeight: 1 }}>
          404
        </Typography>
        <Typography variant="h5" component="p">
          This page ran out of bounds
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          We couldn&apos;t find the page you were looking for. It may have been
          moved, or the link might be broken.
        </Typography>
        <Box sx={{ pt: 1 }}>
          <Button component={RouterLink} to="/home" variant="contained" size="large">
            Back to home
          </Button>
        </Box>
      </Stack>
    </Container>
  );
}

export default NotFound;
