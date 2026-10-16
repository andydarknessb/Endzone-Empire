import React, { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelArrow, PixelHeading, Pictogram, PsLink,
} from '../../../shared/ui/playselect';
import useQuickActions from '../model/useQuickActions';

/**
 * League Dashboard Playbook widget (ADR 0067 wave 1b, formerly Quick Actions): the league's other
 * destinations as grouped play tiles. A tile is a whole link: a Play-blue fill, a 96 by 48 pixel
 * pictogram, the destination in Archivo 15px 600 and its status line (the product's own copy,
 * including its fallbacks) under it. Play, Moves and League are columns of a tertiary frame (2px
 * edge, Pixel 16 heading). No tile carries a filled foot: the one filled action belongs to the lead
 * play in Your move.
 *
 * The page passes what it already shows elsewhere (One label per destination): `omit` drops those
 * tiles by key (Set Lineup when it is a play, Waivers and Trades when My team links them, Game
 * Center and Activity when their own frames do, the Draft Room once the draft is over), and the
 * widget drops a group that empties. `variant="row"` is the in-season fold the phone and the
 * mid-season desktop share: one line of links ("Playbook · Power Rankings · History · League Rules")
 * followed by the page's own `trailing` links (the trophy case).
 *
 * A pick'em-only league trims itself to the pick'em surfaces. Paints only `ps-*` tokens.
 */

// The destination -> pictogram (src/shared/ui/playselect/Icons.jsx).
const KIND = {
  draft: 'draft',
  lineup: 'lineup',
  'game-center': 'gamecenter',
  pickem: 'picks',
  waivers: 'waivers',
  trades: 'trade',
  activity: 'activity',
  'power-rankings': 'rankings',
  history: 'history',
  rules: 'rules',
  'draft-settings': 'settings',
};

const FRAME_NOTE = 'Everything else in this league';

export default function QuickActions({
  leagueId, omit, variant = 'frame', trailing,
}) {
  const { ready, groups: allGroups } = useQuickActions(leagueId);
  const headingId = useId();

  if (!ready) return null;

  const skip = new Set(omit || []);
  const groups = allGroups
    .map((group) => {
      const cards = group.cards.filter((card) => !skip.has(card.key));
      return { ...group, cards, count: cards.length };
    })
    .filter((group) => group.count > 0);
  const extra = Array.isArray(trailing) ? trailing.filter((link) => link && link.to) : [];

  if (variant === 'row') {
    const links = [...groups.flatMap((group) => group.cards.map((card) => ({
      key: card.key, label: card.label, to: card.href,
    }))), ...extra.map((link) => ({ key: link.key || link.label, label: link.label, to: link.to }))];
    if (links.length === 0) return null;
    return (
      <Box
        component="nav"
        aria-label="Playbook"
        data-testid="quick-actions"
        sx={{
          border: '2px solid var(--ps-frame-2)',
          backgroundColor: 'var(--ps-panel)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: { xs: '4px 10px', md: '4px 20px' },
          gap: '0 4px',
        }}
      >
        <Box component="span" sx={{ fontSize: '15px', fontWeight: 600, padding: '0 10px 0 0' }}>Playbook</Box>
        {links.map((link) => (
          <React.Fragment key={link.key}>
            <Box component="span" aria-hidden="true" sx={{ color: 'var(--ps-dim)' }}>·</Box>
            <Box component="span" data-testid={`quick-action-${link.key}`}>
              <PsLink to={link.to}>{link.label}</PsLink>
            </Box>
          </React.Fragment>
        ))}
      </Box>
    );
  }

  if (groups.length === 0) return null;

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="quick-actions"
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>Playbook</PixelHeading>
          <Box component="span" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>{FRAME_NOTE}</Box>
        </FrameHead>
      )}
    >
      <Box
        data-testid="quick-actions-body"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: `repeat(${groups.length}, minmax(0, 1fr))` },
          gap: { xs: '20px', md: '24px' },
          padding: { xs: '14px', md: '20px' },
        }}
      >
        {groups.map((group) => (
          <ActionGroup key={group.label} group={group} />
        ))}
      </Box>
    </Frame>
  );
}

function ActionGroup({ group }) {
  return (
    <Box
      component="section"
      data-testid={`quick-actions-group-${group.label.toLowerCase()}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}
    >
      <Box
        component="h3"
        sx={{
          m: 0, fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)',
        }}
      >
        {`${group.label} · ${group.count}`}
      </Box>
      {group.cards.map((card) => (
        <ActionTile key={card.key} card={card} />
      ))}
    </Box>
  );
}

function ActionTile({ card }) {
  const { recommended } = card;
  return (
    <Box
      component={RouterLink}
      to={card.href}
      data-testid={`quick-action-${card.key}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        minHeight: '44px',
        padding: '12px 14px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--ps-play)',
        border: '2px solid var(--ps-play-ink)',
        color: 'var(--ps-play-ink)',
        textDecoration: 'none',
      }}
    >
      {KIND[card.key] && (
        <Box component="span" sx={{ flex: 'none', width: '96px' }} data-testid={`quick-action-plate-${card.key}`}>
          <Pictogram kind={KIND[card.key]} width="100%" />
        </Box>
      )}
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
        <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: '15px', fontWeight: 600 }}>
          {card.label}
          {recommended && (
            <Box
              component="span"
              sx={{
                border: '2px solid var(--ps-play-ink)',
                padding: '1px 6px',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}
            >
              Recommended
            </Box>
          )}
        </Box>
        {card.status && (
          <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-play-dim)' }}>{card.status}</Box>
        )}
      </Box>
      <PixelArrow />
    </Box>
  );
}
