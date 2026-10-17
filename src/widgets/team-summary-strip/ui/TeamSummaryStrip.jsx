import React from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelHeading, PixelWarn, Skel,
} from '../../../shared/ui/playselect';
import { CAPTION_SX } from '../../../shared/ui/playselect/LineupParts';
import { formatPoints, startVerdictReason } from '../../../shared/lib';
import { isQuestionable } from '../../../entities/roster';
import { useTeamSummaryStrip } from '../model/useTeamSummaryStrip';

/**
 * The Lineup page's summary strip (#1237 AC4, #1238 AC4): live score against
 * projected total, the opponent's, starters yet to play and locked, win
 * probability, and the Start/sit advice tile.
 *
 * The advice tile (#1238) reads the page's own `advice` prop (`useAdvice`,
 * the same read the start-sit-panel widget and the apply-advice feature
 * consume - ADR 0029's "value two widgets both need is passed down by the
 * page") rather than fetching it itself: best ball never calls the advice
 * endpoint at all, so `advice` degrades to the empty shape
 * (`{ suggestions: [], movePlan: [] }`) there and the tile reads "Lineup
 * set" the same as a standard league with no suggestion, which is the
 * correct answer for a league that sets its own lineup automatically. With
 * no move to make and a starting slot still open (`openSlot`, the page's own
 * `nextLineupSlot`: empty or holding an Out starter whose game has not
 * started) it reads "No bench move" instead: "Lineup set" would say the open
 * slot was fine (spec #2347 ruling 4). The tile's "swap count" is the swap
 * suggestions plus the open-slot fills (`advice.openSlotFills`): the moves the
 * plan line above Apply names, so "+23.0 pts · 2 swaps" and "Two moves" agree. It is
 * still not the movePlan's own internal move count (which also counts a solo
 * bench demotion with no replacement).
 *
 * The attention chips (#1239 shipped the Bye cluster chip; #1330 adds the
 * other two the parent spec #1232 user story 19 names: "attention chips for
 * a questionable starter, a starter on bye and a Bye cluster"). The
 * questionable and on-bye chips are computed HERE from `lineup.entries`
 * (`entities/roster`'s `isQuestionable`, ADR 0029: a widget reads an
 * entity's public surface) - one per starter (a non-BENCH, non-IR slot,
 * never spent, mirroring `useTeamSummaryStrip`'s own `starters`) whose
 * designation is questionable-class, and one per starter whose game this
 * week is a bye (`onBye` or a `bye` Start verdict). Best ball
 * (`bestBall` prop, the page's `league.best_ball`) suppresses the on-bye
 * chip only - the lineup sets itself, so "on bye" tells a best-ball manager
 * nothing actionable, but an injury still might. The row (and both new
 * chips) is absent entirely on a past week (`lineup.week < lineup.
 * currentWeek`), the same rule the Bye cluster chip already follows one
 * level up in `LineupPage.jsx`.
 *
 * `worstByeCluster` is the page's own read
 * (`shared/lib`'s `computeByeClusters`/`worstByeCluster` - promoted there,
 * not kept below the island, since a second island slice, the bye-cluster
 * widget, reaches it too, ADR 0031), passed down because this widget has no
 * other way to reach the bye-cluster widget's own internals (ADR 0020/0029:
 * "a widget may not import another widget's"). The chip only shows at the
 * warning threshold (three or more byes), not at two (CONTEXT.md's Bye
 * cluster: two is merely notable).
 *
 * `scoreEvent` (#1241 AC2): the page's own live-scores read (`useLiveScores`),
 * passed straight through to `useTeamSummaryStrip` so the strip's live
 * totals move with the same scores socket the Ledger's points cell does.
 *
 * Play-select (ADR 0067 wave 3): a tertiary frame of figures on `ps-*` tokens. The attention chips are
 * outlined Ink tags (the Bye cluster one carries the warning pictogram), never red or amber.
 */
