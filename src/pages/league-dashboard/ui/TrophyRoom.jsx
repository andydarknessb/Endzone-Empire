import React, { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelArrow, PixelHeading, pixelSx, PsLinkButton, TeamMark,
} from '../../../shared/ui/playselect';
import { COLLAPSED_ROWS, isSeasonAward, orderAwards } from '../../../components/TrophyCase/TrophyCase';

// Pixel trophy sprites on a 2px grid (docs/design/league/league-kit.js): a cup for the champion and
// the weekly high, a star for the other awards.
const SPRITES = {
  cup: ['....############....', '....############....', '##..############..##', '#.#.############.#.#', '#.#.############.#.#', '##..############..##', '....############....', '.....##########.....', '......########......', '.......######.......', '........####........', '.........##.........', '.........##.........', '.......######.......', '......########......', '......########......'],
  star: ['.......##.......', '.......##.......', '......####......', '......####......', '################', '.##############.', '..############..', '...##########...', '...##########...', '..####....####..', '..###......###..', '.###........###.', '.##..........##.'],
};
const CUP_TYPES = new Set(['champion', 'pickem_champion', 'weekly_high', 'top_scorer']);

function Sprite({ kind, scale = 3 }) {
  const rows = SPRITES[kind];
  const d = rows
    .map((row, j) => [...row].map((c, i) => (c === '#' ? `M${i * 2} ${j * 2}h2v2h-2z` : '')).join(''))
    .join('');
  return (
    <svg
      width={rows[0].length * scale}
      height={rows.length * scale}
      viewBox={`0 0 ${rows[0].length * 2} ${rows.length * 2}`}
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ display: 'block', flex: 'none', color: 'var(--ps-frame)' }}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/**
 * Mid-season the trophy room is one link, not a frame ("Trophy case · 6 awards this season"): a
 * tertiary-edge row to the league's trophy case page, which reads the same live trophies this count
 * does. League History reads the season archive and never carries the live season's awards, so it
 * cannot show them. Renders nothing without a trophy.
 */
export function TrophyLink({ leagueId, count }) {
  if (!count) return null;
  return (
    <Box
      component={RouterLink}
      to={`/league/${leagueId}/trophies`}
      aria-label={`Trophy case, ${count} ${count === 1 ? 'award' : 'awards'} this season`}
      data-testid="trophy-link"
      sx={{
        border: '2px solid var(--ps-frame-2)',
        backgroundColor: 'var(--ps-panel)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        minHeight: '44px',
        padding: { xs: '8px 14px', md: '8px 20px' },
        boxSizing: 'border-box',
        color: 'inherit',
        fontSize: '15px',
        fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      <span>{`Trophy case · ${count} ${count === 1 ? 'award' : 'awards'} this season`}</span>
      <PixelArrow />
    </Box>
  );
}

function AwardItem({ trophy }) {
  return (
    <Box component="li" data-testid={`trophy-${trophy.id}`} sx={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 0', listStyle: 'none' }}>
      <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: '80px', flex: 'none' }}>
        <Sprite kind={CUP_TYPES.has(trophy.type) ? 'cup' : 'star'} />
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Box component="h3" sx={{ m: 0, ...pixelSx(16), overflowWrap: 'anywhere', textWrap: 'balance' }}>{trophy.label}</Box>
        <Box sx={{ fontSize: '15px' }}>
          <Box component="b" sx={{ fontWeight: 600 }}>{trophy.team_name}</Box>
          {!isSeasonAward(trophy) && <Box component="span" sx={{ color: 'var(--ps-dim)' }}>{` · Week ${trophy.week}`}</Box>}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The completed season's trophy room (ADR 0067 ruling 2): a primary frame over the `useTrophies` read
 * (exported from the TrophyCase module, whose card keeps its look and which League history still
 * imports the medal icons from). It opens on the season's League Champion - a large pixel cup, the
 * team in Pixel 24 - then the award list in three columns, capped at six with one toggle; a Season
 * select appears when the league has more than one. It shows only what the trophies carry (award,
 * team, week), never an invented figure, and renders nothing for an empty case.
 */
export default function TrophyRoom({ trophy: state, teams = [] }) {
  const {
    trophies, loading, error, season, setSeason, seasonOptions, visibleTrophies,
  } = state;
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);

  if (loading || error || trophies.length === 0) return null;

  const champion = visibleTrophies.find((t) => t.type === 'champion' || t.type === 'pickem_champion');
  const championTeam = champion ? teams.find((t) => t.teamId === champion.team_id) : null;
  const awards = orderAwards(visibleTrophies.filter((t) => t !== champion));
  const shown = expanded ? awards : awards.slice(0, COLLAPSED_ROWS);
  const capped = awards.length > COLLAPSED_ROWS;

  return (
    <Frame
      labelledBy={headingId}
      data-testid="trophy-case"
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Trophy room</PixelHeading>
          {seasonOptions.length > 1 && (
            <Box component="label" sx={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '14px', fontWeight: 600 }}>
              Season
              <Box
                component="select"
                value={season}
                onChange={(event) => { setSeason(Number(event.target.value)); setExpanded(false); }}
                data-testid="trophy-season-select"
                sx={{
                  boxSizing: 'border-box', height: '44px', minWidth: '140px', padding: '0 12px', borderRadius: 0, border: '2px solid var(--ps-dim)', backgroundColor: 'var(--ps-field)', color: 'var(--ps-ink)', fontFamily: 'inherit', fontSize: '16px',
                }}
              >
                {seasonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </Box>
            </Box>
          )}
        </FrameHead>
      )}
    >
      {visibleTrophies.length === 0 ? (
        <Box component="p" sx={{ m: 0, padding: '24px 20px', fontSize: '16px', fontWeight: 600 }}>No trophies for this season yet</Box>
      ) : (
        <>
          {champion && (
            <Box
              data-testid="trophy-champion"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'auto minmax(0, 1fr)' },
                gap: { xs: '16px', md: '32px' },
                alignItems: 'center',
                padding: { xs: '16px 14px', md: '24px 20px' },
                borderBottom: '2px solid var(--ps-rule)',
              }}
            >
              <Box sx={{ padding: '20px 28px', border: '2px dashed var(--ps-frame)', display: 'grid', placeItems: 'center' }}>
                <Sprite kind="cup" scale={8} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                <Box component="h3" sx={{ m: 0, ...pixelSx(16) }}>{`${champion.season} ${champion.label}`}</Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
                  <TeamMark name={champion.team_name} avatarUrl={championTeam?.avatar_url} avatarStaticUrl={championTeam?.avatar_static_url} size={48} />
                  <Box component="span" sx={{ ...pixelSx(24), lineHeight: 1.3, overflowWrap: 'anywhere' }}>{champion.team_name}</Box>
                </Box>
              </Box>
            </Box>
          )}
          {shown.length > 0 && (
            <Box
              component="ul"
              id={listId}
              aria-label="Awards"
              sx={{
                m: 0, padding: { xs: '8px 14px', md: '8px 20px' }, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: '0 24px',
              }}
            >
              {shown.map((trophy) => <AwardItem key={trophy.id} trophy={trophy} />)}
            </Box>
          )}
          {capped && (
            <Box sx={{ padding: '0 10px 4px', borderTop: '2px solid var(--ps-rule)' }}>
              <PsLinkButton
                data-testid="trophy-show-all"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? 'Show fewer awards' : `Show all ${awards.length} awards`}
              </PsLinkButton>
            </Box>
          )}
        </>
      )}
    </Frame>
  );
}
