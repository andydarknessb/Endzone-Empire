import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import LeagueCard, { scoreSignature, tileKind } from './LeagueCard';
import { useNow } from '../../../shared/lib/timeUntil';
import { ErrorPanel, Frame, PixelHeading, Skel } from '../../../shared/ui/playselect';
import { NumbersHelp } from './NumbersHelp';

// The My leagues section of Home (DESIGN.md "Play-select: Home and league pages"): the
// whole section, heading to grid. Before kickoff each league is a panel; on
// game day (`live`) the live ones are scoreboard tiles, first, and the rest
// still panels after them. The old filter chips and the six-league "Show all"
// are gone: the boards draw every league, and the grid is one tile per league.

const HEADING_ID = 'leagues-h';

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
  gap: '20px',
  // Panels and tiles stretch to the row's height; their links sit at the bottom (margin-top: auto).
  alignItems: 'stretch',
};

const MINUTE_MS = 60 * 1000;
// How long a changed score's tile holds the flash.
const FLASH_MS = 1000;

/** "updated just now" under a minute, else "updated N min ago", then the refresh cadence. */
function stampText(updatedAt, now) {
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return null;
  const minutes = Math.max(0, Math.floor((now - t) / MINUTE_MS));
  return `${minutes < 1 ? 'updated just now' : `updated ${minutes} min ago`} · refreshes every minute`;
}

// A loading league in the real panel's shape (build-states.js), so nothing jumps when it fills.
function SkeletonPanel() {
  return (
    <Box component="article" aria-label="Loading a league" aria-busy="true" sx={{ display: 'flex' }}>
      <Frame component="div" sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Box aria-hidden="true" sx={{ padding: '12px 16px', borderBottom: '2px solid var(--ps-rule)' }}>
          <Skel width="55%" height={18} />
        </Box>
        <Box aria-hidden="true" sx={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Skel width="45%" height={16} />
            <Skel width="75%" height={14} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skel width="72px" height={32} />
            <Skel width="72px" height={32} />
          </Box>
          <Skel width="100%" height={12} />
          <Skel width="50%" height={16} />
        </Box>
        <Box
          aria-hidden="true"
          sx={{
            marginTop: 'auto', borderTop: '2px solid var(--ps-rule)', padding: '12px 16px', display: 'flex', gap: '16px',
          }}
        >
          <Skel width="64px" height={20} />
          <Skel width="48px" height={20} />
          <Skel width="48px" height={20} />
        </Box>
      </Frame>
    </Box>
  );
}

function LeagueCards({
  leagues = [], loading = false, error = null, onRetry, live = false, updatedAt = null,
}) {
  // Live tiles on game day lead; every other league keeps its order after them.
  const tiles = leagues.filter((league) => tileKind(league, live));
  const ordered = live ? [...tiles, ...leagues.filter((league) => !tiles.includes(league))] : leagues;

  // The last displayed score per league. A refresh that changed what a live
  // tile shows flashes it for FLASH_MS, held in state so an unrelated re-render
  // cannot cut it short; a new change restarts the second. The first render of
  // a league never flashes.
  const seen = useRef(new Map());
  const timers = useRef(new Map());
  const [scoredIds, setScoredIds] = useState(() => new Set());
  const signatures = new Map(
    ordered.filter((league) => tileKind(league, live) === 'score').map((league) => [league.id, scoreSignature(league)])
  );
  useEffect(() => {
    signatures.forEach((sig, id) => {
      if (!seen.current.has(id) || seen.current.get(id) === sig) return;
      setScoredIds((ids) => new Set(ids).add(id));
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setScoredIds((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
      }, FLASH_MS));
    });
    seen.current = signatures;
  });
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The stamp ages on the minute even when no refetch lands. It only shows on
  // game day, so off game day no timer runs.
  const updatedMs = updatedAt ? new Date(updatedAt).getTime() : NaN;
  const now = useNow(live ? (at) => (Number.isNaN(updatedMs) ? null : updatedMs + (Math.floor((at - updatedMs) / MINUTE_MS) + 1) * MINUTE_MS) : null, updatedAt);

  const showSkeletons = loading && leagues.length === 0 && !error;
  if (!leagues.length && !error && !showSkeletons) return null;

  const stamp = live && updatedAt ? stampText(updatedAt, now) : null;
  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 24px',
      }}
      >
        <PixelHeading id={HEADING_ID}>{live ? 'Live scores' : 'My leagues'}</PixelHeading>
        {leagues.length > 0 && <NumbersHelp />}
        {stamp && (
          // Plain text, not a live region: it is a stamp, not news.
          <Box sx={{
            fontSize: '13px', color: 'var(--ps-dim)', ml: { xs: 0, md: 'auto' }, flexBasis: { xs: '100%', md: 'auto' },
          }}
          >
            {stamp}
          </Box>
        )}
      </Box>

      {error && (
        <ErrorPanel
          title="Couldn't load your leagues"
          body="Check your connection, then try again."
          onRetry={onRetry}
          retryAriaLabel="Try loading your leagues again"
        />
      )}

      {showSkeletons && (
        <Box sx={GRID_SX}>
          <SkeletonPanel />
          <SkeletonPanel />
          <SkeletonPanel />
        </Box>
      )}

      {ordered.length > 0 && (
        <Box sx={GRID_SX}>
          {ordered.map((league) => (
            <LeagueCard key={league.id} league={league} live={live} scored={scoredIds.has(league.id)} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default LeagueCards;
