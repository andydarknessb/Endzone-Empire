import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Collapse,
  Button,
  LinearProgress,
  Avatar,
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { playLabel } from '../../lib/scoringEvents';

/** DEF is stored/scored as the "DEF" slot but reads as D/ST everywhere it's displayed. */
function slotLabel(slot) {
  return slot === 'DEF' ? 'D/ST' : slot;
}

/**
 * The reason an Unavailable player (CONTEXT.md, Roster and lineup) shows in
 * place of his projection, in the Lineup page's words; null for an available
 * row (or a row that carries no verdict), which shows its number as ever.
 */
const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };
export function unavailableLabel(availability) {
  if (!availability || availability.available !== false) return null;
  return UNAVAILABLE_LABELS[availability.reason] || 'out';
}

// --- Win probability bar ---------------------------------------------------

export function WinProbabilityBar({ homeName, awayName, homeProb }) {
  const home = Math.max(0, Math.min(1, Number(homeProb) || 0));
  const pct = (v) => `${Math.round(v * 100)}%`;
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {homeName} {pct(home)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {pct(1 - home)} {awayName}
        </Typography>
      </Box>
      <Box
        role="img"
        aria-label={`Win probability: ${homeName} ${pct(home)}, ${awayName} ${pct(1 - home)}`}
        sx={{
          display: 'flex',
          height: 12,
          borderRadius: 6,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        <Box
          sx={{
            width: `${home * 100}%`,
            bgcolor: 'primary.main',
            transition: 'width 0.8s ease',
          }}
        />
        <Box
          sx={{
            width: `${(1 - home) * 100}%`,
            bgcolor: 'secondary.main',
            transition: 'width 0.8s ease',
          }}
        />
      </Box>
      {/* The caption carries no time claim (#872): the bar is shown for any
          started matchup (live, played and final alike), and "Win
          probability" reads correctly in every one of those states.
          It is aria-hidden (#878): the bar's own aria-label is the sole
          accessible name, so a screen reader does not hear the caption a
          second time after announcing that label. */}
      <Typography
        variant="caption"
        aria-hidden="true"
        sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}
      >
        Win probability
      </Typography>
    </Paper>
  );
}

WinProbabilityBar.propTypes = {
  homeName: PropTypes.string,
  awayName: PropTypes.string,
  homeProb: PropTypes.number,
};

// --- Sticky compact scoreboard ----------------------------------------------

/**
 * Stays pinned to the top of the viewport so the score is visible while
 * scrolling the roster. The status chip is the entity's one status label (ADR
 * 0030): `chipLabel` is passed in from `matchupStatusView`, identical to the
 * page header's chip, so the two never disagree - and a status the server could
 * not compute (null `chipLabel`) shows no chip rather than a guessed "Not
 * started". The win-probability track shows once the matchup has `started`
 * (true), stays hidden before kickoff (false) and asserts neither for an
 * unknown status (null).
 */
export function StickyScoreboard({ homeName, awayName, homeScore, awayScore, homeProb, chipLabel, chipColor, chipVariant, started }) {
  const home = Math.max(0, Math.min(1, Number(homeProb) || 0));
  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        bgcolor: 'background.default',
        pt: 1,
        pb: 0.75,
        mb: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Typography
          variant="subtitle1"
          component="span"
          noWrap
          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
        >
          {homeName} {Number(homeScore || 0).toFixed(1)} - {Number(awayScore || 0).toFixed(1)} {awayName}
        </Typography>
        {chipLabel && <Chip label={chipLabel} color={chipColor} variant={chipVariant} size="small" />}
      </Box>
      {started === true && (
        // Decorative (#887): the full WinProbabilityBar below is the page's one
        // accessible name for win probability. This track carries no role and
        // no aria-label so assistive tech does not announce it a second time.
        <Box
          data-testid="sticky-win-probability-track"
          sx={{
            display: 'flex',
            height: 4,
            borderRadius: 2,
            overflow: 'hidden',
            mt: 0.75,
            bgcolor: 'action.hover',
          }}
        >
          <Box sx={{ width: `${home * 100}%`, bgcolor: 'primary.main', transition: 'width 0.8s ease' }} />
          <Box sx={{ width: `${(1 - home) * 100}%`, bgcolor: 'secondary.main', transition: 'width 0.8s ease' }} />
        </Box>
      )}
    </Box>
  );
}

StickyScoreboard.propTypes = {
  homeName: PropTypes.string,
  awayName: PropTypes.string,
  homeScore: PropTypes.number,
  awayScore: PropTypes.number,
  homeProb: PropTypes.number,
  chipLabel: PropTypes.string,
  chipColor: PropTypes.string,
  chipVariant: PropTypes.string,
  // true = started, false = not started, null = unknown (ADR 0030).
  started: PropTypes.bool,
};

