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
import { Card, Badge } from '../../../shared/ui';
import useQuickActions from '../model/useQuickActions';

/**
 * League Dashboard quick-actions widget (ticket #643): the grouped action cards
 * below the main grid. Each group (Play / Moves / League) carries its visible
 * card count in its label; each card is a link to an existing league sub-route
 * with a line of locally-derived status copy, and a card that deserves
 * attention carries the accent ring plus a "Recommended" pill.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. The action
 * tiles sit on `dash-surface` (the artboard's `.action` card), where ink
 * (title) and dim (status copy) are registered in tokens.contrast.test.js; the
 * "Recommended" pill is the `Badge` `live` variant (accent text on the accent
 * tint), whose accent-on-accent-soft is registered over that surface too. The
 * recommended ring is a border, not text, so it composes no new pairing, and
 * neither does the icon on its `dash-surface2` plate: an icon is a graphic, the
 * same call the ring comment below records.
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
      <Box sx={{ display: 'grid', gap: 2.5, px: 2.25, py: 2.25 }}>
        {groups.map((group) => (
          <Box key={group.label} component="section" data-testid={`quick-actions-group-${group.label.toLowerCase()}`}>
            <Typography
              component="h3"
              sx={{
                m: 0,
                mb: 1,
                fontFamily: 'var(--dash-font-display)',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--dash-faint)',
              }}
            >
              {`${group.label} · ${group.count}`}
            </Typography>

            <Box
              data-testid={`quick-actions-grid-${group.label.toLowerCase()}`}
              sx={{
                display: 'grid',
                gap: '10px',
                // auto-FILL, not auto-fit: auto-fit collapses the tracks a
                // group has no card for, so the two-card Moves group would
                // stretch into two half-width tiles while Play's four stayed
                // narrow. auto-fill keeps every group on one tile width.
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(180px, 1fr))' },
              }}
            >
              {group.cards.map((card) => (
                <ActionTile key={card.key} card={card} />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function ActionTile({ card }) {
  const Icon = ICONS[card.key];
  const { recommended } = card;

  return (
    <Box
      component={RouterLink}
      to={card.href}
      data-testid={`quick-action-${card.key}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
        padding: '12px 14px',
        textDecoration: 'none',
        borderRadius: 'var(--dash-radius)',
        backgroundColor: 'var(--dash-surface)',
        // The accent RING marks a recommended card. It is a border color, not
        // text, so it composes no contrast pairing; a plain card keeps the
        // hairline.
        border: recommended
          ? '1px solid var(--dash-accent-line)'
          : '1px solid var(--dash-line)',
        boxShadow: recommended ? '0 0 0 1px var(--dash-accent-line)' : 'none',
        color: 'var(--dash-ink)',
        transition:
          'border-color var(--transition-fast) ease, transform var(--transition-fast) ease',
        '&:hover': {
          borderColor: 'var(--dash-accent-line)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      {Icon && (
        <Box
          data-testid={`quick-action-plate-${card.key}`}
          sx={{
            flex: 'none',
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--dash-radius-sm)',
            backgroundColor: 'var(--dash-surface2)',
            // Accent on a recommended card, dim on a plain one, exactly as the
            // artboard's `.action .ico` / `.action.plain .ico` pair does.
            color: recommended ? 'var(--dash-accent)' : 'var(--dash-dim)',
          }}
        >
          <Icon fontSize="small" />
        </Box>
      )}
      {/* The zero minimum is paired with a break rule on the same box: a tile
          is now only 180px wide, so a word wider than the text column has to
          break rather than push past the plate (#916/#917/#919/#921). */}
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere', display: 'grid', gap: 0.25 }}>
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
            sx={{ fontSize: '12px', lineHeight: 1.35, color: 'var(--dash-dim)' }}
          >
            {card.status}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
