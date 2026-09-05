import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { playLabel } from '../../../lib/scoringEvents';

/**
 * The bottom toast stack of the celebrate-touchdown feature (ADR 0031, #903),
 * moved out of the legacy Matchup Detail page: an opponent starter's touchdown
 * and the summary toast for cutscenes beyond the cap each land here for
 * TOAST_MS, or until tapped. Every toast is a `role="status"` so it is
 * announced once without stealing focus. The message is the toast's own when
 * it carries one (the summary), else "<name> · <play label> (+<points>)".
 *
 * Paints only `dash-*` tokens plus the app's radius and shadow tokens: ink on
 * the card surface (a registered pairing), with the tone carried by the left
 * rule alone (`dash-accent` for the viewer's own, `dash-danger` for the
 * opponent's), never by a text colour, so no new ink-on-surface pairing is
 * composed. The tone is exposed as `data-tone` for a test to read.
 */
export const TOAST_MS = 2400;

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);
  const positive = toast.tone === 'positive';
  const message = toast.message || `${toast.name} · ${playLabel(toast)} (+${round1(toast.pointsDelta)})`;
  return (
    <Box
      role="status"
      data-testid="matchup-toast"
      data-tone={positive ? 'positive' : 'negative'}
      onClick={() => onDismiss(toast.id)}
      sx={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        px: '14px',
        py: '10px',
        fontSize: '13px',
        fontWeight: 600,
        lineHeight: 1.45,
        fontFamily: 'var(--dash-font-body)',
        color: 'var(--dash-ink)',
        backgroundColor: 'var(--dash-surface)',
        border: '1px solid var(--dash-line)',
        borderLeft: `4px solid ${positive ? 'var(--dash-accent)' : 'var(--dash-danger)'}`,
        borderRadius: 'var(--dash-radius-sm)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      {message}
    </Box>
  );
}

export default function MatchupToasts({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <Box
      data-testid="matchup-toasts"
      sx={{
        position: 'fixed',
        bottom: 16,
        left: 0,
        right: 0,
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </Box>
  );
}
