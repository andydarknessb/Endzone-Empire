import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Link, Box } from '@mui/material';

/**
 * A small back-link to the league dashboard, shown at the top of every league
 * subpage. Pass the league `name` when the page has it loaded; otherwise it
 * falls back to a generic label.
 */
function LeagueBreadcrumb({ name }) {
  const { leagueId } = useParams();
  return (
    <Box sx={{ mb: 2 }}>
      <Link
        component={RouterLink}
        to={`/league/${leagueId}`}
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}
      >
        ← {name || 'League dashboard'}
      </Link>
    </Box>
  );
}

export default LeagueBreadcrumb;
