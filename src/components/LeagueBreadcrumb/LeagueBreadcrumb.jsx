import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Button, Box } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

/**
 * A small back-link to the league dashboard, shown at the top of every league
 * subpage. Pass the league `name` when the page has it loaded; otherwise it
 * falls back to a generic label.
 */
function LeagueBreadcrumb({ name }) {
  const { leagueId } = useParams();
  return (
    <Box component="nav" aria-label="Breadcrumb" sx={{ mb: 2 }}>
      <Button
        component={RouterLink}
        to={`/league/${leagueId}`}
        startIcon={<ArrowBackIcon />}
        sx={{ fontWeight: 600, ...MIN_TOUCH_TARGET_SX }}
      >
        {name || 'League dashboard'}
      </Button>
    </Box>
  );
}

export default LeagueBreadcrumb;
