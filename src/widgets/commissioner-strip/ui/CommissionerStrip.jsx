import React, { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { Card, Badge, StatTile } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import AdvanceWeek from '../../../features/advance-week';
import useCommissionerStrip from '../model/useCommissionerStrip';

/**
 * League Dashboard commissioner-strip widget (ticket #1108): the
 * commissioner-only band that REPLACES the commissioner-panel rail card
 * (a 377px card whose opened tree measured 690px wide). It reads the same
 * model the panel read (`is_commissioner`, `commissionerFacts`, the
 * join-requests count, the commissioner count) and states it as one row
 * instead of a tall rail card: a title block, five fact tiles, the pending
 * join count, the advance-week control, and a link to the commissioner
 * console for everything else. A member renders nothing.
 *
 * This widget mounts NO legacy administration tree at any width: the
 * disclosure, the `commissioner-panel-administration` region and the
 * co-commissioner explainer all leave the dashboard with the retired panel.
 * "League administration" is a plain link to `/league/:id/commissioner` (the
 * commissioner-console page, #1101), which is where those controls live now.
 *
 * Layout: one flex row at `md` and up (title block, the five-tile fact grid,
 * the join Badge, the advance-week feature, the administration link), each
 * item's `order` swapping per breakpoint rather than two duplicated DOM
 * trees. Below `md` the row wraps to a stack: a title row (title block plus
 * the join Badge), a 2x2 grid of the first four facts (Trade review is the
 * fifth and is hidden at this width - `flexBasis: '100%'` forces every item
 * after the title row onto its own line), then the advance-week feature and
 * the administration link, each full width. The advance-week feature is
 * composed as-is (ADR 0020 barrel rule: a feature's index is its whole
 * public surface, so this widget cannot reach into it to force its inner
 * button to `width: 100%`); only this widget's OWN administration link is
 * stretched to match the mockup's two full-width controls.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens, the same
 * pairings the retired panel and matchup-hero already register in
 * tokens.contrast.test.js (ink/faint on a card, ink/faint on a stat tile,
 * warning on its tint over a card, dim on a card for the outlined link).
 *
 * This widget has NO aria-busy, for the same reason the retired panel had
 * none: the page shell gates its whole body on the league read, and the
 * join-requests count holds no layout (absent until it lands, never a
 * skeleton) - so there is no in-flight state for aria-busy to report over.
 *
 * Tested at this slice's own seam only (CommissionerStrip.test.jsx): the
 * page composes it in the page-composition ticket, which is where this
 * widget's presence and placement on the dashboard are asserted.
 */
export default function CommissionerStrip({ leagueId }) {
  const {
    isCommissioner,
    pickemOnly,
    currentWeek,
    facts,
    pendingJoinRequests,
    commissionerCount,
    refetch,
  } = useCommissionerStrip(leagueId);
  // Called unconditionally, ABOVE the presence gate below: a member's first
  // render and a commissioner's later one (once the league read resolves)
  // must call the same hooks in the same order, so this cannot sit after an
  // early return (Rules of Hooks).
  const headingId = useId();

  // Commissioner-only, and ABSENT (not merely hidden) from a member's DOM,
  // exactly as the retired panel was: a non-commissioner gets no card, no
  // facts and no advance control to find. Read from `is_commissioner`, never
  // `invite_code` (see useCommissionerStrip's model comment).
  if (!isCommissioner) return null;

  // A fantasy-league, in-season control: a pick'em-only league advances on
  // the NFL calendar (the scheduler's job), and a league with no current week
  // has no week to advance from.
  const showAdvance = !pickemOnly && currentWeek != null;
  const consoleHref = `/league/${leagueId}/commissioner`;

  return (
    <Card data-testid="commissioner-strip" aria-labelledby={headingId}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: { xs: 'stretch', md: 'center' },
          gap: { xs: 1.5, md: 2.25 },
          px: 2.25,
          py: 2.25,
        }}
      >
        <Box sx={{ order: 1, display: 'grid', gap: '2px', flex: 'none' }}>
          <Typography
            id={headingId}
            component="h2"
            sx={{
              m: 0,
              fontFamily: 'var(--dash-font-display)',
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--dash-ink)',
            }}
          >
            Commissioner
          </Typography>
          <Typography
            component="span"
            sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
          >
            {`Commissioners only · ${commissionerCount}`}
          </Typography>
        </Box>

        {/* The settled state of the league, from fields the payload already
            carries. Five tiles at `md` and up; the fifth (Trade review) is
            hidden below it, leaving the first four in a 2x2 grid, per the
            ticket's mobile layout. */}
        {facts.length > 0 && (
          <Box
            data-testid="commissioner-strip-facts"
            sx={{
              order: { xs: 3, md: 2 },
              flexBasis: { xs: '100%', md: 'auto' },
              flex: { xs: 'none', md: '1 1 auto' },
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            {facts.map((fact, index) => (
              <StatTile
                key={fact.key}
                data-testid={`commissioner-fact-${fact.key}`}
                label={fact.label}
                value={fact.value}
                sx={index === 4 ? { display: { xs: 'none', md: 'flex' } } : undefined}
              />
            ))}
          </Box>
        )}

        {/* The queue's count only, linking straight to the console rather
            than opening a local disclosure: the strip mounts no legacy
            administration tree, so there is nowhere here for Approve/Deny to
            live. A settled queue renders nothing at all rather than a zero. */}
        {pendingJoinRequests > 0 && (
          <Box sx={{ order: { xs: 2, md: 3 }, flex: 'none' }}>
            {/* `clickable` is required alongside `component` for an anchor
                Chip (MUI's own guidance): without it Chip renders `component`
                directly and skips ButtonBase entirely, which is also what
                carries the theme's MuiButtonBase focus-visible ring
                (AppThemeProvider.jsx - "every button-like control ...
                chips") and its hover/cursor treatment. Passing it here is
                what makes this link's keyboard focus visible, not decoration. */}
            <Badge
              component={RouterLink}
              to={consoleHref}
              clickable
              variant="warning"
              data-testid="commissioner-strip-join-requests"
              sx={{ ...MIN_TOUCH_TARGET_SX, textDecoration: 'none' }}
            >
              {`Join requests · ${pendingJoinRequests}`}
            </Badge>
          </Box>
        )}

        {showAdvance && (
          <Box sx={{ order: { xs: 4, md: 4 }, flexBasis: { xs: '100%', md: 'auto' }, flex: 'none' }}>
            <AdvanceWeek leagueId={leagueId} currentWeek={currentWeek} onAdvanced={refetch} />
          </Box>
        )}

        <Box sx={{ order: { xs: 5, md: 5 }, flexBasis: { xs: '100%', md: 'auto' }, flex: 'none' }}>
          <Button
            component={RouterLink}
            to={consoleHref}
            variant="outlined"
            disableElevation
            sx={{
              width: { xs: '100%', md: 'auto' },
              minHeight: { xs: 44, md: 38 },
              textTransform: 'none',
              color: 'var(--dash-dim)',
              borderColor: 'var(--dash-line-strong)',
              borderRadius: 'var(--dash-radius-sm)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              whiteSpace: 'nowrap',
              '&:hover': {
                color: 'var(--dash-ink)',
                borderColor: 'var(--dash-accent-line)',
                backgroundColor: 'transparent',
              },
            }}
          >
            League administration
          </Button>
        </Box>
      </Box>
    </Card>
  );
}
