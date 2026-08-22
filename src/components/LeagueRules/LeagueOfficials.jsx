import React from 'react';
import { Chip, Stack, Typography } from '@mui/material';

/**
 * Who can change these rules. Shown to every member — the settings themselves
 * are read-only here, so the natural follow-up question is "then who do I ask?".
 */
export default function LeagueOfficials({ league }) {
  const coCommissioners = league.co_commissioners || [];
  if (!league.owner_username && coCommissioners.length === 0) return null;

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
      <Typography variant="body2" color="text.secondary">Who can change these:</Typography>
      {league.owner_username && (
        <Chip size="small" variant="outlined" label={`${league.owner_username} · commissioner`} />
      )}
      {coCommissioners.map((c) => (
        <Chip key={c.user_id} size="small" variant="outlined" label={`${c.username} · co-commissioner`} />
      ))}
    </Stack>
  );
}
