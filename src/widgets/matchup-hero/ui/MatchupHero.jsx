import React, { useId } from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  Frame, FrameHead, LiveChip, PixelClock, PixelHeading, PsButton, PsLink, SR_ONLY_SX, StatusChip, TeamMark,
  TwoSidedOdds, YouTag, pixelSx,
} from '../../../shared/ui/playselect';
import { formatKickoff, teamNameLabel, ordinal } from '../../../shared/lib';
import { matchupHeroView } from '../model/matchupHeroView';

/**
 * The "Your matchup" hero on Game Center (ADR 0067 wave 2, spec #2334 ruling 6): the viewer's Matchup.
 *
 * While live (and once settled) it is the Board-black versus screen: per side the Team mark and name in
 * Pixel 16, the You tag on the viewer's own side (matched on Team id, never on home/away, #112), the record
 * and rank line, the score in Pixel 32 (24 below sm) with the leader in Board ink and the trailer in Board
 * dim, "Expected final {x}" and "{n} players remaining" on separate lines, then one two-sided win
 * probability bar with both team names and the one "Endzone Forecast" credit, the sentence, and a footer
 * of facts and links ("Matchup", and "Set lineup" as a ghost button). A visually hidden polite live region
 * carries the score sentence only, so it announces when a score changes and not on a repeated payload.
 * Before kickoff it is the framed versus panel: "Proj" figures from the Expected final, "{n} starters set
 * to play", the projected margin over an Ink two-sided bar, "Kickoff {time}" and no 0.0 scores. The page
 * drops "Next kickoff" there because the hero already says it.
 *
 * Props: `matchup` (the entity model), `viewerTeamId`, `records` ({ [teamId]: '2-0' } or null), `ranks`
 * ({ [teamId]: 3 } or null), `leagueId` (the two links), `gamesInProgress` (a count or null),
 * `nextKickoffAt` (ISO or null: the live footer's "Next kickoff", dropped before kickoff where the hero says it once), `countsPending` (true while the lineups behind `counts` are still reading: no count line and no count clause yet), `counts` ({ home: { remaining, yet }, away: ... } or null: the sentence source when the payload has no `yetToPlay`, see matchupHeroView).
 *
 * Paints only `ps-*` tokens. No cursor and no filled action: a watching page (RULINGS "QA round 1").
 */

const BOARD = { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)', rule: 'var(--ps-board-rule)' };
const PAGE = { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)', rule: 'var(--ps-rule)' };

const remainingText = (n) => `${n} ${n === 1 ? 'player' : 'players'} remaining`;
const setToPlayText = (n) => `${n} ${n === 1 ? 'starter' : 'starters'} set to play`;

/** A count as a whole number, or null when unknown. */
const count = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** A tile figure to one decimal, or a dash with a hidden "Not available". */
function figureOrPlaceholder(value) {
  const known = value != null && value !== '' && Number.isFinite(Number(value));
  if (known) return Number(value).toFixed(1);
  return (
    <>
      <span aria-hidden="true">-</span>
      <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
    </>
  );
}

function rankLabel(rank) {
  const ord = ordinal(rank);
  return ord ? `${ord} in league` : null;
}

function gamesInProgressLabel(n) {
  const c = count(n);
  if (c == null) return null;
  if (c <= 0) return 'No games in progress';
  return c === 1 ? '1 game in progress' : `${c} games in progress`;
}

