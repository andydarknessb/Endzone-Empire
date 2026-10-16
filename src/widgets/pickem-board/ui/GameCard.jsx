import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import {
  LiveChip, PixelCheck, PixelWarn, PsButton, Skel, StatusChip, TwoSidedOdds, pixelSx, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import { formatKickoff } from '../../../shared/lib';
import TeamPickButton, { getTeamName } from '../../../features/pick-winner';
import ConfidenceMenu from '../../../features/set-confidence';
import { LockIcon } from './parts';

/**
 * pickem-board widget (ADR 0038, Play-select in ADR 0067 wave 2): one game on the board, a row
 * inside its kickoff window's frame: open (no pick, picked), live, final (correct, missed, no pick,
 * tie), loading. Which of those a `view` (model/gameCardView.js) plus `mode`/`loading` renders is
 * decided entirely here; the model carries no presentation branching of its own.
 *
 * THE RED-TELL (ADR 0038): `view.reveal` is null for an unlocked game, and that null keeps the reveal
 * row from rendering at all. The pre-lock footer shows only how many managers have picked, never a
 * team, a count by team or a no-pick tally.
 *
 * A pick saves on tap (ADR 0067 wave 2): `saveState` is the card's save in words (model/
 * useSavePicks.js), shown in one polite status region under the teams, and only that region is live
 * (Undo and Retry sit beside it, outside it), so a tap makes one announcement. An open card keeps
 * the region in the DOM, empty at rest, so the first words are announced.
 *
 * The cursor (One Cursor Rule) is a 4px frame on the one card the page passes `cursor` to, Danger
 * when its kickoff is under an hour away; it is a frame on a card, never a button. A failed or
 * refused save draws a 2px Danger edge in its place. Every unlocked card under an hour from kickoff,
 * picked or not, says "Locks in n min" in its kickoff line and in its accessible name.
 */
export default function GameCard({
  view,
  mode = 'straight',
  totalManagers = null,
  slateSize = 0,
  usedBy = {},
  saveState = null,
  hintId,
  cursor = false,
  cursorId,
  scrollMarginTop = 80,
  loading = false,
  onPickWinner,
  onSetConfidence,
  onUndo,
  onRetry,
}) {
  // A keyboard step the confidence flow needs (#1340): a team tapped before its rank is a draft, and
  // the rank select it enables is the next control, so when this card still holds focus it takes
  // focus. The focus move is the announcement; a pick landing from elsewhere never steals focus.
  const cardRef = useRef(null);
  const drafting = saveState?.status === 'draft';
  const wasDrafting = useRef(drafting);
  useEffect(() => {
    const before = wasDrafting.current;
    wasDrafting.current = drafting;
    if (!before && drafting && !view?.lock && cardRef.current?.contains(document.activeElement)) {
      cardRef.current.querySelector('select')?.focus();
    }
  }, [drafting, view?.lock]);

  if (loading) return <GameCardSkeleton />;

  const [awayTeam, homeTeam] = view.teams;
  const matchup = `${awayTeam} at ${homeTeam}`;
  const isFinal = view.phase === 'final';
  const isLive = view.phase === 'live';
  const isOpen = view.phase === 'open';
  const status = saveState?.status || null;
  const edgeDanger = status === 'failed' || status === 'refused';
  const attemptedTeam = ['saving', 'failed', 'draft'].includes(status) ? saveState.attempted?.pickedTeam ?? null : null;
  const kickoffLabel = formatKickoff(view.kickoff);
  const locksWords = view.lockMinutes == null
    ? null
    : view.lockMinutes < 1 ? 'locks in under 1 min' : `locks in ${view.lockMinutes} min`;
  const urgent = locksWords != null;

  const sideProps = (team, isHome) => {
    const score = isHome ? view.homeScore : view.awayScore;
    const record = view.records ? (isHome ? view.records.home : view.records.away) : null;
    const attempt = attemptedTeam === team;
    const won = isFinal && !view.isTie && view.winner === team;
    const lost = isFinal && !view.isTie && view.winner != null && view.winner !== team;
    return {
      team,
      opponent: isHome ? awayTeam : homeTeam,
      kickoff: kickoffLabel,
      locksIn: view.lock ? null : locksWords,
      record,
      favorite: view.favorite === team,
      picked: view.myPick === team,
      attempt,
      state: attempt ? status : view.myPick === team ? status : null,
      won,
      lost,
      disabled: view.lock,
      score: isLive || isFinal ? score : null,
      possession: isLive && view.situation?.possession === team,
      onSelect: (picked) => onPickWinner?.(view.gameKey, picked),
    };
  };

  // The frame: the cursor's 4px (Danger under an hour) or a failed save's 2px Danger edge; an
  // ordinary card keeps the 4px transparent edge so no card shifts when the cursor moves.
  const frameColor = urgent ? 'var(--ps-danger)' : 'var(--ps-cursor)';
  const showCursor = cursor && !edgeDanger;
  let wrapperSx;
  if (edgeDanger) wrapperSx = { padding: '10px', border: '2px solid var(--ps-danger)' };
  else if (showCursor) wrapperSx = { '--cur': frameColor, padding: '8px', border: `4px solid ${frameColor}` };
  else wrapperSx = { padding: '8px', border: '4px solid transparent' };

  const rightOfHead = [];
  if (isFinal) rightOfHead.push(<OutcomeChip key="outcome" outcome={view.outcome} myPick={view.myPick} confidence={view.confidence} />);
  else {
    if (isOpen && view.line) {
      rightOfHead.push(
        <Box
          key="odds"
          component="span"
          data-testid="odds-badge"
          sx={{
            display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box', height: '28px', padding: '0 8px', border: '2px solid var(--ps-rule)', fontSize: '14px', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          }}
        >
          {`${view.favorite ?? ''} ${(-Math.abs(view.line.spread)).toFixed(1)} · O/U ${view.line.total}`}
        </Box>
      );
    }
    if (mode === 'confidence') {
      const needsTeam = !view.lock && view.myPick == null && !drafting;
      rightOfHead.push(
        <ConfidenceMenu
          key="confidence"
          value={view.confidence}
          max={slateSize}
          usedBy={usedBy}
          swappable={view.confidence != null}
          disabled={view.lock || needsTeam}
          bad={status === 'refused' && !view.lock}
          aria-label={`Confidence for ${matchup}`}
          aria-describedby={needsTeam ? hintId : undefined}
          onChange={(value) => onSetConfidence?.(view.gameKey, value)}
        />
      );
    }
  }

  return (
    <Box
      ref={cardRef}
      id={cursor ? cursorId : undefined}
      tabIndex={cursor ? -1 : undefined}
      className={showCursor ? 'cursor slot' : undefined}
      sx={{ boxSizing: 'border-box', scrollMarginTop: `${scrollMarginTop}px`, ...wrapperSx }}
    >
      <Box
        component="article"
        data-testid="game-card"
        data-phase={view.phase}
        data-cursor={cursor || undefined}
        aria-label={`${matchup}${view.lock ? '' : urgent ? `, ${locksWords}` : ''}`}
        sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        {cursor && <Box component="span" sx={SR_ONLY_SX}>Next pick</Box>}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
            <HeaderLead view={view} kickoffLabel={kickoffLabel} locksWords={view.lock ? null : locksWords} />
          </Box>
          {rightOfHead.length > 0 && (
            <Box component="span" sx={{ marginLeft: 'auto', display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '8px 12px' }}>
              {rightOfHead}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: { xs: '8px', sm: '12px' } }}>
          <TeamPickButton {...sideProps(awayTeam, false)} />
          <TeamPickButton {...sideProps(homeTeam, true)} />
        </Box>

        {!view.lock && (
          <SaveLine saveState={saveState} matchup={matchup} onUndo={() => onUndo?.(view.gameKey)} onRetry={() => onRetry?.(view.gameKey)} />
        )}

        <MetaRow view={view} isLive={isLive} />

        {view.lock && status === 'refused' ? (
          <Box
            role="status"
            aria-live="polite"
            data-testid="refused-note"
            sx={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', padding: '4px 0', boxSizing: 'border-box', color: 'var(--ps-danger)', fontSize: '15px', fontWeight: 600 }}
          >
            <PixelWarn color="var(--ps-danger)" />
            {saveState.message}
          </Box>
        ) : isFinal ? (
          view.headline && <HeadlineRow headline={view.headline} />
        ) : isLive ? (
          <LiveFooter view={view} awayTeam={awayTeam} homeTeam={homeTeam} />
        ) : (
          <PreLockFooter pickedCount={view.pickedCount} totalManagers={totalManagers} />
        )}
      </Box>
    </Box>
  );
}

const SUB_SX = { fontSize: '14px', color: 'var(--ps-dim)' };

function LockedTag() {
  return (
    <Box
      component="span"
      data-testid="locked-badge"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '8px', boxSizing: 'border-box', minHeight: '32px', padding: '6px 10px', border: '2px solid var(--ps-rule)', ...pixelSx(16), lineHeight: 1, flex: 'none',
      }}
    >
      <LockIcon />
      Locked
    </Box>
  );
}

// The header's lead: the kickoff line with its lock words before lock, the live clock chip and
// "Locked" while in progress, a neutral "Final" chip once settled. A locked game with no clock yet
// (it kicked off a moment ago, or a save was refused) reads Locked, kickoff and broadcast.
function HeaderLead({ view, kickoffLabel, locksWords }) {
  if (view.phase === 'final') {
    return <Box component="span" data-testid="final-badge" sx={{ display: 'inline-flex' }}><StatusChip>Final</StatusChip></Box>;
  }
  if (view.phase === 'live' && view.quarter) {
    const clock = view.timeRemaining ? `${view.quarter} · ${view.timeRemaining}` : view.quarter;
    return (
      <>
        <Box component="span" data-testid="live-badge" sx={{ display: 'inline-flex' }}><LiveChip>{clock}</LiveChip></Box>
        <LockedTag />
      </>
    );
  }
  return (
    <>
      {view.lock && <LockedTag />}
      {kickoffLabel && <Box component="span" sx={{ ...pixelSx(16), lineHeight: 1.2 }}>{kickoffLabel}</Box>}
      {view.broadcast && <Box component="span" sx={SUB_SX}>{`· ${view.broadcast}`}</Box>}
      {locksWords && (
        <Box component="span" data-testid="locks-in" sx={{ fontSize: '14px', fontWeight: 700, color: 'var(--ps-danger)' }}>
          {`${locksWords.charAt(0).toUpperCase()}${locksWords.slice(1)}`}
        </Box>
      )}
    </>
  );
}

// The settled-game outcome chip: outlined Ink, a result word. "Missed" names the pick and is not red.
function OutcomeChip({ outcome, confidence, myPick }) {
  let text = 'No pick';
  if (outcome === 'correct') text = confidence != null ? `Correct · +${confidence}` : 'Correct';
  else if (outcome === 'missed') text = `Missed · picked ${myPick}`;
  else if (outcome === 'tie') text = 'Tie · no credit';
  return (
    <Box
      component="span"
      data-testid="outcome-badge"
      sx={{
        display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box', height: '32px', padding: '0 10px', border: '2px solid var(--ps-ink)', fontSize: '14px', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', flex: 'none',
      }}
    >
      {text}
    </Box>
  );
}

// The card's save line. The polite status region holds the words only; Undo and Retry sit beside it.
function SaveLine({ saveState, matchup, onUndo, onRetry }) {
  const status = saveState?.status || null;
  const row = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 12px', minHeight: '44px', padding: '4px 0', boxSizing: 'border-box', fontSize: '15px',
  };
  const live = (children, color) => (
    <Box
      component="span"
      role="status"
      aria-live="polite"
      data-testid="save-status"
      sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 12px', color }}
    >
      {children}
    </Box>
  );
  if (!status) return <Box sx={SR_ONLY_SX}>{live('')}</Box>;
  if (status === 'saving') return <Box sx={row}>{live('Saving…', 'var(--ps-dim)')}</Box>;
  if (status === 'draft') return <Box sx={row}>{live('Choose a confidence to save this pick.', 'var(--ps-dim)')}</Box>;
  if (status === 'undone') return <Box sx={row}>{live('Pick undone', 'var(--ps-dim)')}</Box>;
  if (status === 'saved') {
    return (
      <Box sx={row}>
        {live(
          <>
            <PixelCheck size={16} />
            <Box component="span" sx={{ fontWeight: 600 }}>{saveState.swap ? `Swapped with ${saveState.swap}` : 'Pick saved'}</Box>
            {saveState.swap && <Box component="span" sx={{ color: 'var(--ps-dim)' }}>Both ranks saved</Box>}
          </>
        )}
        <Box component="span" aria-hidden="true" sx={{ color: 'var(--ps-dim)' }}>{'·'}</Box>
        <PsButton variant="ghost" onClick={onUndo} ariaLabel={`Undo ${saveState.swap ? 'swap' : 'pick'}, ${matchup}`}>Undo</PsButton>
      </Box>
    );
  }
  // failed (Retry) or refused (no Retry): the alert pictogram and the words, Danger.
  return (
    <Box sx={row}>
      {live(
        <>
          <PixelWarn color="var(--ps-danger)" />
          <span>{saveState.message}</span>
        </>,
        'var(--ps-danger)'
      )}
      {status === 'failed' && (
        <PsButton variant="ghost" onClick={onRetry} ariaLabel={`Retry saving pick, ${matchup}`}>Retry</PsButton>
      )}
    </Box>
  );
}

// Venue/weather before kickoff, Situation while live; nothing once final (the headline replaces it) or
// when the source has nothing for this phase (ADR 0038: "the card renders nothing for an absent field").
function MetaRow({ view, isLive }) {
  if (isLive) {
    if (!view.situation) return null;
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', ...SUB_SX }}>
        {view.situation.downDistance && (
          <Box component="b" sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>{view.situation.downDistance}</Box>
        )}
        {view.situation.possession && <span>{`${view.situation.possession} ball`}</span>}
      </Box>
    );
  }
  if (view.phase === 'final' || view.lock) return null;
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
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', ...SUB_SX }}>
      {venueLabel && <span>{venueLabel}</span>}
      {weatherLabel && <span>{weatherLabel}</span>}
    </Box>
  );
}

