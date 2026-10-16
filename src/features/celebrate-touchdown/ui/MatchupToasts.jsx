import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { playLabel, formatSignedPoints } from '../../../entities/matchup';
import { PixelClose } from '../../../shared/ui/playselect';

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
 * named "Dismiss" (#911), a 44px target. The auto-dismiss timer is unchanged,
 * so a toast nobody touches still leaves on its own; the button only gives the
 * same exit a name and a key.
 *
 * Restyled for Play-select (ADR 0067 wave 2): ink on the panel, a 2px rule
 * edge and square corners, with the tone carried by the 6px left edge (Accent
 * for the viewer's own, Dim for the opponent's) and never by a text colour, so
 * no ink-on-surface pairing beyond ink and dim on the panel is composed. The
 * tone is exposed as `data-tone` for a test to read. The global keyboard focus
 * ring (`.ps-root :focus-visible`) rings the dismiss button.
 */
export const TOAST_MS = 2400;

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);
  const positive = toast.tone === 'positive';
  const message = toast.message || `${toast.name} · ${playLabel(toast)} (${formatSignedPoints(toast.pointsDelta)})`;
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
        pr: '2px',
        py: '2px',
        fontSize: '15px',
        fontWeight: 600,
        lineHeight: 1.45,
        color: 'var(--ps-ink)',
        backgroundColor: 'var(--ps-panel)',
        border: '2px solid var(--ps-rule)',
        borderLeft: `6px solid ${positive ? 'var(--ps-accent)' : 'var(--ps-dim)'}`,
        borderRadius: 0,
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
          width: 44,
          height: 44,
          p: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--ps-dim)',
          borderRadius: 0,
          '&:hover': { color: 'var(--ps-ink)' },
        }}
      >
        <PixelClose />
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
