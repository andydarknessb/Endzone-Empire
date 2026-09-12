import React from 'react';
import { Box, Typography } from '@mui/material';
import { Badge, Card, GameStateChip, Skeleton, SplitBar } from '../../../shared/ui';
import { formatKickoff } from '../../../shared/lib';
import TeamPickButton from '../../../features/pick-winner';
import ConfidenceMenu from '../../../features/set-confidence';

/**
 * pickem-board widget (#1265, ADR 0038): one game on the board, matching the
 * eleven states in docs/design/pickem/GameCard.dc.html - open (no pick),
 * picked (confidence and straight-up), live, final (correct/missed/no
 * pick/tie), flagged, loading and bare. Which of those a `view`
 * (model/gameCardView.js) plus `mode`/`loading` renders is decided entirely
 * here; the model carries no presentation branching of its own.
 *
 * THE RED-TELL (#1265's acceptance criteria): `view.reveal` is null for an
 * unlocked game (gameCardView/revealTally's contract), and that null is
 * exactly what keeps the reveal row from rendering at all - the pre-lock
 * footer shows only the pickedCount-of-totalManagers line, never a team
 * name, a count by team, or a no-pick tally. Only once `view.reveal` is a
 * real tally (the game is locked) does any direction ever appear.
 */
export default function GameCard({
  view,
  mode = 'straight',
  totalManagers = null,
  slateSize = 0,
  confidenceUsedBy = [],
  flaggedMessage = null,
  loading = false,
  onPickWinner,
  onSetConfidence,
}) {
  if (loading) return <GameCardSkeleton />;

  const [awayTeam, homeTeam] = view.teams;
  const flagged = Boolean(view.flagged);
  const isFinal = view.phase === 'final';
  const isLive = view.phase === 'live';
  const isOpen = view.phase === 'open';

  const sideProps = (team, isHome) => {
    const score = isHome ? view.homeScore : view.awayScore;
    const record = view.records ? (isHome ? view.records.home : view.records.away) : null;
    const won = isFinal && !view.isTie && view.winner === team;
    const lost = isFinal && !view.isTie && view.winner != null && view.winner !== team;
    return {
      team,
      record,
      favorite: view.favorite === team,
      picked: view.myPick === team,
      won,
      dim: lost,
      disabled: view.lock,
      score: isLive || isFinal ? score : null,
      scoreLost: lost,
      possession: isLive && view.situation?.possession === team,
      onSelect: (picked) => onPickWinner?.(view.gameKey, picked),
    };
  };

  return (
    <Card
      data-testid="game-card"
      data-phase={view.phase}
      data-flagged={flagged || undefined}
      sx={{
        backgroundColor: isFinal ? 'var(--dash-surface2)' : 'var(--dash-surface)',
        borderColor: flagged ? 'var(--dash-danger)' : undefined,
        boxShadow: flagged ? '0 0 0 1px var(--dash-danger)' : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: '10px 14px 0 14px', fontSize: '12px' }}>
        <CardHeaderLead view={view} />
        <Box sx={{ flex: 1 }} />
        {isOpen && view.line && (
          <Badge data-testid="odds-badge">
            {`${view.favorite ?? ''} ${(-Math.abs(view.line.spread)).toFixed(1)} · O/U ${view.line.total}`}
          </Badge>
        )}
        {isFinal && <OutcomeBadge outcome={view.outcome} confidence={view.confidence} myPick={view.myPick} />}
        {mode === 'confidence' && !isFinal && (
          <ConfidenceMenu
            value={view.confidence}
            max={slateSize}
            disabledValues={confidenceUsedBy}
            disabled={view.lock}
            bad={flagged}
            onChange={(value) => onSetConfidence?.(view.gameKey, value)}
          />
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', p: '10px 14px 0 14px' }}>
        <TeamPickButton {...sideProps(awayTeam, false)} />
        <TeamPickButton {...sideProps(homeTeam, true)} />
      </Box>

      <MetaRow view={view} isLive={isLive} />

      {flagged ? (
        <ErrorRow message={flaggedMessage} />
      ) : isFinal ? (
        view.headline && <HeadlineRow headline={view.headline} />
      ) : isLive ? (
        <LiveFooter view={view} awayTeam={awayTeam} homeTeam={homeTeam} totalManagers={totalManagers} />
      ) : (
        <PreLockFooter pickedCount={view.pickedCount} totalManagers={totalManagers} />
      )}
    </Card>
  );
}

// The header's leading badge: a plain kickoff/broadcast line before lock, a
// live status chip while in progress, or a neutral "Final" chip once
// settled. Never more than one of the three, matching the canvas.
function CardHeaderLead({ view }) {
  if (view.phase === 'final') {
    return <Badge data-testid="final-badge">Final</Badge>;
  }
  if (view.phase === 'live') {
    const clock = view.quarter && view.timeRemaining ? `${view.quarter} · ${view.timeRemaining}` : (view.quarter || 'Live');
    return (
      <>
        <GameStateChip state="live" data-testid="live-badge">{clock}</GameStateChip>
        <Badge data-testid="locked-badge">Locked</Badge>
      </>
    );
  }
  const kickoffLabel = formatKickoff(view.kickoff);
  return (
    <>
      {kickoffLabel && <Typography component="span" sx={{ fontWeight: 600, color: 'var(--dash-dim)' }}>{kickoffLabel}</Typography>}
      {view.broadcast && <Typography component="span" sx={{ color: 'var(--dash-faint)' }}>{`· ${view.broadcast}`}</Typography>}
    </>
  );
}

// The settled-game outcome badge: correct (+points), missed (names the
// wrong pick), tie (nobody credited, CONTEXT.md's Scoring mode) or no pick.
// Points earned are the manager's own confidence in Confidence mode, or 1 in
// Straight-up (CONTEXT.md's Scoring mode); a correct pick with no known
// confidence (Straight-up) reads as a bare "Correct" rather than "+null".
function OutcomeBadge({ outcome, confidence, myPick }) {
  if (outcome === 'correct') {
    return (
      <Badge variant="success" data-testid="outcome-badge">
        {confidence != null ? `Correct · +${confidence}` : 'Correct'}
      </Badge>
    );
  }
  if (outcome === 'missed') {
    return (
      <Badge variant="danger" data-testid="outcome-badge">
        {`Missed · ${myPick}`}
      </Badge>
    );
  }
  if (outcome === 'tie') {
    return (
      <Badge variant="warning" data-testid="outcome-badge">
        Tie · no credit
      </Badge>
    );
  }
  return (
    <Badge data-testid="outcome-badge">No pick</Badge>
  );
}

// Venue/weather before kickoff, Situation while live; nothing at all once
// final (the headline replaces it) or when the source has nothing for this
// phase (ADR 0038: "the card renders nothing for an absent field").
function MetaRow({ view, isLive }) {
  if (isLive) {
    if (!view.situation) return null;
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', p: '10px 14px 0 14px', fontSize: '12px', color: 'var(--dash-dim)' }}>
        {view.situation.downDistance && (
          <Typography component="span" sx={{ color: 'var(--dash-ink)', fontWeight: 600 }}>
            {view.situation.downDistance}
          </Typography>
        )}
        {view.situation.possession && (
          <Typography component="span">{`${view.situation.possession} ball`}</Typography>
        )}
      </Box>
    );
  }
  if (view.phase === 'final') return null;
  const venueLabel = view.venue ? [view.venue.name, view.venue.city].filter(Boolean).join(' · ') : null;
  const weatherLabel = view.venue?.indoor
    ? 'Indoor'
    : view.weather
      ? [
          view.weather.shortForecast,
          view.weather.temperatureF != null ? `${view.weather.temperatureF}°` : null,
          view.weather.windSpeedMph != null ? `wind ${view.weather.windSpeedMph} mph` : null,
        ].filter(Boolean).join(' · ')
      : null;
  if (!venueLabel && !weatherLabel) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', p: '10px 14px 0 14px', fontSize: '12px', color: 'var(--dash-dim)' }}>
      {venueLabel && <Typography component="span">{venueLabel}</Typography>}
      {weatherLabel && <Typography component="span">{weatherLabel}</Typography>}
    </Box>
  );
}

