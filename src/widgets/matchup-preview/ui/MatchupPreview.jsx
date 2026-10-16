import React from 'react';
import { Box } from '@mui/material';
import {
  CpuTag, Frame, FrameHead, LiveChip, PixelHeading, PsLink, Skel, StatusChip, TwoSidedOdds, pixelSx,
} from '../../../shared/ui/playselect';
import { PsAction, SrOnly } from '../../../shared/ui/playselect/LineupParts';
import useMatchupPreview from '../model/useMatchupPreview';

/**
 * The Lineup rail's matchup card (ticket #640; the League Dashboard now reads only this widget's model,
 * `useMatchupPreview`, and draws its own Play-select view): the viewer's own Team and this week's opponent
 * side by side, each with its name and a figure, and one footer link, "Matchup", to the matchup detail.
 * The lineup page is not linked from here (#1979 L4): the My Team card and Quick Actions both carry Set
 * Lineup.
 *
 * The card has two faces, and which one it wears is the server's `status`, read through the entity's
 * `matchupBoard` in the model (ADR 0030), never inferred here:
 *
 *   - BEFORE kickoff (and on an unknown status, which asserts neither state): a tertiary frame; each side's
 *     projected total under a "Proj" label, plus one caption naming which way the projections lean. The
 *     header's tail (#1102) is the row's own `first_kickoff_at`, weekday and time ("Kicks off Sun
 *     12:00 PM"); a row that carries no kickoff falls back to "Projections update daily".
 *   - ONCE STARTED: Board black, like the dashboard's scoreboard tile. Each side's live score in Pixel 24
 *     with "Expected final {x}" and "{n} players remaining" under it (spec #2347 ruling 4: never "PMR"), a
 *     two-sided win-probability bar fed by the entity board's `winProbability`, the same figure Game
 *     Center's hero reads, so the two surfaces cannot disagree. It is never given a points ratio, whose
 *     accessible name ("Win probability", #872) would then be a false claim.
 *
 * The matchups-list read is the card's spine: while it is in flight the card holds its layout with
 * skeletons, and if it fails the card shows one compact, self-contained error with a ghost Retry and nothing
 * else, so a failed read never touches the rest of the page. Each side's projected total prefers the list
 * row's own value and falls back to a chained detail read only when the list could not answer both sides
 * (#670; see useMatchupPreview.js for the condition). While that fallback is in flight each number is
 * skeletoned and the card stays aria-busy; when the list already answered, nothing is in flight and the card
 * is never busy on the totals' account. Either way, a miss or a failed detail read degrades just that number
 * to a placeholder without erroring the card.
 *
 * Paints `ps-*` tokens only (ADR 0067 wave 3); live text holds no button.
 */
