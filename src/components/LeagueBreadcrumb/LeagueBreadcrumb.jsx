import React from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { PsLink } from '../../shared/ui/playselect';

/**
 * A small back-link to the league dashboard, shown at the top of every league
 * subpage. Pass the league `name` when the page has it loaded; otherwise it
 * falls back to a generic label. A Play-select 44px link on `ps-*` tokens, no arrow icon.
 */
function LeagueBreadcrumb({ name }) {
  const { leagueId } = useParams();
  return (
    <Box component="nav" aria-label="Breadcrumb" sx={{ ml: '-10px' }}>
      <PsLink to={`/league/${leagueId}`}>{name || 'League dashboard'}</PsLink>
    </Box>
  );
}

export default LeagueBreadcrumb;
