import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { DashButton } from '../../../shared/ui';

/**
 * pickem-board widget (#1265, ADR 0038 "What to build"): the board's save
 * bar - a progress meter over the slate ("N of M picked") and the Save
 * button that commits the `save-picks` feature's local draft. On a phone the
 * canvas pins this to the bottom of the viewport with the meter; the sticky
 * positioning is layout, not behaviour, so it lives in `sx` here rather than
 * a separate prop.
 *
 * A save is disabled while there is nothing to save or one is already in
 * flight, never while the board is merely loading (loading is the board's
 * own gate on whether this bar mounts at all).
 *
 * `saveError` here is the general failure a save can return with NO
 * `gameKeys` (a network failure, PICKEM_DISABLED, PICKEM_NO_SLATE): the
 * per-game failures (PICKEM_LOCKED, PICKEM_BAD_CONFIDENCE) already flag
 * their own GameCard and are never repeated here.
 *
 * A successful save flips `isDirty` false, which disables the Save button
 * this click is still focused on - a disabled `<button>` drops out of the
 * focusable set, so an unmanaged focus would fall to `<body>` and strand a
 * keyboard user (accessibility risk review, #1265). This bar owns the click
 * instead of leaving it to the caller: once `onSave` resolves `{ ok: true
 * }`, it moves focus onto a confirmation (WCAG 4.1.3 - a save otherwise has
 * no confirmation at all beyond the button greying out). No `role="status"`
 * on it: a focused element carrying text is announced on its own, and a
 * live region on TOP of the focus move would announce the same "Picks
 * saved" twice (formal review, #1265 - the same duplicate-announcement
 * shape this PR's own accessibility fixes elsewhere removed, GameCard.jsx's
 * win-probability line and KickoffWindowGroup's section label). The
 * confirmation clears itself the moment `isDirty` goes true again (a new
 * edit), so it never lingers stale over a pick made after the save.
 */
export default function SaveBar({
  pickedCount = 0,
  slateSize = 0,
  isDirty = false,
  saving = false,
  saveError = null,
  onSave,
}) {
  const pct = slateSize > 0 ? Math.max(0, Math.min(100, Math.round((pickedCount / slateSize) * 100))) : 0;
  const generalError = saveError && (!Array.isArray(saveError.gameKeys) || saveError.gameKeys.length === 0)
    ? saveError.message
    : null;

  const [justSaved, setJustSaved] = useState(false);
  const statusRef = useRef(null);

  useEffect(() => {
    if (isDirty) setJustSaved(false);
  }, [isDirty]);

  useEffect(() => {
    if (justSaved) statusRef.current?.focus();
  }, [justSaved]);

  const handleSave = async () => {
    const result = await onSave?.();
    if (result?.ok) setJustSaved(true);
  };

  return (
    <Box
      data-testid="save-bar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        p: '12px 16px',
        borderTop: '1px solid var(--dash-line)',
        backgroundColor: 'var(--dash-surface)',
        position: { xs: 'sticky', md: 'static' },
        bottom: 0,
        zIndex: 1,
      }}
    >
      <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
        <Typography
          component="span"
          data-testid="save-bar-progress-label"
          sx={{ fontSize: '12px', color: 'var(--dash-dim)' }}
        >
          {`${pickedCount} of ${slateSize} picked`}
        </Typography>
        <Box
          role="img"
          aria-label={`${pickedCount} of ${slateSize} games picked`}
          data-testid="save-bar-progress"
          sx={{
            mt: '4px',
            height: 6,
            borderRadius: 'var(--radius-pill)',
            backgroundColor: 'var(--dash-surface3)',
            overflow: 'hidden',
          }}
        >
          <Box
            data-testid="save-bar-progress-fill"
            style={{ width: `${pct}%` }}
            sx={{ height: '100%', backgroundColor: 'var(--dash-accent)' }}
          />
        </Box>
      </Box>

      {generalError && (
        <Typography role="alert" data-testid="save-bar-error" sx={{ fontSize: '12px', color: 'var(--dash-danger)' }}>
          {generalError}
        </Typography>
      )}

      {justSaved && (
        <Typography
          ref={statusRef}
          tabIndex={-1}
          data-testid="save-bar-success"
          sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--dash-accent)', outline: 'none' }}
        >
          Picks saved
        </Typography>
      )}

      <DashButton
        type="button"
        disabled={!isDirty || saving}
        onClick={handleSave}
        data-testid="save-bar-save"
      >
        {saving ? 'Saving' : 'Save picks'}
      </DashButton>
    </Box>
  );
}