export default function MatchupPreview({ leagueId }) {
  const {
    week, status, busy, matchupId, viewer, opponent, game, narrative, refetch,
  } = useMatchupPreview(leagueId);
  const title = week != null ? `Week ${week} Matchup` : 'Matchup';
  const started = game.hasStarted === true;
  const onBoard = started;
  const ink = onBoard ? 'var(--ps-board-ink)' : 'var(--ps-ink)';
  const dim = onBoard ? 'var(--ps-board-dim)' : 'var(--ps-dim)';

  // The leader's name and score read in ink and the trailer's in dim, on the Board tile only.
  const viewerScore = Number(viewer?.score);
  const opponentScore = Number(opponent?.score);
  const leader = started && Number.isFinite(viewerScore) && Number.isFinite(opponentScore) && viewerScore !== opponentScore
    ? (viewerScore > opponentScore ? 'viewer' : 'opponent')
    : null;

  // The header's tail: the status chip once started, "Kicks off {weekday time}" before, else the caption. The
  // status testid names the first two (the caption is no status).
  let tail;
  if (started && game.chipLabel != null) {
    tail = (
      <Box component="span" data-testid="matchup-preview-status" data-variant={game.chipVariant}>
        {game.isLive
          ? <LiveChip onBoard>{game.chipLabel}</LiveChip>
          : <StatusChip onBoard>{game.chipLabel}</StatusChip>}
      </Box>
    );
  } else if (!started && game.kickoffLabel != null) {
    tail = <span data-testid="matchup-preview-status" data-variant="neutral">{`Kicks off ${game.kickoffLabel}`}</span>;
  } else {
    tail = 'Projections update daily';
  }

  // The card is the region that owns these fetches (the loading state is announced by the owning card,
  // not by each aria-hidden shape), so it carries aria-busy while the reads that hold its layout with
  // skeletons are still loading.
  return (
    <Frame
      tier="rule"
      labelledBy="matchup-preview-h"
      data-testid="matchup-preview"
      aria-busy={busy}
      sx={onBoard ? { backgroundColor: 'var(--ps-board)', color: 'var(--ps-board-ink)', border: '2px solid var(--ps-board-dim)' } : undefined}
      head={(
        <FrameHead>
          <PixelHeading id="matchup-preview-h" size={16}>{title}</PixelHeading>
          <Box component="span" sx={{ ml: 'auto', fontSize: '13px', color: dim }}>{tail}</Box>
        </FrameHead>
      )}
    >
      {status === 'loading' && <VersusSkeleton />}

      {status === 'error' && (
        <Box sx={{ p: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          <Box role="alert" data-testid="matchup-preview-error" sx={{ flex: '1 1 220px', fontSize: '15px' }}>
            We could not load this week&apos;s matchup right now.
          </Box>
          {refetch && <PsAction onClick={refetch}>Retry</PsAction>}
        </Box>
      )}

      {status === 'empty' && (
        <Box sx={{ p: '16px', fontSize: '15px', color: 'var(--ps-dim)' }}>No matchup this week</Box>
      )}

      {status === 'ready' && (
        <Box sx={{ p: { xs: '14px', md: '16px' }, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Box data-testid="matchup-versus" sx={VERSUS_SX}>
            <Side testid="matchup-side-viewer" side={viewer} started={started} lead={leader === 'viewer'} trail={leader === 'opponent'} />
            <Side testid="matchup-side-opponent" side={opponent} started={started} lead={leader === 'opponent'} trail={leader === 'viewer'} right />
          </Box>

          {game.winProbability && (
            <Box data-testid="matchup-win-probability">
              <TwoSidedOdds
                a={viewer.name}
                b={opponent.name}
                pct={game.winProbability.viewerPct}
                live={game.isLive === true}
                onBoard={onBoard}
                caption={<>Win probability · <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box></>}
                size={13}
              />
            </Box>
          )}

          {game.projectedMargin != null && (
            <Box component="p" data-testid="matchup-projected-margin" sx={{ m: 0, fontSize: '14px', color: dim }}>
              {game.projectedMargin}
            </Box>
          )}

          {narrative && (
            <Box component="p" data-testid="matchup-preview-narrative" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: ink }}>
              {narrative}
            </Box>
          )}

          <Box sx={{ ml: '-10px' }}>
            <PsLink
              to={`/league/${leagueId}/matchups/${matchupId}`}
              ariaLabel={`Matchup, ${viewer.name} against ${opponent.name}`}
              onBoard={onBoard}
            >
              Matchup
            </PsLink>
          </Box>
        </Box>
      )}
    </Frame>
  );
}

// The versus block: two columns at every width (#1979 L2), so the two scores sit side by side and the card
// stays above the fold on a phone. The tracks carry a zero minimum so a long Team name shrinks its column
// instead of widening the card.
const VERSUS_SX = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '12px',
};

// One side of the versus block: the Team name (pixel 16, as every team name in a head), the display figure
// and its label, and once the game is on, the two lines the score displaced.
function Side({ testid, side, started, lead = false, trail = false, right = false }) {
  const live = started;
  const dim = live ? 'var(--ps-board-dim)' : 'var(--ps-dim)';
  const ink = live ? 'var(--ps-board-ink)' : 'var(--ps-ink)';
  const tone = trail ? dim : ink;
  return (
    <Box data-testid={testid} data-leader={lead ? 'true' : undefined} sx={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
      <Box component="h3" sx={{ m: 0, ...pixelSx(16), color: tone, overflowWrap: 'anywhere' }}>{side.name}</Box>
      {side.isCpu && <Box sx={{ mt: '4px' }}><CpuTag /></Box>}
      {started ? (
        <Box data-testid="matchup-side-score" sx={{ ...pixelSx(24), lineHeight: 1.3, mt: '4px', color: tone }}>
          {side.score != null ? side.score : <Placeholder />}
        </Box>
      ) : (
        <>
          <Box sx={{ fontSize: '13px', color: dim, mt: '8px' }}>Proj</Box>
          <ProjectedValue projected={side.projected} />
        </>
      )}
      {started && side.projected.value != null && (
        <Box data-testid="matchup-expected-final" sx={{ fontSize: '13px', color: dim, mt: '4px' }}>
          {`Expected final ${side.projected.value}`}
        </Box>
      )}
      {started && side.playersRemaining != null && (
        <Box data-testid="matchup-players-remaining" sx={{ fontSize: '13px', color: dim }}>
          {`${side.playersRemaining} players remaining`}
        </Box>
      )}
    </Box>
  );
}

function ProjectedValue({ projected }) {
  if (projected.loading) return <Skel data-testid="matchup-skeleton" width="64px" height={32} />;
  return (
    <Box sx={{ ...pixelSx(24), lineHeight: 1.3 }}>
      {projected.value != null ? projected.value : <Placeholder />}
    </Box>
  );
}

// The placeholder mark for a figure that is not available yet: a dash, no digits. The dash is a visual mark
// only, so it is aria-hidden and a screen-reader-only "Not available" carries the same meaning.
function Placeholder() {
  return (
    <>
      <Box component="span" aria-hidden="true">-</Box>
      <SrOnly>Not available</SrOnly>
    </>
  );
}

// The loading shape carries the SAME tracks as the real versus block (and the same testid, since only one of
// the two is ever mounted), or the card reflows the moment the read lands.
function VersusSkeleton() {
  return (
    <Box data-testid="matchup-versus" sx={{ ...VERSUS_SX, p: { xs: '14px', md: '16px' } }}>
      <SideSkeleton />
      <SideSkeleton />
    </Box>
  );
}

function SideSkeleton() {
  return (
    <Box sx={{ display: 'grid', gap: '8px' }}>
      <Skel data-testid="matchup-skeleton" width="90px" height={16} />
      <Skel data-testid="matchup-skeleton" width="64px" height={32} />
    </Box>
  );
}
