import React from 'react';
import { Chip, Stack, Typography } from '@mui/material';
import { teamNameLabel, teamRowKey } from '../../lib/teamIdentity';

/**
 * Who can change these rules. Shown to every member — the settings themselves
 * are read-only here, so the natural follow-up question is "then who do I ask?".
 *
 * Every member reads this, so the officials are named by Team and never by
 * account (#113, contract #112). A co-commissioner grant can outlive the team
 * it was granted to, which is why #112 joins LEFT and why that entry reads
 * back with no Team identity at all; it is named as a former manager rather
 * than dropped, because someone still has to be able to see the grant in
 * order to revoke it.
 */
export default function LeagueOfficials({ league }) {
  const coCommissioners = league.co_commissioners || [];
  if (!league.ownerTeamName && coCommissioners.length === 0) return null;

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
      <Typography variant="body2" color="text.secondary">Who can change these:</Typography>
      {league.ownerTeamName && (
        <Chip size="small" variant="outlined" label={`${teamNameLabel(league.ownerTeamName)} · commissioner`} />
      )}
      {coCommissioners.map((c, index) => (
        <Chip
          key={teamRowKey(c.teamId, index)}
          size="small"
          variant="outlined"
          label={`${teamNameLabel(c.teamName)} · co-commissioner`}
        />
      ))}
    </Stack>
  );
}