export default function TeamSummaryStrip({
  leagueId, week, viewerTeamId, lineup, advice, worstByeCluster, scoreEvent, bestBall, openSlot = false,
}) {
  const { status, viewer, opponent, winProbability, lockedStarters, totalStarters } = useTeamSummaryStrip({
    leagueId,
    week,
    viewerTeamId,
    lineup,
    scoreEvent,
  });

  // The moves the plan makes: each swap suggestion, and each bench player it starts in an empty slot.
  const suggestionCount = (Array.isArray(advice?.suggestions) ? advice.suggestions.length : 0)
    + (Array.isArray(advice?.openSlotFills) ? advice.openSlotFills.length : 0);
  const gain =
    advice?.optimalTotal != null && advice?.projectedTotal != null
      ? advice.optimalTotal - advice.projectedTotal
      : null;
  const adviceValue =
    suggestionCount > 0
      ? `+${formatPoints(gain)} pts · ${suggestionCount} swap${suggestionCount === 1 ? '' : 's'}`
      : openSlot ? 'No bench move' : 'Lineup set';

  // AC4: the worst bye cluster earns its own attention chip only at the
  // warning threshold (three or more) - a notable cluster of two stays the
  // grid's own concern (CONTEXT.md's Bye cluster: "two is worth noticing,
  // three or more is a warning").
  const byeClusterAttention =
    worstByeCluster != null && worstByeCluster.count >= 3
      ? `Wk ${worstByeCluster.week} · ${worstByeCluster.count} byes`
      : null;

  // #1330: a past week is a settled record, never an outlook - the same rule
  // LineupPage.jsx already applies for the Bye cluster grid/chip, re-derived
  // here since this widget's own questionable/on-bye chips read `lineup`
  // directly rather than a page-computed flag.
  const isPastWeek = Boolean(lineup && lineup.week != null && lineup.currentWeek != null && lineup.week < lineup.currentWeek);

  // Starters (non-BENCH, non-IR, never spent - the same definition
  // `useTeamSummaryStrip` already applies for lockedStarters/totalStarters
  // above), the population both new chip kinds are drawn from.
  const starters = !isPastWeek && Array.isArray(lineup?.entries)
    ? lineup.entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR' && !e.spent)
    : [];

  const questionableChips = starters.filter(isQuestionable).map((e) => ({
    key: `questionable-${e.playerId}`,
    testId: `attention-chip-questionable-${e.playerId}`,
    label: `${lastNameOf(e.name)} ${e.injuryStatus}${e.injuryDetail ? ` · ${truncateDetail(e.injuryDetail)}` : ''}`,
  }));

  // Best ball leagues show the injury chips but never the on-bye chip - the
  // lineup sets itself, so "on bye" names nothing a best-ball manager can act
  // on, but an injury still might.
  const byeChips = bestBall
    ? []
    : starters
        .filter((e) => e.onBye || startVerdictReason(e) === 'bye')
        .map((e) => ({
          key: `bye-${e.playerId}`,
          testId: `attention-chip-bye-${e.playerId}`,
          label: `${lastNameOf(e.name)} on bye`,
        }));

  // The whole row - the Bye cluster chip included - is absent entirely on a
  // past week (a settled record, never an outlook), not only the two new
  // chip kinds: a `worstByeCluster` prop computed before the week changed
  // (or a caller that has not yet re-derived it) must never survive into a
  // past week's render here.
  const hasAttentionRow = !isPastWeek && (questionableChips.length > 0 || byeChips.length > 0 || byeClusterAttention != null);

  return (
    <Frame
      tier="rule"
      labelledBy="team-summary-h"
      data-testid="team-summary-strip"
      aria-busy={status === 'loading'}
      head={<FrameHead><PixelHeading id="team-summary-h" size={16}>This week</PixelHeading></FrameHead>}
    >
      <Box sx={{ p: { xs: '10px 14px', md: '14px 20px' }, display: 'flex', flexDirection: 'column', gap: { xs: '8px', md: '12px' } }}>
        {status === 'loading' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: '12px 16px' }}>
            {Array.from({ length: 4 }, (_, i) => <Skel key={i} width="100%" height={40} />)}
          </Box>
        )}

        {status === 'error' && (
          <Box role="alert" sx={{ fontSize: '15px' }}>
            We could not load this week&apos;s matchup right now.
          </Box>
        )}

        {status === 'empty' && (
          <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>No matchup this week</Box>
        )}

        {status === 'ready' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: { xs: '8px 16px', sm: '12px 16px' } }}>
            <Tile testId="strip-score" label="Score vs proj." value={figureLabel(viewer?.score, viewer?.projected)} />
            <Tile testId="strip-opponent-score" label="Opponent vs proj." value={figureLabel(opponent?.score, opponent?.projected)} />
            <Tile
              testId="strip-starters-remaining"
              label="Starters"
              value={viewer?.playersRemaining != null ? `${viewer.playersRemaining} to play` : '-'}
            />
            <Tile testId="strip-starters-locked" label="Locked" value={`${lockedStarters} of ${totalStarters}`} />
          </Box>
        )}

        {winProbability != null && (
          <Box component="p" data-testid="strip-win-probability" sx={{ m: 0, fontSize: '14px', color: 'var(--ps-dim)' }}>
            <Box component="b" sx={{ fontWeight: 700, color: 'var(--ps-ink)' }}>{`Win probability ${winProbability}%`}</Box>
            {' · '}
            <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box>
          </Box>
        )}

        {hasAttentionRow && (
          <Box data-testid="strip-attention" sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* On a phone the label heads its own line, so the chips share one row under it. */}
            <Box component="span" sx={{ ...CAPTION_SX, flexBasis: { xs: '100%', sm: 'auto' } }}>Watch</Box>
            {questionableChips.map((chip) => <AttentionChip key={chip.key} testId={chip.testId}>{chip.label}</AttentionChip>)}
            {byeChips.map((chip) => <AttentionChip key={chip.key} testId={chip.testId}>{chip.label}</AttentionChip>)}
            {byeClusterAttention && (
              <AttentionChip testId="attention-chip-bye-cluster" warn>{byeClusterAttention}</AttentionChip>
            )}
          </Box>
        )}

        {/* The advice tile stands apart from the ready/empty/error grid above (#1238 AC4): it reads its own
            `advice` prop, not the matchup read this widget's `status` tracks, so a bye week or a failed
            matchup read never hides "how many swaps the advice wants". */}
        <Box data-testid="strip-advice" sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, flexWrap: 'wrap', alignItems: { xs: 'baseline', sm: 'stretch' }, gap: { xs: '0 10px', sm: '2px' }, borderTop: '2px solid var(--ps-rule)', pt: { xs: '8px', sm: '10px' } }}>
          <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>Advice</Box>
          <Box component="span" sx={{ fontSize: { xs: '15px', sm: '16px' }, fontWeight: 700, textWrap: 'pretty' }}>{adviceValue}</Box>
        </Box>
      </Box>
    </Frame>
  );
}

