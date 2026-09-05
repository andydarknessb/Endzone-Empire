import React from 'react';
import { Box } from '@mui/material';
import { Card, PosChip } from '../../../shared/ui';
import PlayerAvatar from '../../../components/PlayerQuickView/PlayerAvatar';
import { lineupNoteParts } from '../model/scoreboardModel';
import Icon from './icons';

/**
 * The Lineups card from the Scoreboard view (design canvas rosterPreview()):
 * a compact, non-interactive slot-by-slot preview of the paired rows the
 * entity hands down, home on the left, the PosChip in the middle, away
 * mirrored on the right. Each filled side is a 28px PlayerAvatar headshot
 * (the ESPN photo, position-colored initials when there is none), the name,
 * and a note line of points and projection ("18.6 · proj 19.2") or, for an
 * Unavailable starter, the reason ("0.0 · on bye"), the reason carrying the
 * `unavailable-reason` test id the Matchup Detail page tests read.
 *
 * It renders the rows AS GIVEN: the entity paired them under the league's slot
 * order (ADR 0029), so this card neither pairs nor re-sorts, and a slot only
 * one side has filled keeps its row with an empty opposite side. Every row is
 * `data-testid="slot-row"`, the convention the Matchup Detail page tests read
 * to prove the two lineup renderings agree slot for slot.
 *
 * Composes `shared/ui` (ADR 0020) and paints only registered pairings: ink,
 * dim and faint on the card surface, and PosChip's own position fills. The
 * one control, the optional "Full comparison" action the page wires to its
 * view toggle, meets the 44px target on mobile.
 */
function Note({ player }) {
  const { points, reason, projected } = lineupNoteParts(player);
  return (
    <Box
      component="span"
      data-testid="lineup-note"
      sx={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--dash-faint)', whiteSpace: 'nowrap' }}
    >
      {points}
      {reason ? (
        <>
          {' · '}
          <span data-testid="unavailable-reason">{reason}</span>
        </>
      ) : projected != null ? (
        ` · proj ${projected}`
      ) : null}
    </Box>
  );
}

function Side({ player, side }) {
  const mirrored = side === 'away';
  if (!player) return <Box data-testid={`lineup-side-${side}`} sx={{ flex: '1 1 0', minWidth: 0 }} />;
  return (
    <Box
      data-testid={`lineup-side-${side}`}
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexDirection: mirrored ? 'row-reverse' : 'row',
        textAlign: mirrored ? 'right' : 'left',
      }}
    >
      <Box data-testid={`headshot-${side}`} sx={{ flex: 'none', display: 'flex' }}>
        <PlayerAvatar name={player.name} position={player.position} photoUrl={player.photo_url} size={28} />
      </Box>
      <Box
        sx={{
          flex: '1 1 0',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: mirrored ? 'flex-end' : 'flex-start',
        }}
      >
        <Box
          component="span"
          sx={{
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--dash-ink)',
          }}
        >
          {player.name}
        </Box>
        <Note player={player} />
      </Box>
    </Box>
  );
}

export default function LineupsCard({ rows, headingLevel = 2, onFullComparison, mobile }) {
  const list = rows || [];
  return (
    <Card
      data-testid="lineups-card"
      title="Lineups"
      count="Slot by slot"
      headingLevel={headingLevel}
      tail={
        onFullComparison ? (
          <Box
            component="button"
            type="button"
            onClick={onFullComparison}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              minHeight: mobile ? 44 : 30,
              px: '6px',
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '13px',
              color: 'var(--dash-dim)',
              borderRadius: 'var(--radius-sm)',
              '&:hover': { color: 'var(--dash-ink)' },
              '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
            }}
          >
            Full comparison
            <Icon name="chevR" size={14} />
          </Box>
        ) : null
      }
    >
      {list.length === 0 ? (
        <Box sx={{ p: mobile ? '12px' : '14px 18px', fontSize: '13px', color: 'var(--dash-dim)' }}>
          No starters to show yet.
        </Box>
      ) : (
        list.map((row, i) => (
          <Box
            data-testid="slot-row"
            key={`${row.slot}-${row.home?.id ?? 'x'}-${row.away?.id ?? 'x'}-${i}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              p: mobile ? '6px 12px' : '6px 18px',
              borderTop: i ? '1px solid var(--dash-line)' : 0,
            }}
          >
            <Side player={row.home} side="home" />
            <PosChip position={row.slot} sx={{ flex: 'none' }} />
            <Side player={row.away} side="away" />
          </Box>
        ))
      )}
    </Card>
  );
}
