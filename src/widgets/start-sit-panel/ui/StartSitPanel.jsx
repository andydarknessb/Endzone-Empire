import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { Badge, Card, DashButton, RangeBar } from '../../../shared/ui';
import { formatKickoff, formatPoints } from '../../../shared/lib';
import { buildSuggestionView } from '../lib/suggestionView';

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
 * Heading stays "Endzone Forecast" (CONTEXT.md's Endzone Forecast: "the name
 * the product gives its projection engine ... what managers see on the
 * advice surfaces"); no copy here ever reads "optimal", "optimize" or
 * "range" (AC6).
 */
export default function StartSitPanel({ advice, entries, bestBall, onApply, onCompare }) {
  const [dismissed, setDismissed] = useState(() => new Set());

  if (bestBall) return null;

  const entriesById = new Map((Array.isArray(entries) ? entries : []).map((e) => [e.playerId, e]));
  const suggestions = Array.isArray(advice?.suggestions) ? advice.suggestions : [];
  const views = suggestions.map((s) => buildSuggestionView(s, entriesById)).filter((v) => !dismissed.has(v.key));
  const movePlan = Array.isArray(advice?.movePlan) ? advice.movePlan : [];
  const canApply = movePlan.length > 0;

  const dismiss = (key) => setDismissed((prev) => new Set(prev).add(key));

  return (
    <Card title="Endzone Forecast" data-testid="start-sit-panel">
      <Box sx={{ p: '14px', display: 'grid', gap: '14px' }}>
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
              <PlayerColumn label="Sit" player={view.sit} domainMin={view.domainMin} domainMax={view.domainMax} />
              <PlayerColumn label="Start" player={view.start} domainMin={view.domainMin} domainMax={view.domainMax} />
            </Box>

            <Box data-testid="suggestion-opponent-context" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', fontSize: '12px', color: 'var(--dash-faint)' }}>
              {view.sit.opponentContext && <span>{view.sit.opponentContext}</span>}
              {view.start.opponentContext && <span>{view.start.opponentContext}</span>}
            </Box>

            {view.decideBy && (
              <Typography data-testid="suggestion-decide-by" sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}>
                {`Decide by ${formatKickoff(view.decideBy)}`}
              </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 1 }}>
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
                onClick={() => dismiss(view.key)}
              >
                Dismiss
              </DashButton>
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

function PlayerColumn({ label, player, domainMin, domainMax }) {
  return (
    <Box sx={{ display: 'grid', gap: '4px', minWidth: 0 }}>
      <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--dash-faint)', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.name}
      </Typography>
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
    </Box>
  );
}
