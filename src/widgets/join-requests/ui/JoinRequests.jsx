import React from 'react';
import { Avatar, Box, Typography } from '@mui/material';
import { Badge, Card, Skeleton } from '../../../shared/ui';
import DecideJoinRequest from '../../../features/decide-join-request';
import { initialsFor } from '../../../lib/initials';
import { teamNameLabel } from '../../../lib/teamIdentity';
import formatRelative from '../../../utils/formatRelative';
import useJoinRequests from '../model/useJoinRequests';

/**
 * commissioner-console join-requests widget (#1109, console-only): the card
 * a commissioner uses to decide pending join requests without opening
 * CommissionerTools' own Join Requests tab (left in place, out of scope to
 * remove - this widget owns the count it shows, a separate read from that
 * tab's, so a decision taken here is reflected there only on its own next
 * read, and vice versa).
 *
 * Mounted by CommissionerConsolePage above the tools column, and only while
 * the league is public with join approval on - the page's own copy of the
 * gate this widget's model independently re-derives for its read (see
 * useJoinRequests's docblock). The widget renders nothing (not even the
 * card's own frame) while that gate is false, so a private league carries no
 * trace of this queue at all.
 *
 * A request is identified by the Team name it proposes, never an account
 * (CONTEXT.md, Team identity): the row shows an initials avatar and Team name
 * from `team_name` alone, through `teamNameLabel` (a request has no Team row
 * to hold an avatar image, so this is never `TeamAvatar`), and acts on the
 * request by its `id`, never the requester's user id (which the server's own
 * `listJoinRequests` allowlist never even serves, per
 * joinRequestsQueue.route.test.js).
 */
export default function JoinRequests({ leagueId }) {
  const { showJoinQueue, status, rows, refetch } = useJoinRequests(leagueId);

  if (!showJoinQueue) return null;

  return (
    <Card
      data-testid="join-requests"
      title="Join requests"
      count={status === 'ready' ? rows.length : null}
      tail={status === 'ready' && rows.length > 0 ? <Badge variant="warning">Needs you</Badge> : null}
      aria-busy={status === 'loading'}
      sx={{ p: 0 }}
    >
      <Box sx={{ px: 2.25, py: 2.25, display: 'grid', gap: 1.5 }}>
        {status === 'loading' && (
          <Box data-testid="join-requests-loading" aria-hidden="true" sx={{ display: 'grid', gap: 1 }}>
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        )}

        {status === 'error' && (
          <Typography role="alert" sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
            We could not load join requests right now.
          </Typography>
        )}

        {status === 'ready' && rows.length === 0 && (
          <Typography
            data-testid="join-requests-empty"
            sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}
          >
            No pending join requests.
          </Typography>
        )}

        {status === 'ready' && rows.map((row) => {
          const name = teamNameLabel(row.team_name);
          return (
            <Box
              key={row.id}
              data-testid={`join-requests-row-${row.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flexWrap: 'wrap',
                py: 1,
                borderBottom: '1px solid var(--dash-line)',
                '&:last-child': { borderBottom: 'none', pb: 0 },
              }}
            >
              <Avatar
                aria-hidden="true"
                sx={{
                  width: 36,
                  height: 36,
                  fontSize: 14,
                  bgcolor: 'var(--dash-surface2)',
                  color: 'var(--dash-ink)',
                  flex: 'none',
                }}
              >
                {initialsFor(name)}
              </Avatar>
              <Typography
                sx={{
                  flex: '1 1 200px',
                  minWidth: 0,
                  fontSize: '13.5px',
                  color: 'var(--dash-ink)',
                }}
              >
                {`${name} · requested ${formatRelative(row.created_at)}`}
              </Typography>
              <DecideJoinRequest leagueId={leagueId} requestId={row.id} onDecided={refetch} />
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}
