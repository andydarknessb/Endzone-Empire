import React, { useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useAnnouncement } from '../DraftBoard/useAnnouncement';

/**
 * The Draft Sim's ONE turn-status region (#805, #819; ADR 0028). It is the Sim
 * mirror of `LiveDraftBanner`'s status region in the Draft room: one visible
 * `role="status" aria-live="polite"` region on the turn axis, mounted on both
 * turns so a screen reader hears a turn change even when the assistant is off.
 * The assistant's own `PoliteRegion` is a separate, sanctioned axis (ADR 0028).
 *
 * WHY THE TEXT COMES FROM AN EFFECT, NOT INLINE (#819). A live region inserted
 * into the DOM already holding its text is generally not announced
 * (ReadinessAnnouncer.jsx docblock), so an inline turn string leaves the first
 * turn unspoken. This region mounts empty and fills from the effect below,
 * through the same repeat-safe update every discrete-event announcer shares
 * (`useAnnouncement`, #791). ADR 0028, as amended for #819, is explicit that a
 * VISIBLE status region uses this hook: the zero-width-space idiom governs the
 * text node, not whether the region is hidden.
 *
 * WHY IT KEYS ON `turnKey`, NEVER ON `text`. `turnKey` is the pick identity
 * (`sim.currentPick` at the call site). At a snake turnaround the same team is
 * on the clock for two consecutive picks, so `text` is byte-identical; React
 * bails on an Object.is-equal state, so an effect keyed on the text would not
 * refire and that turn would go unannounced. Keyed on the pick identity, the
 * effect refires each turn and `useAnnouncement`'s zero-width space makes the
 * byte-identical repeat audible. When `turnKey` is null (no turn yet) the
 * region stays empty rather than announcing a non-turn.
 */
function SimTurnStatus({ turnKey = null, text = '' }) {
  const [announcement, announce] = useAnnouncement();

  useEffect(() => {
    if (turnKey == null) return;
    announce(text);
    // Keyed on the pick identity alone; text is intentionally omitted so a
    // byte-identical repeat turn still refires on the pick change (#819 AC7).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  return (
    <Box role="status" aria-live="polite">
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {announcement}
      </Typography>
    </Box>
  );
}

export default SimTurnStatus;
