import React, { useId } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  CpuTag, Frame, FrameHead, PixelArrow, PixelCheck, PixelHeading, StatusChip, TeamMark, TwoSidedOdds, pixelSx, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import { useCpuTeamIds } from '../../../hooks/useCpuTeamIds';
import { formatKickoff } from '../../../shared/lib';
import { matchupCardView } from '../model/matchupCardView';

/**
 * Game Center's League matchups frame (ADR 0031, ticket #894; Play-select, ADR 0067 wave 2, spec #2334
 * ruling 6): a tertiary frame (2px rule, Pixel 16 h2) of the dashboard's Around-the-league tiles.
 *
 * Desktop tiles: framed with "Proj" figures before kickoff; Board black while live, with "Exp final {x}"
 * and "{n} players remaining" on separate lines and no chip (Board black already says live, so the Live
 * chip stays on the h1 row and the hero); "Awaiting final" and "Waiting on the score of record" once
 * played; on a final the winner in ink with no bar. Win probability names both sides on the two-sided
 * bar. Below `sm` the grid is a list of ~56px rows: both short team names, both scores, the leader
 * marked with the word "Leads", the win probability naming its team, and a "Details" cue, all read as the row's name.
 *
 * The frame head says it once while tiles are framed: before kickoff "All games kick off {earliest kickoff} ·
 * projected totals" (RULINGS Critique 10 item 13, binding over the spec line), and with some games started
 * "Projected totals shown until kickoff". Every
 * tile is one link to its matchup. It carries no aria-label of its own: its name is its content (both team
 * names, the figures, Exp final and players remaining, the two-sided bar's one label naming both teams and both
 * percentages, Details), so what is read is what is drawn (label in name) and nothing is stated twice.
 *
 * Props: `matchups` (entity models), `leagueId`, `records` (a Team id lookup), `viewerTeamId` (the viewer's Team: its own card names it first; every other card stays home first), `more` (the head's
 * "{n} more" count, when the hero already shows the viewer's own), `empty` (the line to show when there
 * are no matchups; without it an empty list renders nothing). Paints only `ps-*` tokens.
 */
export default function MatchupGrid({
  matchups,
  leagueId,
  records,
  viewerTeamId,
  more,
  empty,
  'data-testid': testId = 'matchup-grid',
}) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const headingId = useId();
  const cpuTeamIds = useCpuTeamIds(leagueId);
  const list = Array.isArray(matchups) ? matchups : [];
  if (list.length === 0 && !empty) return null;

  const views = list.map((matchup) => withCpu(matchupCardView(matchup, { records, viewerTeamId }), cpuTeamIds));
  const scheduled = views.filter((view) => view.state === 'scheduled');
  const allScheduled = views.length > 0 && scheduled.length === views.length;
  // RULINGS Critique 10 item 13: before kickoff the head says so once, with the earliest kickoff.
  const kickoffs = scheduled.map((view) => new Date(view.kickoffAt).getTime()).filter(Number.isFinite);
  const earliest = kickoffs.length ? formatKickoff(new Date(Math.min(...kickoffs))) : null;
  const credit = (
    <>
      win probability ·
      {' '}
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box>
    </>
  );

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>League matchups</PixelHeading>
          {more != null && more > 0 && (
            <Box component="span" data-testid="game-center-grid-count" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{`${more} more`}</Box>
          )}
          {views.length > 0 && (
            <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)', marginLeft: { sm: 'auto' }, width: { xs: '100%', sm: 'auto' } }}>
              {allScheduled && <>{earliest ? `All games kick off ${earliest} ` : 'All games kick off '}· projected totals · {credit}</>}
              {!allScheduled && scheduled.length > 0 && <>Projected totals shown until kickoff · {credit}</>}
              {scheduled.length === 0 && credit}
            </Box>
          )}
        </FrameHead>
      )}
    >
      {views.length === 0 ? (
        <Box component="p" data-testid="game-center-grid-empty" sx={{ m: 0, padding: { xs: '14px', md: '20px' }, fontSize: '15px', color: 'var(--ps-dim)' }}>
          {empty}
        </Box>
      ) : (
        <Box
          component="ul"
          role="list"
          data-testid={testId}
          data-layout={compact ? 'rows' : 'cards'}
          sx={{
            listStyle: 'none',
            m: 0,
            padding: compact ? '12px' : '16px',
            display: 'grid',
            gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
            gap: compact ? '8px' : '16px',
          }}
        >
          {views.map((view, index) => {
            const key = view.id != null ? view.id : `index-${index}`;
            return (
              <Box component="li" key={key} sx={{ minWidth: 0 }}>
                {compact ? <MatchupRow view={view} leagueId={leagueId} /> : <MatchupTile view={view} leagueId={leagueId} />}
              </Box>
            );
          })}
        </Box>
      )}
    </Frame>
  );
}

