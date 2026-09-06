import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { playLabel } from '../../../lib/scoringEvents';

/**
 * The bottom toast stack of the celebrate-touchdown feature (ADR 0031, #903),
 * moved out of the legacy Matchup Detail page: an opponent starter's touchdown
 * and the summary toast for cutscenes beyond the cap each land here for
 * TOAST_MS, or until dismissed. Every toast is a `role="status"` so it is
 * announced once without stealing focus. The message is the toast's own when
 * it carries one (the summary), else "<name> · <play label> (+<points>)", the
 * points always to one decimal ("+6.0", the ticker's format too).
 *
 * The toast BODY is plain content and the dismiss control is a real button
 * named "Dismiss" (#911). It used to be the other way round: the whole toast
 * carried the `onClick`, which made a pointer the only way to get rid of one,
 * put a click target in the accessibility tree with no name, role or keyboard
 * behaviour of its own, and left anyone reading the line with a screen reader
 * no way to act on it. The auto-dismiss timer is unchanged, so a toast nobody
 * touches still leaves on its own; the button only gives the same exit a name
 * and a key.
 *
 * Paints only `dash-*` tokens plus the app's radius, shadow and focus-ring
 * tokens (the focus ring on the dismiss button alone): ink on the card surface
 * (a registered pairing), with the tone carried by the left rule alone
 * (`dash-accent` for the viewer's own, `dash-danger` for the opponent's),
 * never by a text colour, so no new ink-on-surface pairing is composed. The
 * button's glyph is `dash-dim` on that same surface, which is registered too.
 * The tone is exposed as `data-tone` for a test to read.
 */
export const TOAST_MS = 2400;

/** Points to one decimal always: "+6.0", never "+6". */
function points1(n) {
  return (Number(n) || 0).toFixed(1);
}

/**
 * The dismiss button's glyph: a plain cross on the canvas's 20px grid, drawn
 * the same way the feature's other inline icons are (stroke, currentColor,
 * `aria-hidden`). The button's name comes from its `aria-label`, never from
 * this, so the toast's text content stays the play line alone.
 */
function CloseGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);
  const positive = toast.tone === 'positive';
  const message = toast.message || `${toast.name} · ${playLabel(toast)} (+${points1(toast.pointsDelta)})`;
  return (
    <Box
      role="status"
      data-testid="matchup-toast"
      data-tone={positive ? 'positive' : 'negative'}
      sx={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        pl: '14px',
        pr: '6px',
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
      <Box component="span">{message}</Box>
      <Box
        component="button"
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          width: 28,
          height: 28,
          p: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--dash-dim)',
          borderRadius: 'var(--radius-sm)',
          '&:hover': { color: 'var(--dash-ink)' },
          '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
        }}
      >
        <CloseGlyph />
      </Box>
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
