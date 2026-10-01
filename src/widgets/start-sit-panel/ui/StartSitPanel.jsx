import React, { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, DashButton, InjuryTag, RangeBar } from '../../../shared/ui';
import { PlayerNameLink } from '../../../entities/player';
import { formatKickoff, formatPoints } from '../../../shared/lib';
import { buildSuggestionView, calledShotLine, movePlanWithout, projectedLeanLine } from '../lib/suggestionView';

/**
 * The Start/sit panel widget (#1238, ADR 0037 AC1): the rail's advice panel,
 * showing the engine's per-slot sit/start suggestions with each side's
 * projection, Floor and Ceiling on a shared RangeBar, a lean or too-close-
 * to-call chip, the opponent context, and both kickoffs with the decide-by
 * time. Hidden outright in best ball (AC1: "standard leagues only; hidden in
 * best ball") - a best-ball league never calls the advice endpoint at all
 * (`../../pages/lineup/model/useAdvice.js`), so this widget's own job is
 * simply never to render when `bestBall` is true.
 *
 * Reads only `entities` and `shared` (ADR 0020/0029): `advice` and `entries`
 * both arrive as plain props the page already fetched (`useAdvice`,
 * `useLineupData`) - the same "value two widgets both need is passed down
 * by the page" rule the Ledger and the summary strip already follow. The
 * Apply action itself is the page's own apply-advice feature, reached only
 * through the `onApply` callback (ADR 0020: a widget never imports a
 * feature) - Dismiss (session-only, local state) and Compare (a no-op
 * affordance until ticket 8, AC3) are the only interactions this widget
 * owns outright.
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
 */