// Marks each side the CPU manages (ADR 0068); the view model stays pure.
function withCpu(view, cpuTeamIds) {
  if (cpuTeamIds.size === 0) return view;
  return {
    ...view,
    first: { ...view.first, isCpu: cpuTeamIds.has(view.first.teamId) },
    second: { ...view.second, isCpu: cpuTeamIds.has(view.second.teamId) },
  };
}

const matchupPath = (leagueId, id) => `/league/${leagueId}/matchups/${id}`;

const TILE_BASE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '16px',
  boxSizing: 'border-box',
  height: '100%',
  minWidth: 0,
  textDecoration: 'none',
};

function TileSide({ side, colors, figureLabel, state }) {
  const dim = state === 'live' || state === 'final' ? !side.leads : false;
  const color = dim ? colors.dim : colors.ink;
  return (
    <Box data-testid={side.testId} sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, color }}>
      <TeamMark name={side.name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} />
      <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        <Box sx={{ fontSize: '15px', fontWeight: side.leads && state !== 'scheduled' ? 700 : 600 }}>
          {side.name}
          {side.isCpu && <>{' '}<CpuTag /></>}
          {side.record && <Box component="span" sx={{ fontSize: '13px', fontWeight: 400, color: colors.dim, whiteSpace: 'nowrap' }}>{` ${side.record}`}</Box>}
        </Box>
        {(side.expectedLine || side.remainingLine) && (
          <Box sx={{ fontSize: '13px', color: colors.dim }}>
            {side.expectedLine && <Box data-testid="matchup-side-expected">{side.expectedLine}</Box>}
            {side.remainingLine && <Box data-testid="matchup-side-remaining">{side.remainingLine}</Box>}
          </Box>
        )}
      </Box>
      {side.winner && (
        <Box role="img" aria-label="Winner" data-testid="leader-check" sx={{ display: 'inline-flex', color: 'var(--ps-ink)' }}>
          <PixelCheck />
        </Box>
      )}
      <Box component="span" data-testid="matchup-figure" sx={{ ...pixelSx(16), flex: 'none' }}>
        <Box component="span" sx={SR_ONLY_SX}>{`${figureLabel} `}</Box>
        {side.figure === '-' ? (
          <>
            <span aria-hidden="true">-</span>
            <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
          </>
        ) : side.figure}
      </Box>
    </Box>
  );
}

function Details({ colors }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: colors.ink }}>
      Details
      <PixelArrow />
    </Box>
  );
}

