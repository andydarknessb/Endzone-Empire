import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Button, Box } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { PsLink } from '../../shared/ui/playselect';

/**
 * A small back-link to the league dashboard, shown at the top of every league
 * subpage. Pass the league `name` when the page has it loaded; otherwise it
 * falls back to a generic label.
 *
 * `look`: `'dash'` (default, every current caller) or `'playselect'` (ADR 0067 wave 3, Waivers and
 * Trade Center): the same one-link trail as a Play-select 44px link on `ps-*` tokens, no arrow icon.
 */
function LeagueBreadcrumb({ name, look = 'dash' }) {
  const { leagueId } = useParams();
  if (look === 'playselect') {
    return (
      <Box component="nav" aria-label="Breadcrumb" sx={{ ml: '-10px' }}>
        <PsLink to={`/league/${leagueId}`}>{name || 'League dashboard'}</PsLink>
      </Box>
    );
  }
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
