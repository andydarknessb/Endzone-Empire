import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Button, Box } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * A small back-link to the league dashboard, shown at the top of every league
 * subpage. Pass the league `name` when the page has it loaded; otherwise it
 * falls back to a generic label.
 */
function LeagueBreadcrumb({ name }) {
  const { leagueId } = useParams();
  return (
    <Box sx={{ mb: 2 }}>
      <Button
        component={RouterLink}
        to={`/league/${leagueId}`}
        startIcon={<ArrowBackIcon />}
        sx={{ fontWeight: 600 }}
      >
        {name || 'League dashboard'}
      </Button>
    </Box>
  );
}

export default LeagueBreadcrumb;
