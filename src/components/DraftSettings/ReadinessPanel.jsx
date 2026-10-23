import React from 'react';
import PropTypes from 'prop-types';
import { Box, Stack, Typography } from '@mui/material';
import { Dim, Note } from './kit';

export default function ReadinessPanel({ teams, draftType }) {
  const ready = teams.filter((team) => team.draft_ready).length;
  const insufficientTeams = teams.length < 2;
  return <Stack spacing={2}><Dim>Managers can mark themselves ready from the draft room. Autopick leagues treat every team as ready when the draft begins.</Dim>{draftType === 'autopick' && <Note>Autopick will make every team ready automatically.</Note>}{insufficientTeams && <Note>Add at least 2 teams to track draft readiness.</Note>}<Typography role="status" aria-live="polite">{ready} of {teams.length} managers ready</Typography><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{teams.map((team) => <Box key={team.id} component="span" sx={{ border: '2px solid', borderColor: team.draft_ready ? 'var(--ps-ink)' : 'var(--ps-dim)', padding: '4px 10px', fontSize: '14px', fontWeight: 600 }}>{`${team.name}: ${team.draft_ready ? 'Ready' : 'Not ready'}`}</Box>)}</Stack></Stack>;
}

ReadinessPanel.propTypes = { teams: PropTypes.array.isRequired, draftType: PropTypes.string };
