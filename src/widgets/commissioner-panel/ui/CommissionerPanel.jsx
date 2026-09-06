import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Card, Badge, StatTile } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import AdvanceWeek from '../../../features/advance-week';
import CommissionerTools from '../../../components/LeagueDashboard/CommissionerTools';
import useCommissionerPanel from '../model/useCommissionerPanel';

/**
 * League Dashboard commissioner-panel widget (ticket #644): the card a
 * commissioner alone sees. It states the league's settled facts (transactions,
 * frozen teams, the trade deadline, waivers, roster shape, scoring), the
 * pending join count, the advance-week control (for a fantasy league with a
 * live week), and the league administration the legacy commissioner tools
 * provide, behind a disclosure.
 *
 * The panel does NOT decide where it lives: the page mounts it in the rail at
 * md and up and above the standings below md (T9 placement), and this component
 * renders the same in either slot.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. This widget
 * has NO aria-busy: by the time it mounts the league row is already resolved
 * (the page shell gates its whole body on `!league && loading`), and its own
 * join-requests read holds no layout - the count is absent until it lands, and
 * an absent fact needs no skeleton. There is no in-flight skeleton for
 * aria-busy to report over (Skeleton.jsx / carry-over: aria-busy belongs to the
 * region whose skeletons hold layout), so composing it would announce a loading
 * state that never exists.
 *
 * Tested at two seams: the composition assertions live in
 * LeagueDashboardPage.test.jsx's `commissioner-panel:` block, and this slice's
 * own facts, gates and control shapes in CommissionerPanel.test.jsx beside it.
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
    facts,
    pendingJoinRequests,
    commissionerCount,
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
      // NOT the "you" pill: `is_commissioner` is the viewer's EFFECTIVE role
      // (creator or co-commissioner), so "Only you see this" is false the
      // moment a grant exists, and that pill is the island's viewer-row
      // identity marker (Badge.jsx), which this box is not. The neutral chip is
      // what the committed artboard puts in this slot.
      tail={<Badge variant="neutral">{`Commissioners only · ${commissionerCount}`}</Badge>}
    >
      <Box sx={{ display: 'grid', gap: 2.25, px: 2.25, py: 2.25 }}>
        {showAdvance && (
          <AdvanceWeek leagueId={leagueId} currentWeek={currentWeek} onAdvanced={refetch} />
        )}

        {/* The settled state of the league, from fields the payload already
            carries. auto-fit (not auto-fill) because these tiles are a
            statement rather than a grid of slots: with three facts in a 307px
            rail the row should be three tiles wide, not three tiles and two
            empty tracks. */}
        {facts.length > 0 && (
          <Box
            data-testid="commissioner-panel-facts"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 1,
            }}
          >
            {facts.map((fact) => (
              <StatTile
                key={fact.key}
                data-testid={`commissioner-fact-${fact.key}`}
                label={fact.label}
                value={fact.value}
              />
            ))}
          </Box>
        )}

        {/* The queue's count only. Approve and Deny stay in the legacy tools:
            the decide mutation lives there and owns the list it edits, and a
            second pair of buttons here would leave this count stale after a
            decision. So the chip's action is to open the tools where the
            decision is actually made. The warning tone is the "needs you" tint
            (registered over a card in tokens.contrast.test.js); a settled queue
            renders nothing at all rather than a zero. */}
        {pendingJoinRequests > 0 && (
          <Box>
            <Badge
              variant="warning"
              data-testid="commissioner-panel-join-requests"
              onClick={() => setAdminOpen(true)}
              sx={MIN_TOUCH_TARGET_SX}
            >
              {`Join requests · ${pendingJoinRequests}`}
            </Badge>
          </Box>
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
            // Names the region only while it exists (the tools mount on expand),
            // matching the disclosure convention in EmojiPicker / GifComposer; a
            // static reference here would dangle whenever the panel is collapsed.
            aria-controls={adminOpen ? 'commissioner-panel-administration' : undefined}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transform: adminOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform var(--transition-fast) ease',
                }}
              />
            }
            // A full-width control on the island's own surfaces, not a caption
            // link: this is the way into every commissioner power the page has.
            // Its height is the 44px touch floor (MIN_TOUCH_TARGET_SX), and the
            // horizontal padding is hit slop, so the target is a band and not
            // just a tall line of text.
            sx={{
              ...MIN_TOUCH_TARGET_SX,
              width: '100%',
              px: 1.25,
              textTransform: 'none',
              color: 'var(--dash-ink)',
              backgroundColor: 'var(--dash-surface2)',
              border: '1px solid var(--dash-line)',
              borderRadius: 'var(--dash-radius-sm)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              // The chevron sits at the far end of the band, the label at the
              // near one; a flex-start row would leave it floating mid-control.
              justifyContent: 'space-between',
              transition: 'background-color var(--transition-fast) ease',
              // The hover cannot be `transparent` any more (it would erase the
              // fill this control now carries); surface3 is the island's raised
              // tone, and ink on it is a registered pairing.
              '&:hover': { backgroundColor: 'var(--dash-surface3)' },
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
              {/* Why the co-commissioner card is missing from the tools below.
                  Stated here, beside the tools, and only while they are open:
                  a co-commissioner who cannot find that control otherwise reads
                  its absence as a bug. The owner sees the card itself, so the
                  sentence would be noise. */}
              {!isOwner && (
                <Typography
                  sx={{
                    m: 0,
                    mb: 1.5,
                    fontFamily: 'var(--dash-font-body)',
                    fontSize: '12.5px',
                    color: 'var(--dash-dim)',
                  }}
                >
                  Only the league creator can add or remove co-commissioners.
                </Typography>
              )}
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