export default function StartSitPanel({
  advice, entries, bestBall, onApply, onCompare, onOpenDecisionCard, expectedFinals, onCallShot, onWithdrawShot, shotBusy,
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
  const leanLine = projectedLeanLine(expectedFinals);
  // The standing "Your called shot" line reads the advice payload (#1856): the
  // server pins the shot's pair, so it never appears as a row above and the
  // panel adds no client-side filter for it (Dismiss's movePlanWithout is
  // per-mount UI state only).
  const shotLine = calledShotLine(advice?.calledShot);

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
    <Card title="Endzone Forecast" data-testid="start-sit-panel">
      <Box
        ref={contentRef}
        tabIndex={-1}
        data-testid="start-sit-panel-content"
        sx={{ p: '14px', display: 'grid', gap: '14px', outline: 'none' }}
      >
        <span role="status" aria-live="polite" style={visuallyHidden}>{announcement}</span>

        {leanLine && (
          <Typography data-testid="start-sit-lean-line" sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)' }}>
            {leanLine}
          </Typography>
        )}

        {shotLine && (
          <Box
            data-testid="called-shot-line"
            data-state={shotLine.state}
            role="group"
            aria-label="Your called shot"
            sx={{ p: '10px 12px', border: '1px solid var(--dash-line)', borderRadius: 'var(--dash-radius-sm)', display: 'grid', gap: '2px' }}
          >
            <Typography sx={{ fontSize: '11px', fontWeight: 700, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
              Your called shot
            </Typography>
            <Typography data-testid="called-shot-pair" sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)' }}>
              {shotLine.text}
            </Typography>
            <Typography data-testid="called-shot-numbers" sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}>
              {shotLine.numbers}
            </Typography>
            <Typography data-testid="called-shot-status" sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}>
              {shotLine.status}
            </Typography>
            {shotLine.canWithdraw && onWithdrawShot && (
              <Box>
                <DashButton
                  variant="ghost"
                  size="sm"
                  data-testid="called-shot-withdraw"
                  aria-label={`Withdraw your called shot: ${shotLine.text}`}
                  aria-disabled={shotBusy || undefined}
                  onClick={withdrawShot}
                >
                  Withdraw
                </DashButton>
              </Box>
            )}
          </Box>
        )}

        {views.length === 0 && (
          <Typography sx={{ fontSize: '13px', color: 'var(--dash-faint)' }} data-testid="start-sit-panel-empty">
            Lineup set
          </Typography>
        )}

        {views.map((view) => (
          <Box
            key={view.key}
            data-testid="suggestion-card"
            sx={{ p: '12px', border: '1px solid var(--dash-line)', borderRadius: 'var(--dash-radius-sm)', display: 'grid', gap: '8px' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 700, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
                {view.slot}
              </Typography>
              <Badge
                variant={view.tooCloseToCall ? 'warning' : 'live'}
                data-testid="suggestion-verdict"
                data-verdict={view.tooCloseToCall ? 'tossup' : 'lean'}
              >
                {view.tooCloseToCall ? 'Too close to call' : 'Lean start'}
              </Badge>
              {view.gain != null && (
                <Typography sx={{ ml: 'auto', fontSize: '12px', color: 'var(--dash-faint)' }}>
                  {`+${formatPoints(view.gain)} pts`}
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <PlayerColumn label="Sit" player={view.sit} domainMin={view.domainMin} domainMax={view.domainMax} onOpenDecisionCard={onOpenDecisionCard} />
              <PlayerColumn label="Start" player={view.start} domainMin={view.domainMin} domainMax={view.domainMax} onOpenDecisionCard={onOpenDecisionCard} />
            </Box>

            {/* One joined text node, not two sibling spans (formal risk
                review finding: two adjacent spans with only a flex `gap`
                between them concatenate with no separator in the
                accessible text, "...RB)vs NYJ..."). */}
            <Typography
              data-testid="suggestion-opponent-context"
              sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
            >
              {[view.sit.opponentContext, view.start.opponentContext].filter(Boolean).join(' · ')}
            </Typography>

            {view.decideBy && (
              <Typography data-testid="suggestion-decide-by" sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}>
                {`Decide by ${formatKickoff(view.decideBy)}`}
              </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <DashButton
                variant="ghost"
                size="sm"
                data-testid="suggestion-compare"
                onClick={() => onCompare?.(view)}
              >
                Compare
              </DashButton>
              <DashButton
                variant="ghost"
                size="sm"
                data-testid="suggestion-dismiss"
                ref={(node) => {
                  if (node) dismissButtonRefs.current.set(view.key, node);
                  else dismissButtonRefs.current.delete(view.key);
                }}
                onClick={() => dismiss(view)}
              >
                Dismiss
              </DashButton>
              {view.canCallShot && onCallShot && (
                <DashButton
                  variant="ghost"
                  size="sm"
                  data-testid="suggestion-call-shot"
                  aria-label={`Call your shot: keep ${view.sit.name} over ${view.start.name}`}
                  aria-disabled={shotBusy || undefined}
                  onClick={() => callShot(view)}
                >
                  Call your shot
                </DashButton>
              )}
            </Box>
          </Box>
        ))}

        {canApply && (
          <DashButton variant="primary" size="sm" data-testid="start-sit-apply" onClick={() => onApply?.(movePlan)}>
            Apply
          </DashButton>
        )}
      </Box>
    </Card>
  );
}

const NAME_SX = { fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function PlayerColumn({ label, player, domainMin, domainMax, onOpenDecisionCard }) {
  return (
    <Box data-testid="suggestion-player" sx={{ display: 'grid', gap: '4px', minWidth: 0 }}>
      <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        {onOpenDecisionCard ? (
          <PlayerNameLink name={player.name} playerId={player.playerId} onOpen={onOpenDecisionCard} sx={{ ...NAME_SX, minWidth: 0, display: 'block', lineHeight: 'inherit' }} />
        ) : (
          <Typography sx={NAME_SX}>{player.name}</Typography>
        )}
        <InjuryTag status={player.injuryStatus} />
      </Box>
      <RangeBar
        label={player.name}
        floor={player.floor}
        projection={player.projection}
        ceiling={player.ceiling}
        min={domainMin}
        max={domainMax}
        data-testid="suggestion-range-bar"
      />
      <Typography sx={{ fontSize: '11px', color: 'var(--dash-faint)' }}>
        {`Floor ${formatPoints(player.floor)} · Proj ${formatPoints(player.projection)} · Ceiling ${formatPoints(player.ceiling)}`}
      </Typography>
      {player.kickoff && (
        <Typography sx={{ fontSize: '11px', color: 'var(--dash-faint)' }}>{formatKickoff(player.kickoff)}</Typography>
      )}
      {player.factChips.length > 0 && (
        <Box sx={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {player.factChips.map((chip) => (
            <Badge key={chip.key} variant="neutral" data-testid="suggestion-fact-chip" data-chip={chip.key}>
              {chip.text}
              {chip.contextOnly && <Box component="span" sx={{ ml: '4px', fontWeight: 400 }}>context only</Box>}
            </Badge>
          ))}
        </Box>
      )}
    </Box>
  );
}
