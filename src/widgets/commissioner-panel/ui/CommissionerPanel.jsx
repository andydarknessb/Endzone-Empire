import React, { useState } from 'react';
import { Box, Button } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Card, Badge } from '../../../shared/ui';
import AdvanceWeek from '../../../features/advance-week';
import CommissionerTools from '../../../components/LeagueDashboard/CommissionerTools';
import useCommissionerPanel from '../model/useCommissionerPanel';

/**
 * League Dashboard commissioner-panel widget (ticket #644): the rail card below
 * draft grades that a commissioner alone sees. It carries an "Only you see
 * this" chip, the advance-week control (for a fantasy league with a live week),
 * and the league administration the legacy commissioner tools provide, behind a
 * disclosure.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. This widget
 * has NO aria-busy: by the time it mounts the league row is already resolved
 * (the page shell gates its whole body on `!league && loading`), and its only
 * fetch is the advance-week POST, which is an action, not a layout-holding read
 * with skeletons. There is no in-flight skeleton for aria-busy to report over
 * (Skeleton.jsx / carry-over: aria-busy belongs to the region whose skeletons
 * hold layout), so composing it would announce a loading state that never
 * exists.
 */
export default function CommissionerPanel({ leagueId }) {
  const {
    league,
    teams,
    viewerTeamId,
    isCommissioner,
    isOwner,
    pickemOnly,
    currentWeek,
    refetch,
  } = useCommissionerPanel(leagueId);
  const [adminOpen, setAdminOpen] = useState(false);

  // Commissioner-only, and ABSENT (not merely hidden) from a member's DOM: a
  // non-commissioner gets no card, no chip, no advance control and no legacy
  // tools heading to find. Deleting this gate would render commissioner-only
  // controls (advancing a league's week, removing teams) into every member's
  // page.
  if (!isCommissioner) return null;

  // The advance-week control is a fantasy-league, in-season control: a
  // pick'em-only league advances on the NFL calendar (the scheduler's job), and
  // a league with no current week has no week to advance from.
  const showAdvance = !pickemOnly && currentWeek != null;

  return (
    <Card
      data-testid="commissioner-panel"
      title="Commissioner"
      tail={<Badge variant="you">Only you see this</Badge>}
    >
      <Box sx={{ display: 'grid', gap: 2.25, px: 2.25, py: 2.25 }}>
        {showAdvance && (
          <AdvanceWeek leagueId={leagueId} currentWeek={currentWeek} onAdvanced={refetch} />
        )}

        {/* League administration: the legacy commissioner tools, composed
            AS-IS (#617 cut ruling) with exactly the props the legacy page hands
            them. Mounted only while the disclosure is open - so the heavy tree
            is built on demand, and a member never has it in the DOM even
            transiently - which is also why the heading appears on expand. The
            legacy component's own tests stay untouched; migrating it into slices
            is out of scope. */}
        <Box>
          <Button
            type="button"
            variant="text"
            onClick={() => setAdminOpen((open) => !open)}
            aria-expanded={adminOpen}
            aria-controls="commissioner-panel-administration"
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transform: adminOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 120ms ease',
                }}
              />
            }
            sx={{
              px: 0,
              textTransform: 'none',
              color: 'var(--dash-ink)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              justifyContent: 'flex-start',
              '&:hover': { backgroundColor: 'transparent' },
            }}
          >
            League administration
          </Button>

          {adminOpen && (
            <Box
              id="commissioner-panel-administration"
              data-testid="commissioner-panel-administration"
              sx={{ mt: 1 }}
            >
              <CommissionerTools
                leagueId={leagueId}
                league={league}
                teams={teams}
                viewerTeamId={viewerTeamId}
                isOwner={isOwner}
                onRefresh={refetch}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Card>
  );
}
