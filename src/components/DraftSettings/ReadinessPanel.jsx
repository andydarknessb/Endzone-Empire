import React from 'react';
import PropTypes from 'prop-types';
import { Alert, Chip, Stack, Typography } from '@mui/material';

export default function ReadinessPanel({ teams, draftType }) {
  const ready = teams.filter((team) => team.draft_ready).length;
  const insufficientTeams = teams.length < 2;
  return <Stack spacing={2}><Typography variant="body2" color="text.secondary">Managers can mark themselves ready from the draft room. Autopick leagues treat every team as ready when the draft begins.</Typography>{draftType === 'autopick' && <Alert severity="info">Autopick will make every team ready automatically.</Alert>}{insufficientTeams && <Alert severity="info">Add at least 2 teams to track draft readiness.</Alert>}<Typography role="status" aria-live="polite">{ready} of {teams.length} managers ready</Typography><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{teams.map((team) => <Chip key={team.id} color={team.draft_ready ? 'success' : 'default'} label={`${team.name}: ${team.draft_ready ? 'Ready' : 'Not ready'}`} />)}</Stack></Stack>;
}

ReadinessPanel.propTypes = { teams: PropTypes.array.isRequired, draftType: PropTypes.string };
