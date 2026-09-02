import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import AssignmentIcon from '@mui/icons-material/Assignment';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import TimelineIcon from '@mui/icons-material/Timeline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SettingsIcon from '@mui/icons-material/Settings';
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
 * tiles sit on `dash-surface2`, where ink (title) and dim (status copy) are
 * registered in tokens.contrast.test.js; the "Recommended" pill is the accent
 * chip (`Badge` accent variant), whose accent-on-accent-soft is registered over
 * that surface too. The recommended ring is a border, not text, so it composes
 * no new pairing.
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
              sx={{
                display: 'grid',
                gap: '10px',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
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
        borderRadius: 'var(--dash-radius-sm)',
        backgroundColor: 'var(--dash-surface2)',
        // The accent RING marks a recommended card. It is a border color, not
        // text, so it composes no contrast pairing; a plain card keeps the
        // hairline.
        border: recommended
          ? '1px solid var(--dash-accent-line)'
          : '1px solid var(--dash-line)',
        boxShadow: recommended ? '0 0 0 1px var(--dash-accent-line)' : 'none',
        color: 'var(--dash-ink)',
        transition: 'border-color 120ms ease',
        '&:hover': { borderColor: 'var(--dash-accent-line)' },
      }}
    >
      {Icon && (
        <Box sx={{ flex: 'none', display: 'flex', color: 'var(--dash-dim)', mt: '2px' }}>
          <Icon fontSize="small" />
        </Box>
      )}
      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.25 }}>
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
          {recommended && (
            <Badge variant="live" data-testid={`quick-action-${card.key}-recommended`}>
              Recommended
            </Badge>
          )}
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