/** Desktop tile: the dashboard's Around-the-league tile at Game Center's size. */
function MatchupTile({ view, leagueId }) {
  const board = view.state === 'live';
  const colors = board
    ? { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)' }
    : { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)' };
  const figureLabel = view.scheduled ? 'Projected' : 'Score';
  const first = { ...view.first, testId: 'matchup-side-home' };
  const second = { ...view.second, testId: 'matchup-side-away' };
  let foot = '';
  if (view.state === 'played') foot = 'Waiting on the score of record';
  else if (view.state === 'final') foot = 'Score of record';

  return (
    <Box
      component={RouterLink}
      to={matchupPath(leagueId, view.id)}
      data-testid="matchup-card"
      data-matchup-id={view.id}
      data-layout="card"
      data-state={view.state}
      sx={{
        ...TILE_BASE,
        color: colors.ink,
        backgroundColor: board ? 'var(--ps-board)' : 'var(--ps-panel)',
        border: `2px solid ${board ? 'var(--ps-board-dim)' : 'var(--ps-frame-2)'}`,
      }}
    >
      {(view.state === 'final' || view.state === 'played') && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }} data-testid="matchup-status">
          <StatusChip>{view.state === 'final' ? 'Final' : 'Awaiting final'}</StatusChip>
        </Box>
      )}
      {view.scheduled && (
        <Box component="span" aria-hidden="true" sx={{ alignSelf: 'flex-end', margin: '-4px 0 -6px', fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: colors.dim }}>Proj</Box>
      )}
      <TileSide side={first} colors={colors} figureLabel={figureLabel} state={view.state} />
      <Box aria-hidden="true" data-testid="matchup-rule" sx={{ height: '2px', backgroundColor: board ? 'var(--ps-board-rule)' : 'var(--ps-rule)' }} />
      <TileSide side={second} colors={colors} figureLabel={figureLabel} state={view.state} />
      {view.firstPct != null && (
        <TwoSidedOdds a={first.name} b={second.name} pct={view.firstPct} live={board} onBoard={board} />
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '13px', color: colors.dim }}>
        <span data-testid="matchup-card-footer">{foot}</span>
        <Details colors={colors} />
      </Box>
    </Box>
  );
}

/** Phone row (~56px): both short names, both scores, "Leads" in words, the probability naming its team. */
function MatchupRow({ view, leagueId }) {
  const board = view.state === 'live';
  const colors = board
    ? { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)' }
    : { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)' };
  const fav = view.favourite ? view[view.favourite] : null;
  const favPct = view.favourite === 'first' ? view.firstPct : view.secondPct;
  const stateWord = view.state === 'final' ? 'Final' : view.state === 'played' ? 'Awaiting final' : view.scheduled ? 'Proj' : null;

  const line = (side, testId) => {
    const dim = (view.state === 'live' || view.state === 'final') && !side.leads;
    const color = dim ? colors.dim : colors.ink;
    return (
      <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '28px', color }}>
        <TeamMark name={side.name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} size={24} />
        <Box component="span" sx={{
          flex: '0 1 auto', minWidth: 0, fontSize: '15px', fontWeight: side.leads ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        >
          {side.name}
        </Box>
        {side.isCpu && <CpuTag />}
        {side.leads && view.state !== 'scheduled' && (
          <Box component="span" sx={{ flex: 'none', fontSize: '13px', fontWeight: 600, color: colors.ink, whiteSpace: 'nowrap' }}>Leads</Box>
        )}
        <Box sx={{ flex: 1 }} />
        <Box component="span" data-testid="matchup-figure" sx={{ ...pixelSx(16), flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
          {side.figure === '-' ? <span aria-hidden="true">-</span> : side.figure}
        </Box>
      </Box>
    );
  };

  return (
    <Box
      component={RouterLink}
      to={matchupPath(leagueId, view.id)}
      data-testid="matchup-card"
      data-matchup-id={view.id}
      data-layout="row"
      data-state={view.state}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px 12px',
        minHeight: '56px',
        boxSizing: 'border-box',
        textDecoration: 'none',
        color: colors.ink,
        backgroundColor: board ? 'var(--ps-board)' : 'var(--ps-panel)',
        border: `2px solid ${board ? 'var(--ps-board-dim)' : 'var(--ps-frame-2)'}`,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        {line(view.first, 'matchup-side-home')}
        {line(view.second, 'matchup-side-away')}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minWidth: 0, fontSize: '13px', color: colors.dim }}>
        <Box component="span" sx={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fav ? (
            <>
              <Box component="b" sx={{ fontWeight: 700, color: colors.ink }}>{`${favPct}%`}</Box>
              {` ${fav.name}`}
            </>
          ) : stateWord}
        </Box>
        <Details colors={colors} />
      </Box>
    </Box>
  );
}
