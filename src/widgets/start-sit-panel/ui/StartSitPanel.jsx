import React, { useRef, useState } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, LiveChip, PixelClock, PixelHeading, StatusChip,
} from '../../../shared/ui/playselect';
import {
  CAPTION_SX, Glyph, InjuryCode, PsAction, RangeBand, RuleStat, WordTag,
} from '../../../shared/ui/playselect/LineupParts';
import { PlayerNameLink } from '../../../entities/player';
import { adviceNote } from '../../../entities/roster';
import { formatKickoff, formatPoints, NO_PRACTICE_LABEL, BACKUP_LABEL } from '../../../shared/lib';
import { buildSuggestionView, calledRecordLine, calledShotLine, forecastRecordLine, movePlanWithout, pointsLeftLine, projectedLeanLine } from '../lib/suggestionView';

/**
 * The Start/sit panel widget (#1238, ADR 0037 AC1): the rail's advice panel,
 * showing the engine's per-slot sit/start suggestions with each side's
 * projection, Floor and Ceiling on a shared range band, a lean or too-close-
 * to-call verdict, the opponent context, and both kickoffs with the decide-by
 * time. Hidden outright in best ball (AC1: "standard leagues only; hidden in
 * best ball") - a best-ball league never calls the advice endpoint at all
 * (`entities/roster`'s `useAdvice`), so this widget's own job is
 * simply never to render when `bestBall` is true.
 *
 * Reads only `entities` and `shared` (ADR 0020/0029): `advice` and `entries`
 * both arrive as plain props the page already fetched (`useAdvice`,
 * `useLineupData`) - the same "value two widgets both need is passed down
 * by the page" rule the Ledger and the summary strip already follow. The
 * Apply action itself is the page's one lineup write (`submit`), reached only
 * through the `onApply` callback (ADR 0020: a widget never imports a
 * feature) - Dismiss (session-only, local state) is the only interaction this
 * widget owns outright. `onApply` receives the lineup write's own moves
 * (`[{ playerId, slot }]`, see `movePlanWithout`), ready for `submit`.
 * Compare renders only when the page passes `onCompare`; the Lineup page
 * wires it to the Decision card (#2263).
 *
 * Three more things ride in as plain props (#1852): each player carries the
 * shared injury tag from his designation; his name opens the Decision card
 * through `onOpenDecisionCard(playerId)` (the page owns the card, the same
 * callback a Ledger row's name calls); and `expectedFinals` ({ mine, theirs },
 * the two teams' Expected finals for the Matchup, read by the page) drives one
 * line at the top of the card when the gap is 10 points or more. The line
 * names no player and changes no suggestion.
 *
 * A called shot (#1856) rides in the same way: each Lean row gets a "Call your
 * shot" action beside Dismiss through `onCallShot(view)`, and the advice
 * payload's `calledShot` renders the standing "Your called shot" line (pair,
 * numbers as called, status, and Withdraw through `onWithdrawShot()` while the
 * payload allows it).
 *
 * Heading stays "Endzone Forecast" (CONTEXT.md's Endzone Forecast: "the name
 * the product gives its projection engine ... what managers see on the
 * advice surfaces"); no copy here ever reads "optimal", "optimize" or
 * "range" (AC6).
 *
 * Play-select (ADR 0067 wave 3, spec #2347 ruling 4): a tertiary frame. The suggestion card has no title
 * row of its own: its head is the slot, the verdict, "about {n}%" and "+{gain} pts". The two-move sentence
 * (`adviceNote`, over the suggestions still showing and the advice's `openSlotFills`) appears once, as the
 * plan line above Apply, and Apply is the page's one filled action. With no move to make, the empty state
 * reads "No move from your bench" when a starting slot is open (`openSlot`, the page's `nextLineupSlot`) and
 * "Lineup set" when nothing is.
 */
