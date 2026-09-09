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
 * League Dashboard quick-actions widget (ticket #643, rows in two columns
 * #1106): the grouped action rows below the main grid. Each group (Play /
 * Moves / League) carries its visible card count in its h3 label; each row is
 * a link to an existing league sub-route with a line of locally-derived
 * status copy, and a row that deserves attention carries the accent icon
 * color plus a "Recommended" pill.
 *
 * Layout (#1106, design canvas https://claude.ai/code/artifact/c594a615-f671-40cb-b536-5269053ad09f,
 * docs/design/league-dashboard-v2/Main.dc.html and DashboardMobile.dc.html):
 * the card body is a two-column grid at `md` and up, Play then Moves stacked
 * in the first column and League alone in the second, and a single column in
 * group order (Play, Moves, League) below `md`. The grid lives on the two
 * COLUMNS only, never on a group's own row list, so there is no trailing
 * empty track at any width the way the old per-group auto-fill tile grid
 * could leave one. A row is 40px tall at `md` and up and 48px below it (the
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
 * composes no new ink-on-surface pairing, and the trailing chevron is
 * decorative (`aria-hidden`): the row's accessible name is the label alone.
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

// Which column a group renders in at `md` and up. League always stands alone
// in the second column; Play and Moves share the first, in that order. A
// group the model dropped (an empty pick'em-only Moves, say) simply is not in
// `groups`, so the column that would have held it renders whatever remains -
// never an empty track, because the grid is on the two columns, not on a
// group's own row list.
const COLUMN_1_LABELS = ['Play', 'Moves'];

export default function QuickActions({ leagueId }) {
  const { ready, groups } = useQuickActions(leagueId);

  // Nothing to show until the league row is on screen (the page shell handles
  // the first-load blank), and nothing to show if every group filtered empty.
  if (!ready || groups.length === 0) return null;

  const column1 = groups.filter((group) => COLUMN_1_LABELS.includes(group.label));
  const column2 = groups.filter((group) => !COLUMN_1_LABELS.includes(group.label));

  return (
    <Card data-testid="quick-actions" title="Quick Actions">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          pb: 1,
        }}
      >
        <Box data-testid="quick-actions-column-1">
          {column1.map((group) => (
            <ActionGroup key={group.label} group={group} />
          ))}
        </Box>
        <Box data-testid="quick-actions-column-2">
          {column2.map((group) => (
            <ActionGroup key={group.label} group={group} />
          ))}
        </Box>
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
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
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
