import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Collapse,
  Button,
  LinearProgress,
} from '@mui/material';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import { playLabel } from '../../lib/scoringEvents';

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
          {act.toFixed(1)} / {proj ? proj.toFixed(1) : '—'} proj
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
                '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
              }}
            >
              <Chip label={player.slot} size="small" sx={{ minWidth: 56 }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" noWrap>{player.name}</Typography>
                  <InjuryBadge status={player.injury_status} />
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {player.position} — {player.nfl_team}
                  {player.opponent ? ` vs ${player.opponent}` : ''}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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

// --- Live play ticker ------------------------------------------------------

export function LiveTicker({ items }) {
  if (!items || items.length === 0) return null;
  // Duplicate the run so the marquee loops seamlessly.
  const loop = [...items, ...items];
  return (
    <Paper
      sx={{ mb: 2, overflow: 'hidden', position: 'relative' }}
      aria-label="Recent scoring plays"
    >
      <Box
        sx={{
          display: 'inline-flex',
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
            {item.name} — {playLabel(item)} (+{Math.round((Number(item.pointsDelta) || 0) * 10) / 10})
          </Typography>
        ))}
      </Box>
    </Paper>
  );
}

LiveTicker.propTypes = { items: PropTypes.array };

// --- Bench what-if (live, read-only) ---------------------------------------

export function BenchWhatIf({ whatIf, open, onToggle }) {
  if (!whatIf) return null;
  const delta = Number(whatIf.delta) || 0;
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2">Bench what-if</Typography>
          <Typography variant="caption" sx={{ color: delta > 0 ? 'warning.main' : 'text.secondary' }}>
            {delta > 0
              ? `+${delta.toFixed(1)} still on your bench`
              : 'Your best legal lineup is in'}
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
            Informational — locked players can't be swapped.
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}

BenchWhatIf.propTypes = {
  whatIf: PropTypes.object,
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
          || `${toast.name} — ${playLabel(toast)} (+${Math.round((Number(toast.pointsDelta) || 0) * 10) / 10})`}
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
