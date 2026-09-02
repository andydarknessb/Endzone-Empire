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

// Fantasy-standard starting order — the API returns starters sorted
// alphabetically by slot (a SQL ORDER BY convenience), which reads QB last.
const SLOT_DISPLAY_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

/** Stable-sorts starters into fantasy-standard slot order (unknown slots sink to the end). */
function sortBySlotOrder(starters) {
  return [...(starters || [])].sort((a, b) => {
    const ai = SLOT_DISPLAY_ORDER.indexOf(a.slot);
    const bi = SLOT_DISPLAY_ORDER.indexOf(b.slot);
    return (ai === -1 ? SLOT_DISPLAY_ORDER.length : ai) - (bi === -1 ? SLOT_DISPLAY_ORDER.length : bi);
  });
}

/** DEF is stored/scored as the "DEF" slot but reads as D/ST everywhere it's displayed. */
function slotLabel(slot) {
  return slot === 'DEF' ? 'D/ST' : slot;
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
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
        Live win probability
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

/** Stays pinned to the top of the viewport so the score is visible while scrolling the roster. */
export function StickyScoreboard({ homeName, awayName, homeScore, awayScore, homeProb, final: isFinal, isLive }) {
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
        {isFinal
          ? <Chip label="Final" color="success" size="small" />
          : isLive
            ? <Chip label="LIVE" color="error" size="small" />
            : <Chip label="Not started" variant="outlined" size="small" />}
      </Box>
      {(isLive || isFinal) && (
        <Box
          role="img"
          aria-label={`Win probability: ${homeName} ${Math.round(home * 100)}%, ${awayName} ${Math.round((1 - home) * 100)}%`}
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
  final: PropTypes.bool,
  isLive: PropTypes.bool,
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
 * One row per lineup slot, pairing the home and away starters arrays index-by-index
 * (both share the league's slot structure). Unpaired remainder rows render with an
 * empty opposite side rather than dropping data when the two arrays differ in length.
 */
export function SlotComparisonList({ homeStarters, awayStarters, expandedId, onToggle, onOpenPlayer }) {
  const home = sortBySlotOrder(homeStarters);
  const away = sortBySlotOrder(awayStarters);
  const rowCount = Math.max(home.length, away.length);
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    home: home[i] || null,
    away: away[i] || null,
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row, i) => {
        const rowSlot = slotLabel(row.home?.slot || row.away?.slot || '');
        const homeOpen = !!(row.home && expandedId === row.home.id);
        const awayOpen = !!(row.away && expandedId === row.away.id);
        const openPlayer = homeOpen ? row.home : (awayOpen ? row.away : null);
        return (
          <Box
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
                {openPlayer && <PaceBar actual={openPlayer.points} projected={openPlayer.projected} />}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

SlotComparisonList.propTypes = {
  homeStarters: PropTypes.array,
  awayStarters: PropTypes.array,
  expandedId: PropTypes.number,
  onToggle: PropTypes.func.isRequired,
  onOpenPlayer: PropTypes.func.isRequired,
};

// --- Compact roster preview (Matchups list page) ----------------------------

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
          {player.projected != null ? ` · Proj ${Number(player.projected).toFixed(1)}` : ''}
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
 * Compact, non-interactive slot-by-slot roster comparison for the Matchups
 * list page — a preview of the full SlotComparisonList shown on the matchup
 * detail page, driven by the same real starters/points/projected data.
 */
export function RosterPreviewGrid({ homeStarters, awayStarters }) {
  const home = sortBySlotOrder(homeStarters);
  const away = sortBySlotOrder(awayStarters);
  const rowCount = Math.max(home.length, away.length);
  if (rowCount === 0) return null;
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    home: home[i] || null,
    away: away[i] || null,
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row, i) => {
        const rowSlot = slotLabel(row.home?.slot || row.away?.slot || '');
        return (
          <Box
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
  homeStarters: PropTypes.array,
  awayStarters: PropTypes.array,
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
          <Typography variant="subtitle2" component="h3">Bench what-if</Typography>
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

// --- Status chip -------------------------------------------------------

export function MatchupStatusChip({ matchup, showLive }) {
  if (matchup.final) {
    return <Chip size="small" label="Final" color="success" />;
  }
  if (showLive) {
    return <Chip size="small" label="LIVE" color="error" />;
  }
  return <Chip size="small" label="Scheduled" variant="outlined" />;
}

MatchupStatusChip.propTypes = {
  matchup: PropTypes.shape({ final: PropTypes.bool }).isRequired,
  showLive: PropTypes.bool,
};