// --- Expandable starter list with pace bars --------------------------------

/** Compact human summary of a player's stat line; '' when nothing recorded. */
export function formatStatLine(stats) {
  if (!stats) return '';
  const parts = [];
  const push = (val, unit) => {
    if (Number(val)) parts.push(`${Number(val)} ${unit}`);
  };
  push(stats.passingYards, 'pass yds');
  push(stats.passingTDs, 'pass TD');
  push(stats.interceptions, 'INT');
  push(stats.rushingYards, 'rush yds');
  push(stats.rushingTDs, 'rush TD');
  push(stats.receptions, 'rec');
  push(stats.receivingYards, 'rec yds');
  push(stats.receivingTDs, 'rec TD');
  push(stats.fieldGoal, 'FG');
  push(stats.extraPoint, 'XP');
  push(stats.fumbles, 'fum');
  return parts.join(' • ');
}

function PaceBar({ actual, projected }) {
  const proj = Number(projected) || 0;
  const act = Number(actual) || 0;
  const ratio = proj > 0 ? Math.max(0, Math.min(1, act / proj)) : (act > 0 ? 1 : 0);
  const ahead = proj > 0 && act >= proj;
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Pace</Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: ahead ? 'success.main' : 'text.secondary' }}>
          {act.toFixed(1)} / {proj ? proj.toFixed(1) : '-'} proj
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={ratio * 100}
        color={ahead ? 'success' : 'primary'}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
}

PaceBar.propTypes = { actual: PropTypes.number, projected: PropTypes.number };

export function StarterList({ starters, expandedId, onToggle }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {(starters || []).map((player) => {
        const open = expandedId === player.id;
        const statLine = formatStatLine(player.stats);
        return (
          <Box key={player.id} sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Box
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => onToggle(player.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(player.id); }
              }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, py: 1, cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
                '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: -2 },
              }}
            >
              <Chip label={player.slot} size="small" sx={{ minWidth: 56 }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" noWrap>{player.name}</Typography>
                  <InjuryBadge status={player.injury_status} />
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {player.position} · {player.nfl_team}
                  {player.opponent ? ` vs ${player.opponent}` : ''}
                </Typography>
              </Box>
              <Typography variant="stat" sx={{ textAlign: 'right', fontSize: '0.875rem' }}>
                {Number(player.points || 0).toFixed(1)}
              </Typography>
            </Box>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ pb: 1.5, pl: 8.5, pr: 1 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {statLine || 'No stats recorded yet.'}
                </Typography>
                <PaceBar actual={player.points} projected={player.projected} />
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

StarterList.propTypes = {
  starters: PropTypes.array,
  expandedId: PropTypes.number,
  onToggle: PropTypes.func.isRequired,
};

// --- Slot-aligned head-to-head comparison -----------------------------------

const scoreFlash = keyframes`
  0% { background-color: transparent; }
  35% { background-color: var(--accent-soft); }
  100% { background-color: transparent; }
`;

/** Remounts (via the returned key) whenever `value` changes after the first render, so a CSS animation can replay. */
function useFlashKey(value) {
  const prevRef = useRef(value);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (value != null && prevRef.current != null && value !== prevRef.current) {
      setFlashKey((k) => k + 1);
    }
    prevRef.current = value;
  }, [value]);
  return flashKey;
}

function SlotSide({ player, side, open, onToggle, onOpenPlayer }) {
  const points = player ? Number(player.points || 0) : null;
  const flashKey = useFlashKey(points);

  if (!player) {
    return <Box sx={{ flex: 1, minWidth: 0 }} />;
  }

  return (
    <Box
      key={flashKey}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => onToggle(player.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(player.id); }
      }}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: side === 'home' ? 'row' : 'row-reverse',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1,
        py: 1,
        cursor: 'pointer',
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: -2 },
        animation: flashKey > 0 ? `${scoreFlash} 1.2s ease-out` : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <PlayerNameLink
          name={player.name}
          playerId={player.id}
          onOpen={onOpenPlayer}
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '100%' }}
        />
        <InjuryBadge status={player.injury_status} />
      </Box>
      <Typography
        variant="stat"
        sx={{ fontSize: '0.875rem', flexShrink: 0 }}
      >
        {points.toFixed(1)}
      </Typography>
    </Box>
  );
}

SlotSide.propTypes = {
  player: PropTypes.object,
  side: PropTypes.oneOf(['home', 'away']).isRequired,
  open: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  onOpenPlayer: PropTypes.func.isRequired,
};