export default function StartSitPanel({
  advice, entries, bestBall, onApply, onCompare, onOpenDecisionCard, expectedFinals, onCallShot, onWithdrawShot, shotBusy, openSlot = false,
}) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  // The panel's own content container (formal risk review finding: Dismiss
  // destroyed its own focus anchor with nothing to replace it, dropping
  // focus all the way to `<body>`) - a `tabIndex={-1}` node a script can
  // always focus even though it never enters the Tab order itself, the same
  // pattern a route change or a closed dialog uses to hand focus somewhere
  // stable. `dismissButtonRefs` keys a live DOM node per suggestion so a
  // dismiss can hand focus to the NEXT remaining card's own Dismiss button
  // (or the previous one, dismissing the last card) instead.
  const contentRef = useRef(null);
  const dismissButtonRefs = useRef(new Map());

  if (bestBall) return null;

  const entriesById = new Map((Array.isArray(entries) ? entries : []).map((e) => [e.playerId, e]));
  const suggestions = Array.isArray(advice?.suggestions) ? advice.suggestions : [];
  const allViews = suggestions.map((s) => buildSuggestionView(s, entriesById));
  const views = allViews.filter((v) => !dismissed.has(v.key));
  // Apply makes the moves of the suggestions still showing and nothing else
  // (#1851): the advice's movePlan comes from the server's optimal assignment,
  // so the dismissed pairs' moves are taken out of it here.
  const movePlan = movePlanWithout(advice?.movePlan, allViews.filter((v) => dismissed.has(v.key)));
  const canApply = movePlan.length > 0;
  // The plan line names the moves Apply will make: the suggestions still showing, and the open-slot fills.
  const planLine = canApply
    ? adviceNote({ suggestions: suggestions.filter((s, i) => !dismissed.has(allViews[i].key)), openSlotFills: advice?.openSlotFills })
    : null;
  const leanLine = projectedLeanLine(expectedFinals);
  // The standing "Your called shot" line reads the advice payload (#1856): the
  // server pins the shot's pair, so it never appears as a row above and the
  // panel adds no client-side filter for it (Dismiss's movePlanWithout is
  // per-mount UI state only).
  const shotLine = calledShotLine(advice?.calledShot, entriesById);
  const benchLine = pointsLeftLine(advice?.pointsLeft);
  const forecastLine = forecastRecordLine(advice?.overrideRecord);
  const calledRecord = calledRecordLine(advice?.calledShotRecord);
  const stats = [
    ['points-left-line', benchLine],
    ['forecast-record-line', forecastLine],
    ['called-record-line', calledRecord],
  ].filter(([, line]) => line);

  // Focus moves BEFORE the state update commits, while every sibling card
  // (and its Dismiss button) is still mounted in this same synchronous
  // handler, to whichever button now sits where the dismissed card was; the
  // container itself is the fallback once no suggestion remains. A polite
  // status announces what happened, since removing the card is otherwise a
  // silent DOM change to a screen-reader user.
  const dismiss = (view) => {
    const index = views.findIndex((v) => v.key === view.key);
    const remaining = views.filter((v) => v.key !== view.key);
    const target = remaining[index] ?? remaining[index - 1] ?? null;
    const node = target ? dismissButtonRefs.current.get(target.key) : null;
    (node || contentRef.current)?.focus();
    setAnnouncement(`${view.sit.name} over ${view.start.name} suggestion dismissed`);
    setDismissed((prev) => new Set(prev).add(view.key));
  };

  // The shot actions stay mounted while a request is in flight (aria-disabled,
  // not removed) so the button the manager just pressed keeps focus; once the
  // server accepts, focus goes to the card's own container and a polite status
  // says what happened, since the row or the Withdraw button then leaves the
  // DOM silently (the same hand-off Dismiss makes above).
  const callShot = async (view) => {
    if (shotBusy) return;
    const accepted = await onCallShot?.(view);
    if (accepted === false) return;
    contentRef.current?.focus();
    setAnnouncement(`Shot called: ${view.sit.name} over ${view.start.name}`);
  };
  const withdrawShot = async () => {
    if (shotBusy) return;
    const accepted = await onWithdrawShot?.();
    if (accepted === false) return;
    contentRef.current?.focus();
    setAnnouncement('Called shot withdrawn');
  };

  return (
    <Frame
      tier="rule"
      labelledBy="start-sit-h"
      data-testid="start-sit-panel"
      head={<FrameHead><PixelHeading id="start-sit-h" size={16}>Endzone Forecast</PixelHeading></FrameHead>}
    >
      <Box
        ref={contentRef}
        tabIndex={-1}
        data-testid="start-sit-panel-content"
        sx={{ p: { xs: '14px', md: '12px' }, display: 'flex', flexDirection: 'column', gap: '14px', outline: 'none' }}
      >
        {/* Text only: the polite live region never holds a button. */}
        <Box component="span" role="status" aria-live="polite" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>{announcement}</Box>

        {leanLine && (
          <Box component="p" data-testid="start-sit-lean-line" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>
            {leanLine}
          </Box>
        )}

        {stats.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {stats.map(([testId, line]) => {
              const cut = line.indexOf(': ');
              return <RuleStat key={testId} data-testid={testId} label={line.slice(0, cut)} value={line.slice(cut + 2)} />;
            })}
          </Box>
        )}

        {shotLine && (
          <Box
            data-testid="called-shot-line"
            data-state={shotLine.state}
            role="group"
            aria-label="Your called shot"
            sx={{ border: '2px solid var(--ps-rule)', p: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', boxSizing: 'border-box' }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <Box component="span" sx={CAPTION_SX}>Your called shot</Box>
              <Box component="span" sx={{ ml: 'auto' }}><ShotChip state={shotLine.state} status={shotLine.status} /></Box>
            </Box>
            <Box data-testid="called-shot-pair" sx={{ fontSize: '15px', fontWeight: 600 }}>{shotLine.text}</Box>
            <Box data-testid="called-shot-numbers" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{shotLine.numbers}</Box>
            <Box data-testid="called-shot-status" sx={{ fontSize: '14px' }}>{shotLine.status}</Box>
            {shotLine.canWithdraw && onWithdrawShot && (
              <Box>
                <PsAction
                  data-testid="called-shot-withdraw"
                  aria-label={`Withdraw your called shot: ${shotLine.text}`}
                  aria-disabled={shotBusy || undefined}
                  onClick={withdrawShot}
                >
                  Withdraw
                </PsAction>
              </Box>
            )}
          </Box>
        )}

        {views.length === 0 && (
          <Box component="p" sx={{ m: 0, fontSize: '15px', color: 'var(--ps-dim)' }} data-testid="start-sit-panel-empty">
            {openSlot ? 'No move from your bench' : 'Lineup set'}
          </Box>
        )}

        {views.map((view) => (
          <Box
            key={view.key}
            data-testid="suggestion-card"
            sx={{ border: '2px solid var(--ps-ink)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', minWidth: 0 }}
          >
            <Box sx={{ display: 'flex', flexWrap: { xs: 'wrap', md: 'nowrap' }, alignItems: 'center', gap: '6px 8px', p: '10px 12px', borderBottom: '2px solid var(--ps-rule)' }}>
              <Box
                component="span"
                sx={{
                  display: 'inline-flex', alignItems: 'center', height: '24px', p: '0 6px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)', fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', lineHeight: 1, flex: 'none',
                }}
              >
                {view.slot}
              </Box>
              <Box
                component="span"
                data-testid="suggestion-verdict"
                data-verdict={VERDICT[view.verdict]?.attr ?? 'lean'}
                sx={{ fontFamily: "'Press Start 2P', ui-monospace, monospace", fontSize: '16px', lineHeight: 1.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}
              >
                {VERDICT[view.verdict]?.text ?? 'Lean start'}
              </Box>
              <Box component="span" sx={{ ml: 'auto', fontSize: '13px', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>
                {view.probabilityLabel && <span data-testid="suggestion-probability">{view.probabilityLabel}</span>}
                {view.probabilityLabel && view.gain != null && ' · '}
                {view.gain != null && `+${formatPoints(view.gain)} pts`}
              </Box>
            </Box>

            {/* Column gap only: the subgrid rows carry their own 4px rowGap, and a parent row gap would leave
                blank tracks (no chips, no kickoff) 10px tall. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 24px', p: '12px' }}>
              <PlayerColumn label="Sit" player={view.sit} domainMin={view.domainMin} domainMax={view.domainMax} onOpenDecisionCard={onOpenDecisionCard} />
              <PlayerColumn label="Start" player={view.start} domainMin={view.domainMin} domainMax={view.domainMax} onOpenDecisionCard={onOpenDecisionCard} />
            </Box>

            {/* One joined text node, not two sibling spans (formal risk review finding: two adjacent spans
                with only a flex `gap` between them concatenate with no separator in the accessible text,
                "...RB)vs NYJ..."). */}
            <Box data-testid="suggestion-opponent-context" sx={{ fontSize: '13px', color: 'var(--ps-dim)', px: '12px', pb: '10px' }}>
              {[view.sit.opponentContext, view.start.opponentContext].filter(Boolean).join(' · ')}
            </Box>

            {view.decideBy && (
              <Box data-testid="suggestion-decide-by" sx={{ display: 'flex', alignItems: 'center', gap: '8px', p: '10px 12px', borderTop: '2px solid var(--ps-rule)', fontSize: '14px', fontWeight: 600 }}>
                <PixelClock />
                {`Decide by ${formatKickoff(view.decideBy)}`}
              </Box>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', p: '0 12px 12px' }}>
              {onCompare && (
                <PsAction
                  data-testid="suggestion-compare"
                  aria-label={`Compare ${view.start.name} with ${view.sit.name}`}
                  onClick={() => onCompare(view)}
                >
                  Compare
                </PsAction>
              )}
              <PsAction
                data-testid="suggestion-dismiss"
                ref={(node) => {
                  if (node) dismissButtonRefs.current.set(view.key, node);
                  else dismissButtonRefs.current.delete(view.key);
                }}
                onClick={() => dismiss(view)}
              >
                Dismiss
              </PsAction>
              {view.canCallShot && onCallShot && (
                <PsAction
                  data-testid="suggestion-call-shot"
                  aria-label={`Call your shot: keep ${view.sit.name} over ${view.start.name}`}
                  aria-disabled={shotBusy || undefined}
                  onClick={() => callShot(view)}
                >
                  Call your shot
                </PsAction>
              )}
            </Box>
          </Box>
        ))}

        {canApply && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
            {planLine && (
              <Box component="p" data-testid="start-sit-plan-line" sx={{ m: 0, fontSize: '15px', fontWeight: 600, textWrap: 'pretty' }}>
                {glueDots(planLine)}
              </Box>
            )}
            <PsAction variant="fill" data-testid="start-sit-apply" onClick={() => onApply?.(movePlan)}>
              Apply
            </PsAction>
          </Box>
        )}
      </Box>
    </Frame>
  );
}

// A separator stays with the word before it, so a line may end with the dot and never start with one.
function glueDots(text) {
  const parts = String(text).split(' · ');
  return parts.map((part, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <React.Fragment key={i}>
      {i < parts.length - 1 ? <span style={{ whiteSpace: 'nowrap' }}>{`${part} ·`}</span> : part}
      {i < parts.length - 1 ? ' ' : null}
    </React.Fragment>
  ));
}

const VERDICT = {
  strong: { text: 'Strong start', attr: 'strong' },
  start: { text: 'Lean start', attr: 'lean' },
  tossup: { text: 'Too close to call', attr: 'tossup' },
};

// The called shot's state as a chip: Live is the one green, Locked carries the lock, Hit, Miss and Void are
// outlined chips (RULINGS "Wave 3 boards"); an open shot has none.
function ShotChip({ state, status }) {
  // Both games on: the payload says Live in the status sentence while the state stays locked.
  if (state === 'locked' && /^Live/.test(status)) return <LiveChip>Live</LiveChip>;
  if (state === 'locked') {
    return <StatusChip><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><Glyph kind="lock" />Locked</Box></StatusChip>;
  }
  if (state === 'resolved-hit') return <StatusChip>Hit</StatusChip>;
  if (state === 'resolved-miss') return <StatusChip>Miss</StatusChip>;
  if (state === 'resolved-void') return <StatusChip>Void</StatusChip>;
  return null;
}

const NAME_SX = {
  fontSize: '15px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const FIGURE_LABEL_SX = { fontSize: '13px', color: 'var(--ps-dim)', lineHeight: 1.3 };

function PlayerColumn({ label, player, domainMin, domainMax, onOpenDecisionCard }) {
  return (
    // The two columns share the parent grid's row tracks via subgrid, so the Sit and Start rows line up
    // (#2099). Without it the shorter column stretched to the taller one and spread the slack across its own
    // rows; `alignContent: 'start'` is the fallback where subgrid is unsupported. span 6 = label, name row,
    // band, figures, kickoff, fact chips.
    <Box data-testid="suggestion-player" sx={{ display: 'grid', gridTemplateRows: 'subgrid', gridRow: 'span 6', rowGap: '4px', alignContent: 'start', minWidth: 0 }}>
      <Box component="span" sx={CAPTION_SX}>{label}</Box>
      {/* alignSelf start: when the other side's name row wraps, the shared track grows; centring would drop
          this side's single line down inside it. */}
      <Box sx={{ display: 'flex', alignItems: 'center', alignSelf: 'start', gap: '4px 8px', minWidth: 0, flexWrap: 'wrap' }}>
        {onOpenDecisionCard ? (
          <PlayerNameLink
            name={player.name}
            playerId={player.playerId}
            onOpen={onOpenDecisionCard}
            sx={{
              ...NAME_SX,
              minWidth: 0,
              minHeight: '44px',
              m: '-8px 0',
              p: 0,
              color: 'var(--ps-ink)',
              display: 'block',
              lineHeight: '44px',
              '&:focus-visible, &.MuiLink-focusVisible': {
                outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)', borderRadius: 0,
              },
            }}
          />
        ) : (
          <Box component="span" sx={NAME_SX}>{player.name}</Box>
        )}
        <InjuryCode status={player.injuryStatus} data-testid="injury-tag" />
        {player.noPractice && <WordTag data-testid="suggestion-no-practice">{NO_PRACTICE_LABEL}</WordTag>}
        {player.backup && <WordTag data-testid="suggestion-backup">{BACKUP_LABEL}</WordTag>}
        {player.volatility && <WordTag data-testid="suggestion-volatility">{player.volatility}</WordTag>}
      </Box>
      <Box sx={{ pt: '4px' }}>
        <RangeBand
          label={player.name}
          floor={player.floor}
          projection={player.projection}
          ceiling={player.ceiling}
          min={domainMin}
          max={domainMax}
          data-testid="suggestion-range-bar"
        />
      </Box>
      <Box aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', ...FIGURE_LABEL_SX }}>
        <Figure label="Floor" value={player.floor} align="left" />
        <Figure label="Proj" value={player.projection} align="center" />
        <Figure label="Ceiling" value={player.ceiling} align="right" />
      </Box>
      {player.kickoff && <Box sx={FIGURE_LABEL_SX}>{formatKickoff(player.kickoff)}</Box>}
      {player.factChips.length > 0 && (
        <Box sx={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {player.factChips.map((chip) => (
            <Box
              key={chip.key}
              component="span"
              data-testid="suggestion-fact-chip"
              data-chip={chip.key}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minHeight: '24px', boxSizing: 'border-box', p: '0 6px', border: '2px solid var(--ps-rule)', fontSize: '13px', fontWeight: 700 }}
            >
              {chip.text}
              {chip.contextOnly && <>{' '}<Box component="span" sx={{ fontWeight: 400, color: 'var(--ps-dim)' }}>context only</Box></>}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// One figure under the band: its Dim label over a 14px 600 value.
function Figure({ label, value, align }) {
  return (
    <Box component="span" sx={{ textAlign: align }}>
      {label}
      <br />
      <Box component="b" sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--ps-ink)' }}>{formatPoints(value)}</Box>
    </Box>
  );
}