// Pre-lock footer: how many managers have picked, and NOTHING else (the reveal promise is once per
// window head). This is the whole of the red-tell surface.
function PreLockFooter({ pickedCount, totalManagers }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 16px', ...SUB_SX }}>
      <span data-testid="picked-count">
        <Box component="b" sx={{ fontWeight: 700, color: 'var(--ps-ink)' }}>{pickedCount}</Box>
        {totalManagers != null ? ` of ${totalManagers} managers have picked` : ' managers have picked'}
      </span>
    </Box>
  );
}

// Live footer: ESPN's win probability as one full-width two-sided bar (no Endzone Forecast credit,
// it is not ours), then the league's reveal tally by team and how many have no pick.
function LiveFooter({ view, awayTeam, homeTeam }) {
  const probability = view.situation?.homeWinProbability;
  return (
    <>
      {probability != null && (
        <TwoSidedOdds
          a={getTeamName(awayTeam)}
          b={getTeamName(homeTeam)}
          aShort={awayTeam}
          bShort={homeTeam}
          pct={(1 - probability) * 100}
          live
          caption="Win probability"
        />
      )}
      {view.reveal && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', ...SUB_SX }}>
          <span data-testid="reveal-counts">
            {'League picks · '}
            <Box component="b" sx={{ fontWeight: 700, color: 'var(--ps-ink)' }}>
              {Object.entries(view.reveal.counts).map(([team, count], index) => (
                <React.Fragment key={team}>
                  {index > 0 ? ', ' : ''}
                  {`${team} ${count}`}
                </React.Fragment>
              ))}
            </Box>
          </span>
          {view.reveal.noPick > 0 && <span>{`${view.reveal.noPick} no pick`}</span>}
        </Box>
      )}
    </>
  );
}

function HeadlineRow({ headline }) {
  return (
    <Box component="p" data-testid="headline" sx={{ m: 0, pt: '10px', borderTop: '2px solid var(--ps-rule)', textWrap: 'pretty', ...SUB_SX }}>
      {headline}
    </Box>
  );
}

function GameCardSkeleton() {
  return (
    <Box sx={{ padding: '8px', border: '4px solid transparent' }}>
      <Box data-testid="game-card-skeleton" sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skel width="120px" height={20} />
          <Skel width="150px" height={28} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
          {[0, 1].map((index) => (
            <Box key={index} sx={{ boxSizing: 'border-box', minHeight: '76px', border: '2px solid var(--ps-rule)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Skel width="64px" height={16} />
              <Skel width="60%" height={14} />
            </Box>
          ))}
        </Box>
        <Skel width="100%" height={12} />
      </Box>
    </Box>
  );
}
