import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import AssignmentIcon from '@mui/icons-material/AssignmentOutlined';
import LiveTvIcon from '@mui/icons-material/LiveTvOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHorizOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrowsOutlined';
import TimelineIcon from '@mui/icons-material/TimelineOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';
import EmojiEventsIcon from '@mui/icons-material/EmojiEventsOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBookOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRightOutlined';
import { Card, Badge } from '../../../shared/ui';
import useQuickActions from '../model/useQuickActions';

/**
 * League Dashboard quick-actions widget (ticket #643, one column per group
 * #1993): the grouped action rows below the main grid. Each group (Play /
 * Moves / League) carries its visible card count in its h3 label; each row is
 * a link to an existing league sub-route with a line of locally-derived
 * status copy, and a row that deserves attention carries the accent icon
 * color plus a "Recommended" pill.
 *
 * Layout (#1106, design canvas https://claude.ai/code/artifact/c594a615-f671-40cb-b536-5269053ad09f,
 * docs/design/league-dashboard-v2/Main.dc.html and DashboardMobile.dc.html):
 * the card spans the dashboard's full content width (#1993: it sits alone
 * under the main grid), so its body is one column per group at `md` and up (three
 * for a fantasy league, Play, Moves and League; two for a pick'em-only
 * league, whose Moves group is trimmed away), and a single column in group
 * order below `md`. The track count follows the groups that survived the trim,
 * so there is no trailing empty track at any width, and the grid lives on the
 * groups only, never on a group's own row list. A row is 40px tall at `md` and up and 48px below it (the
 * mockup's `.row` `min-height`), the whole row is the RouterLink, and it
 * never wraps a card of its own: it sits flush on the Card's own
 * `dash-surface`, so the label (ink) and status line (dim) it paints are the
 * SAME pairing over `dash-surface` tokens.contrast.test.js already registers
 * for this widget.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. The
 * "Recommended" pill is the `Badge` `live` variant (accent text on the accent
 * tint), whose accent-on-accent-soft is registered over `dash-surface` too.
 * The icon on its `dash-surface2` plate is a graphic, so its accent/dim color
 * composes no new ink-on-surface pairing. The trailing chevron is decorative
 * (`aria-hidden`, and MUI's SvgIcon already marks every icon `aria-hidden`
 * and `focusable="false"` on its own, so the plate icon needs no attribute of
 * its own either); the row's accessible name is instead everything BOTH
 * icons are excluded from - label, the "Recommended" text when present, and
 * the full (untruncated - the ellipsis below is CSS-only, and absent between
 * md and lg, where the line wraps) status line - which
 * is deliberately richer than the label alone, so a screen-reader user
 * navigating by link text hears the same status a sighted user reads.
 *
 * This widget has NO aria-busy: its one extra read (the viewer roster, for the
 * Set Lineup recommendation) is best effort and its result is absent-until-ready
 * (a status line and an optional pill), never skeletoned. It holds no layout for
 * aria-busy to report over, so - unlike the fetch-spine widgets in the hero and
 * main grid - the card announces no loading state (Skeleton.jsx / carry-over #2:
 * aria-busy belongs to the region whose skeletons hold layout).
 */

const ICONS = {
  draft: GroupsIcon,
  lineup: AssignmentIcon,
  'game-center': LiveTvIcon,
  pickem: FactCheckIcon,
  waivers: SwapHorizIcon,
  trades: CompareArrowsIcon,
  activity: TimelineIcon,
  'power-rankings': TrendingUpIcon,
  history: EmojiEventsIcon,
  rules: MenuBookIcon,
  'draft-settings': SettingsIcon,
};

export default function QuickActions({ leagueId }) {
  const { ready, groups } = useQuickActions(leagueId);

  // Nothing to show until the league row is on screen (the page shell handles
  // the first-load blank), and nothing to show if every group filtered empty.
  if (!ready || groups.length === 0) return null;

  return (
    <Card data-testid="quick-actions" title="Quick Actions">
      <Box
        data-testid="quick-actions-body"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `repeat(${groups.length}, minmax(0, 1fr))` },
          pb: 1,
        }}
      >
        {groups.map((group) => (
          <ActionGroup key={group.label} group={group} />
        ))}
      </Box>
    </Card>
  );
}

function ActionGroup({ group }) {
  return (
    <Box component="section" data-testid={`quick-actions-group-${group.label.toLowerCase()}`}>
      <Typography
        component="h3"
        sx={{
          m: 0,
          fontFamily: 'var(--dash-font-display)',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
          padding: '12px 18px 6px',
        }}
      >
        {`${group.label} · ${group.count}`}
      </Typography>

      {group.cards.map((card) => (
        <ActionRow key={card.key} card={card} />
      ))}
    </Box>
  );
}

function ActionRow({ card }) {
  const Icon = ICONS[card.key];
  const { recommended } = card;

  return (
    <Box
      component={RouterLink}
      to={card.href}
      data-testid={`quick-action-${card.key}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        padding: '7px 18px',
        minHeight: { xs: '48px', md: '40px' },
        textDecoration: 'none',
        color: 'var(--dash-ink)',
      }}
    >
      {Icon && (
        <Box
          data-testid={`quick-action-plate-${card.key}`}
          sx={{
            flex: 'none',
            width: 30,
            height: 30,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--dash-radius-sm)',
            backgroundColor: 'var(--dash-surface2)',
            // Accent on a recommended row, dim on a plain one, exactly as the
            // artboard's `.row` icon plate does.
            color: recommended ? 'var(--dash-accent)' : 'var(--dash-dim)',
          }}
        >
          <Icon fontSize="small" />
        </Box>
      )}
      {/* The zero minimum is paired with a break rule on the same box: a
          break rather than push past the plate or the trailing chevron
          (#916/#917/#919/#921, carried over from the tile layout). */}
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 auto', display: 'grid', gap: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography
            component="span"
            sx={{
              fontFamily: 'var(--dash-font-display)',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.01em',
              color: 'var(--dash-ink)',
            }}
          >
            {card.label}
          </Typography>
          {recommended && <Badge variant="live">Recommended</Badge>}
        </Box>
        {card.status && (
          <Typography
            component="span"
            sx={{
              fontSize: '12px',
              lineHeight: 1.35,
              color: 'var(--dash-dim)',
              overflow: 'hidden',
              // Wraps between md and lg: with one column per group each has a
              // third of the card there, and real copy ("2 empty starting
              // slots · 2 starters on bye") would truncate. Truncation (nowrap
              // plus the ellipsis) returns from lg, and below md where the one
              // column is wide.
              textOverflow: { xs: 'ellipsis', md: 'clip', lg: 'ellipsis' },
              whiteSpace: { xs: 'nowrap', md: 'normal', lg: 'nowrap' },
            }}
          >
            {card.status}
          </Typography>
        )}
      </Box>
      <ChevronRightIcon
        data-testid={`quick-action-chevron-${card.key}`}
        fontSize="small"
        aria-hidden="true"
        sx={{ flex: 'none', color: 'var(--dash-faint)' }}
      />
    </Box>
  );
}