// A labelled figure: the Dim label over a tabular 18px value (16px on a phone).
function Tile({ testId, label, value }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="span" sx={{ fontSize: { xs: '16px', sm: '18px' }, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</Box>
    </Box>
  );
}

// An outlined Ink attention tag (13px 700 uppercase, 28px high); the Bye cluster one carries the warning mark.
function AttentionChip({ testId, warn = false, children }) {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        minHeight: '28px',
        boxSizing: 'border-box',
        padding: '0 8px',
        border: '2px solid var(--ps-ink)',
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
      }}
    >
      {warn && <PixelWarn />}
      {children}
    </Box>
  );
}

// The chip label's player name (e.g. "Lamb Q · ankle" for "CeeDee Lamb"): the
// last whitespace-separated token of the entry's full name, matching the
// design's own examples. No entity-layer helper does this today (every other
// surface renders the full name), so it stays local to this widget rather
// than a below-island promotion with one consumer (ADR 0031's threshold).
function lastNameOf(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1];
}

// `injuryDetail` ranges from a short tag ("ankle") to a full news sentence
// (a quoted coach update, complete with date). This chip is a scan-friendly
// summary, not the place for the full quote - cut it to a word boundary
// around 40 characters so the pill stays a pill instead of overflowing its
// row on a narrow viewport (the full detail still lives wherever the app
// otherwise surfaces injury news).
const CHIP_DETAIL_MAX = 40;
function truncateDetail(detail) {
  const text = String(detail).trim();
  if (text.length <= CHIP_DETAIL_MAX) return text;
  const cut = text.slice(0, CHIP_DETAIL_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// "112.3 / 108.5" when both are known, a single figure when only one is,
// and a dash when neither is.
function figureLabel(score, projected) {
  const s = score != null ? score.toFixed(1) : null;
  const p = projected != null ? projected.toFixed(1) : null;
  if (s != null && p != null) return `${s} / ${p}`;
  if (s != null) return s;
  if (p != null) return p;
  return '-';
}