// Pre-lock footer: the pickedCount-of-totalManagers line and the reveal
// promise, and NOTHING else - this is the whole of the red-tell surface.
function PreLockFooter({ pickedCount, totalManagers }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', p: '10px 14px 12px 14px', fontSize: '12px', color: 'var(--dash-dim)' }}>
      <Typography component="span" data-testid="picked-count">
        <Box component="b" sx={{ color: 'var(--dash-ink)' }}>{pickedCount}</Box>
        {totalManagers != null ? ` of ${totalManagers} managers have picked` : ' managers have picked'}
      </Typography>
      <Typography component="span">League picks reveal at kickoff</Typography>
    </Box>
  );
}

// Live footer: the win probability split (when the poll has one) and the
// league's reveal tally - counts by team, plus how many have no pick.
function LiveFooter({ view, awayTeam, homeTeam, totalManagers }) {
  const probability = view.situation?.homeWinProbability;
  return (
    <Box sx={{ p: '10px 14px 12px 14px' }}>
      {probability != null && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--dash-dim)', mb: '5px' }}>
            <Typography component="span">
              {`Win probability · `}
              <Box component="b" sx={{ color: 'var(--dash-ink)' }}>{`${homeTeam} ${Math.round(probability * 100)}%`}</Box>
            </Typography>
            <Typography component="span">{`${awayTeam} ${100 - Math.round(probability * 100)}%`}</Typography>
          </Box>
          <SplitBar homeName={homeTeam} awayName={awayTeam} homeShare={probability} height={8} />
        </>
      )}
      {view.reveal && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--dash-dim)', mt: probability != null ? '8px' : 0 }}>
          <Typography component="span" data-testid="reveal-counts">
            {'League picks · '}
            <Box component="b" sx={{ color: 'var(--dash-ink)' }}>
              {Object.entries(view.reveal.counts).map(([team, count], index) => (
                <React.Fragment key={team}>
                  {index > 0 ? ', ' : ''}
                  {`${team} ${count}`}
                </React.Fragment>
              ))}
            </Box>
          </Typography>
          {view.reveal.noPick > 0 && (
            <Typography component="span">{`${view.reveal.noPick} no pick`}</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function HeadlineRow({ headline }) {
  return (
    <Typography
      data-testid="headline"
      sx={{ p: '10px 14px 12px 14px', fontSize: '12.5px', color: 'var(--dash-dim)', borderTop: '1px solid var(--dash-line)', mt: '10px' }}
    >
      {headline}
    </Typography>
  );
}

function ErrorRow({ message }) {
  return (
    <Box
      role="alert"
      data-testid="flagged-error"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: '8px 14px',
        m: '10px 14px 12px 14px',
        borderRadius: '8px',
        backgroundColor: 'var(--dash-danger-soft)',
        color: 'var(--dash-danger)',
        fontSize: '12px',
        fontWeight: 600,
      }}
    >
      {message}
    </Box>
  );
}

function GameCardSkeleton() {
  return (
    <Card data-testid="game-card-skeleton">
      <Box sx={{ display: 'flex', gap: 1, p: '10px 14px 0 14px' }}>
        <Skeleton variant="text" width={90} height={12} />
        <Box sx={{ flex: 1 }} />
        <Skeleton variant="rounded" width={120} height={20} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', p: '10px 14px 0 14px' }}>
        {[0, 1].map((index) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Skeleton variant="circular" width={36} height={36} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton variant="text" width={48} height={14} />
              <Skeleton variant="text" width={120} height={10} />
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ p: '10px 14px 12px 14px' }}>
        <Skeleton variant="rounded" width="100%" height={8} />
      </Box>
    </Card>
  );
}