/** The ghost link on Board black: Board ink border and text (PsButton's ghost is Ink, unreadable on the Board). */
function BoardGhost({ to, children }) {
  return (
    <Box
      component={RouterLink}
      to={to}
      data-variant="ghost"
      sx={{
        minHeight: '44px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        padding: '0 16px',
        border: '2px solid var(--ps-board-ink)',
        color: 'var(--ps-board-ink)',
        fontSize: '15px',
        fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      {children}
    </Box>
  );
}

function Side({
  side, name, right, viewer, board, lead, record, rankText, figureLabel, figure, stats,
}) {
  const c = board ? BOARD : PAGE;
  const color = !board || lead ? c.ink : c.dim;
  const line = [record, rankText].filter(Boolean).join(' · ');
  return (
    <Box sx={{ minWidth: 0, textAlign: { xs: 'left', sm: right ? 'right' : 'left' } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', flexDirection: { xs: 'row', sm: right ? 'row-reverse' : 'row' }, color }}>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><TeamMark name={name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} size={40} /></Box>
        <Box component="h3" data-testid="matchup-hero-name" sx={{ m: 0, minWidth: 0, flex: { xs: '1 1 100%', sm: '0 1 auto' }, ...pixelSx(16), color, overflowWrap: 'anywhere' }}>{name}</Box>
        {viewer && <YouTag color={c.ink} />}
      </Box>
      {line && (
        <Box data-testid="matchup-hero-record" sx={{ fontSize: '14px', color: c.dim, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{line}</Box>
      )}
      {figureLabel && <Box sx={{ fontSize: '13px', color: c.dim, marginTop: '14px' }}>{figureLabel}</Box>}
      <Box
        data-testid="matchup-hero-score"
        sx={{
          ...pixelSx(32), fontSize: { xs: '24px', sm: '32px' }, lineHeight: 1.2, marginTop: figureLabel ? '4px' : '14px', color,
        }}
      >
        {figure}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '12px', fontSize: '15px', color: c.ink }}>{stats}</Box>
    </Box>
  );
}

export default function MatchupHero({
  matchup,
  viewerTeamId,
  records = null,
  ranks = null,
  leagueId,
  gamesInProgress = null,
  nextKickoffAt = null,
  counts = null,
  countsPending = false,
  headingLevel = 2,
  ...rest
}) {
  const headingId = useId();
  const view = matchupHeroView(matchup, viewerTeamId, { counts, countsPending });
  const home = matchup?.home || {};
  const away = matchup?.away || {};
  const homeName = teamNameLabel(home.name);
  const awayName = teamNameLabel(away.name);
  const week = matchup?.week;
  // Viewer first (RULINGS Critique 4 item 1, as Matchup): the viewer's own side is the left one, whichever of
  // home or away it is. The test ids stay the real side's, so a reader finds a team by what it is.
  const order = view.viewerSide === 'away' ? ['away', 'home'] : ['home', 'away'];
  const [first, second] = order;
  const names = { home: homeName, away: awayName };
  const started = view.hasStarted === true;
  const board = started;
  const settled = started && !view.isLive;
  const c = board ? BOARD : PAGE;
  const gamesLine = view.hasStarted === false ? 'No games in progress' : gamesInProgressLabel(gamesInProgress);

  const sideProps = (key) => {
    const s = key === 'home' ? home : away;
    const name = key === 'home' ? homeName : awayName;
    // One source per surface: the server pair, or the page's helper counts when the payload lacks yetToPlay.
    // A settled hero (played or final) has a score, not a forecast or anyone left to play: no lines.
    const left = settled || countsPending ? null : counts ? count(counts[key].remaining) : count(s.playersRemaining);
    const expected = s.expectedFinal;
    const stats = (
      <>
        {started && !settled && (
          <Box data-testid="matchup-hero-expected-final">
            <Box component="span" sx={{ color: c.dim }}>Expected final</Box>
            {' '}
            <Box component="b" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{figureOrPlaceholder(expected)}</Box>
          </Box>
        )}
        {left != null && (
          <Box data-testid="matchup-hero-remaining">{view.hasStarted === false ? setToPlayText(left) : remainingText(left)}</Box>
        )}
      </>
    );
    return {
      side: s,
      name,
      right: key === second,
      viewer: view.viewerSide === key,
      board,
      lead: view.leadSide === key,
      record: records ? records[s.teamId] : null,
      rankText: ranks ? rankLabel(ranks[s.teamId]) : null,
      figureLabel: view.hasStarted === false ? 'Proj' : null,
      figure: view.hasStarted === false ? figureOrPlaceholder(expected) : view.scoreLabels[key],
      stats,
    };
  };

  const links = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: { sm: 'auto' }, flexWrap: 'wrap' }}>
      {board ? (
        <>
          <PsLink to={`/league/${leagueId}/matchups/${matchup?.id}`} ariaLabel={`Matchup, ${names[first]} against ${names[second]}`} onBoard>Matchup</PsLink>
          <BoardGhost to={`/league/${leagueId}/lineup`}>Set lineup</BoardGhost>
        </>
      ) : (
        <>
          <PsLink to={`/league/${leagueId}/matchups/${matchup?.id}`} ariaLabel={`Matchup, ${names[first]} against ${names[second]}`}>Matchup</PsLink>
          <PsButton variant="ghost" to={`/league/${leagueId}/lineup`}>Set lineup</PsButton>
        </>
      )}
    </Box>
  );

  const nextKickoff = started ? formatKickoff(nextKickoffAt) : null;
  const facts = (gamesLine || nextKickoff) && (
    <Box data-testid="matchup-hero-footer-facts" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 20px', fontSize: '14px', color: c.dim }}>
      {gamesLine && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          {board && view.isLive ? (
            <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', flex: 'none', backgroundColor: 'var(--ps-board-live)' }} />
          ) : (
            <PixelClock />
          )}
          {gamesLine}
        </Box>
      )}
      {nextKickoff && <Box component="span">{`Next kickoff ${nextKickoff}`}</Box>}
    </Box>
  );

  if (!started) {
    const leader = view.projectedLeader === 'home' ? homeName : awayName;
    const probability = view.projectedWinProbability;
    return (
      <Frame
        labelledBy={headingId}
        data-testid="matchup-hero"
        {...rest}
        head={(
          <FrameHead>
            <PixelHeading id={headingId} level={headingLevel}>Your matchup</PixelHeading>
            {week != null && <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{`Week ${week}`}</Box>}
            {view.chipLabel && <Box component="span" sx={{ marginLeft: 'auto' }} data-testid="matchup-hero-status"><StatusChip>{view.chipLabel}</StatusChip></Box>}
          </FrameHead>
        )}
      >
        <Box sx={{ padding: { xs: '14px', md: '24px' }, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: { xs: '12px', md: '24px' }, alignItems: 'start' }}>
            {order.map((key) => (
              <Box key={key} data-testid={`matchup-hero-side-${key}`} data-viewer-team={view.viewerSide === key || undefined} sx={{ minWidth: 0 }}><Side {...sideProps(key)} /></Box>
            ))}
          </Box>
          {probability && (
            <Box data-testid="matchup-hero-win-probability" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {view.projectedLeader && (
                <Box sx={{ fontSize: '16px' }}>
                  <Box component="span" sx={{ color: 'var(--ps-dim)' }}>Projected margin · </Box>
                  <Box component="b" sx={{ fontWeight: 700 }}>{`${leader} by ${view.projectedMargin.toFixed(1)}`}</Box>
                </Box>
              )}
              <TwoSidedOdds
                a={names[first]}
                b={names[second]}
                pct={first === 'home' ? probability.homePct : probability.awayPct}
                caption={<>Win probability · <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box></>}
              />
            </Box>
          )}
          {view.hasStarted === false && (
            <Box
              data-testid="matchup-hero-kickoff"
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '14px 0', borderTop: '2px solid var(--ps-rule)', borderBottom: '2px solid var(--ps-rule)',
              }}
            >
              <Box component="span" sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>Kickoff</Box>
              <Box component="span" sx={{ ...pixelSx(16), fontSize: { xs: '16px', md: '24px' } }}>{view.kickoff ?? 'TBD'}</Box>
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>{facts}{links}</Box>
        </Box>
      </Frame>
    );
  }

  const probability = view.winProbability;
  const sentence = `${names[first]} ${view.scoreLabels[first]}, ${names[second]} ${view.scoreLabels[second]}`;
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="matchup-hero"
      {...rest}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: { xs: '12px', md: '20px' },
        padding: { xs: '12px', md: '24px' },
        boxSizing: 'border-box',
        backgroundColor: 'var(--ps-board)',
        color: 'var(--ps-board-ink)',
        border: '6px double var(--ps-board-dim)',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <PixelHeading id={headingId} level={headingLevel}>Your matchup</PixelHeading>
        {week != null && <Box component="span" sx={{ fontSize: '13px', color: BOARD.dim }}>{`Week ${week}`}</Box>}
        <Box component="span" data-testid="matchup-hero-status" sx={{ marginLeft: 'auto' }}>
          {view.isLive ? <LiveChip onBoard /> : <StatusChip onBoard>{view.chipLabel || 'Final'}</StatusChip>}
        </Box>
      </Box>
      <Box component="p" aria-live="polite" data-testid="matchup-hero-live-region" sx={{ m: 0, ...SR_ONLY_SX }}>{sentence}</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: { xs: '12px', md: '24px' }, alignItems: 'start' }}>
        {order.map((key) => (
          <Box key={key} data-testid={`matchup-hero-side-${key}`} data-viewer-team={view.viewerSide === key || undefined} sx={{ minWidth: 0 }}><Side {...sideProps(key)} /></Box>
        ))}
      </Box>
      <Box data-testid="matchup-hero-win-probability" sx={{ display: 'flex', flexDirection: 'column', gap: { xs: '6px', md: '10px' } }}>
        {probability && (
          <TwoSidedOdds
            a={names[first]}
            b={names[second]}
            pct={first === 'home' ? probability.homePct : probability.awayPct}
            live={view.isLive}
            onBoard
            caption={<>Win probability · <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box></>}
          />
        )}
        {view.sentence && (
          <Box component="p" data-testid="matchup-hero-sentence" sx={{ m: 0, fontSize: { xs: '14px', md: '15px' }, textWrap: 'pretty' }}>{view.sentence}</Box>
        )}
      </Box>
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 16px', paddingTop: '12px', borderTop: `2px solid ${BOARD.rule}`,
      }}
      >
        {facts}
        {links}
      </Box>
    </Box>
  );
}

// The same component under its name, for `import { MatchupHero }`.
export { MatchupHero };
