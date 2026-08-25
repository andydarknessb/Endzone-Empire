import React from 'react';
import { Chip, Stack, Typography } from '@mui/material';
import { teamNameLabel, teamRowKey } from '../../lib/teamIdentity';

/**
 * Who can change these rules. Shown to every member — the settings themselves
 * are read-only here, so the natural follow-up question is "then who do I ask?".
 *
 * Every member reads this, so the officials are named by Team and never by
 * account (#113, contract #112). Since #324 that is the whole of what a member
 * is given: role disclosure is no exception to CONTEXT.md's Team identity
 * rule, so the roster reaches a member as Team identity with no account on it
 * at all, and this page has nothing else it could name an official by.
 *
 * A co-commissioner grant can outlive the team it was granted to, which is why
 * #112 joins LEFT and why such an entry reads back with no Team identity. An
 * earlier version of this component named it a former manager rather than
 * dropping it, because someone still has to be able to see a grant in order to
 * revoke it. That reasoning is sound and #324 kept it - it just does not land
 * here any more. The someone is the COMMISSIONER, who still receives that
 * grant and the account id the revoke is built from, and who revokes it in
 * CommissionerTools; a grant with no Team has no Team identity to name it by,
 * so on this page it names no official.
 *
 * The filter below is load-bearing rather than a belt-and-braces copy of the
 * server's: a member never receives a team-less grant at all, but a
 * COMMISSIONER does (they are the one who can revoke it), and they read this
 * page too. Without the filter this page would say different things to
 * different members, which is the one thing a shared surface must not do.
 *
 * The creator's chip stays unconditional for a reason that does not transfer
 * to the grants: there is exactly one creator, they always hold the role, and
 * dropping their chip would leave a league whose rules nobody appears able to
 * change. Dropping one grant of several leaves the page honest.
 */
export default function LeagueOfficials({ league }) {
  const coCommissioners = (league.co_commissioners || []).filter((c) => c.teamId != null);

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
      <Typography variant="body2" color="text.secondary">Who can change these:</Typography>
      {/* Unconditional, and deliberately NOT on the same terms as the grants
          below: a league always has a creator (leagues.owner_id is NOT NULL)
          and they always hold the role, so the only question is what to call
          them. A creator who has left their own league has no Team and is
          named a former manager, because gating this chip on the name would
          leave a league whose rules nobody appears able to change. A grant in
          that same position is filtered out just above instead, and the
          asymmetry is the point: dropping the only creator hides the role,
          dropping one grant of several does not. */}
      <Chip size="small" variant="outlined" label={`${teamNameLabel(league.ownerTeamName)} · commissioner`} />
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