/**
 * One row per lineup slot instance from the pre-paired `rows` the Matchup entity
 * hands down (home paired with away by slot key, in the league's slot order).
 * This is one of the two renderings of that one row list - the roster
 * preview grid is the other - so both show the same slots in the same order and
 * neither pairs or re-sorts here. A slot only one side has filled arrives with an
 * empty opposite side rather than dropping data or shifting labels.
 */
export function SlotComparisonList({ rows, expandedId, onToggle, onOpenPlayer }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {(rows || []).map((row, i) => {
        const rowSlot = slotLabel(row.slot);
        const homeOpen = !!(row.home && expandedId === row.home.id);
        const awayOpen = !!(row.away && expandedId === row.away.id);
        const openPlayer = homeOpen ? row.home : (awayOpen ? row.away : null);
        return (
          <Box
            data-testid="slot-row"
            key={`${row.home?.id ?? 'x'}-${row.away?.id ?? 'x'}-${i}`}
            sx={{ borderTop: 1, borderColor: 'divider' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <SlotSide player={row.home} side="home" open={homeOpen} onToggle={onToggle} onOpenPlayer={onOpenPlayer} />
              <Chip label={rowSlot} size="small" sx={{ minWidth: 48, mx: 0.5, flexShrink: 0 }} />
              <SlotSide player={row.away} side="away" open={awayOpen} onToggle={onToggle} onOpenPlayer={onOpenPlayer} />
            </Box>
            <Collapse in={!!openPlayer} unmountOnExit>
              <Box sx={{ pb: 1.5, px: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {openPlayer ? (formatStatLine(openPlayer.stats) || 'No stats recorded yet.') : ''}
                </Typography>
                {/* An Unavailable player shows why in place of his projection and
                    no pace bar: there is no number to pace against (#883). */}
                {openPlayer && (unavailableLabel(openPlayer.availability) ? (
                  <Typography variant="caption" data-testid="unavailable-reason" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                    Projection: {unavailableLabel(openPlayer.availability)}
                  </Typography>
                ) : (
                  <PaceBar actual={openPlayer.points} projected={openPlayer.projected} />
                ))}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

SlotComparisonList.propTypes = {
  // Pre-paired rows from the Matchup entity: [{ slot, home, away }], home paired
  // with away by slot key, in the league's slot order.
  rows: PropTypes.arrayOf(PropTypes.shape({
    slot: PropTypes.string,
    home: PropTypes.object,
    away: PropTypes.object,
  })),
  expandedId: PropTypes.number,
  onToggle: PropTypes.func.isRequired,
  onOpenPlayer: PropTypes.func.isRequired,
};

// --- Compact roster preview (retro field) -----------------------------------

function playerInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function RosterPreviewSide({ player, side }) {
  if (!player) return <Box sx={{ flex: 1, minWidth: 0 }} />;
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: side === 'home' ? 'row' : 'row-reverse',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <Avatar
        sx={{
          width: 28,
          height: 28,
          fontSize: '0.75rem',
          bgcolor: side === 'home' ? 'primary.main' : 'secondary.main',
        }}
      >
        {playerInitials(player.name)}
      </Avatar>
      <Box sx={{ minWidth: 0, textAlign: side === 'home' ? 'left' : 'right' }}>
        <Typography variant="body2" noWrap>{player.name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {Number(player.points || 0).toFixed(1)} pts
          {unavailableLabel(player.availability)
            ? ` · ${unavailableLabel(player.availability)}`
            : (player.projected != null ? ` · Proj ${Number(player.projected).toFixed(1)}` : '')}
        </Typography>
      </Box>
    </Box>
  );
}

RosterPreviewSide.propTypes = {
  player: PropTypes.object,
  side: PropTypes.oneOf(['home', 'away']).isRequired,
};

/**
 * Compact, non-interactive slot-by-slot roster comparison shown inside the retro
 * field — a preview of the full SlotComparisonList, and the second rendering of
 * the same pre-paired `rows` the entity hands down, so the two agree slot for
 * slot. It neither pairs nor re-sorts: it renders the rows as given.
 */
export function RosterPreviewGrid({ rows }) {
  if (!rows || rows.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row, i) => {
        const rowSlot = slotLabel(row.slot);
        return (
          <Box
            data-testid="slot-row"
            key={`${row.home?.id ?? 'x'}-${row.away?.id ?? 'x'}-${i}`}
            sx={{ display: 'flex', alignItems: 'center', py: 0.75, borderTop: 1, borderColor: 'divider' }}
          >
            <RosterPreviewSide player={row.home} side="home" />
            <Chip label={rowSlot} size="small" sx={{ minWidth: 48, mx: 1, flexShrink: 0 }} />
            <RosterPreviewSide player={row.away} side="away" />
          </Box>
        );
      })}
    </Box>
  );
}

RosterPreviewGrid.propTypes = {
  // Pre-paired rows from the Matchup entity, the same shape SlotComparisonList
  // renders: [{ slot, home, away }].
  rows: PropTypes.arrayOf(PropTypes.shape({
    slot: PropTypes.string,
    home: PropTypes.object,
    away: PropTypes.object,
  })),
};

// --- Live play ticker ------------------------------------------------------

export function LiveTicker({ items }) {
  if (!items || items.length === 0) return null;
  // Duplicate the run so the marquee loops seamlessly.
  const loop = [...items, ...items];
  const last = items[items.length - 1];
  const lastColor = ['away', 'opponent'].includes(last.side) ? 'secondary.main' : 'primary.main';
  return (
    <Paper
      sx={{ mb: 2, overflow: 'hidden', position: 'relative' }}
      aria-label="Recent scoring plays"
    >
      <Box sx={{ display: { xs: 'block', sm: 'none' }, py: 1, px: 2 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600, color: lastColor }}
        >
          Last: {last.name} · {playLabel(last)} (+{Math.round((Number(last.pointsDelta) || 0) * 10) / 10})
        </Typography>
      </Box>
      <Box
        sx={{
          display: { xs: 'none', sm: 'inline-flex' },
          gap: 3,
          py: 1,
          px: 2,
          whiteSpace: 'nowrap',
          animation: 'ticker-scroll 22s linear infinite',
          '&:hover': { animationPlayState: 'paused' },
          '@keyframes ticker-scroll': {
            from: { transform: 'translateX(0)' },
            to: { transform: 'translateX(-50%)' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        {loop.map((item, i) => (
          <Typography
            key={`${item.playerId}-${i}`}
            component="span"
            variant="body2"
            sx={{
              fontWeight: 600,
              color: ['away', 'opponent'].includes(item.side) ? 'secondary.main' : 'primary.main',
            }}
          >
            {item.name} · {playLabel(item)} (+{Math.round((Number(item.pointsDelta) || 0) * 10) / 10})
          </Typography>
        ))}
      </Box>
    </Paper>
  );
}

LiveTicker.propTypes = { items: PropTypes.array };

// --- Bench what-if (live, read-only) ---------------------------------------

export function BenchWhatIf({ whatIf, hasRoster, open, onToggle }) {
  if (!whatIf || !hasRoster) return null;
  const delta = Number(whatIf.delta) || 0;
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" component="h5">Bench what-if</Typography>
          <Typography variant="caption" sx={{ color: delta > 0 ? 'warning.main' : 'text.secondary' }}>
            {delta > 0
              ? `+${delta.toFixed(1)} still on your bench`
              : 'Your best legal lineup is already active.'}
          </Typography>
        </Box>
        <Button size="small" onClick={onToggle} disabled={delta <= 0 && (!whatIf.swaps || whatIf.swaps.length === 0)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {(whatIf.swaps || []).length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No unlocked upgrades available.
            </Typography>
          )}
          {(whatIf.swaps || []).map((s) => (
            <Box
              key={`${s.out.playerId}-${s.in.playerId}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary', textDecoration: 'line-through' }}>
                {s.out.name} ({s.out.points.toFixed(1)})
              </Typography>
              <Typography variant="body2">→</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.in.name} ({s.in.points.toFixed(1)})
              </Typography>
              <Chip size="small" color="warning" label={`+${Number(s.gain).toFixed(1)}`} />
            </Box>
          ))}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Informational: locked players can't be swapped.
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}

BenchWhatIf.propTypes = {
  whatIf: PropTypes.object,
  hasRoster: PropTypes.bool,
  open: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
};

// --- Toasts (opponent TDs, summary overflow) -------------------------------

const TOAST_MS = 2400;

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);
  const positive = toast.tone === 'positive';
  return (
    <Paper
      elevation={6}
      role="status"
      onClick={() => onDismiss(toast.id)}
      sx={{
        px: 2, py: 1, cursor: 'pointer', pointerEvents: 'auto',
        bgcolor: positive ? 'success.main' : 'error.main',
        color: positive ? 'success.contrastText' : 'error.contrastText',
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {toast.message
          || `${toast.name} · ${playLabel(toast)} (+${Math.round((Number(toast.pointsDelta) || 0) * 10) / 10})`}
      </Typography>
    </Paper>
  );
}

Toast.propTypes = { toast: PropTypes.object.isRequired, onDismiss: PropTypes.func.isRequired };

export function MatchupToasts({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <Box
      sx={{
        position: 'fixed', bottom: 16, left: 0, right: 0, zIndex: 1400,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </Box>
  );
}

MatchupToasts.propTypes = { toasts: PropTypes.array, onDismiss: PropTypes.func.isRequired };
