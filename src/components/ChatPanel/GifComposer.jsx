import React, { useId, useRef, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { firstGifProviderId } from '../../lib/gifProvider';

/**
 * The GIF compose affordance for League chat (#446).
 *
 * ABSENT WHEN THE CAPABILITY IS DISABLED (AC7). The whole component renders
 * nothing unless `enabled` is true, so a viewer without the capability sees no
 * GIF control at all while emoji and text (owned elsewhere in the composer)
 * stay complete. `enabled` comes from the server via the league-join ack
 * (gifMessagesEnabled), never inferred client-side, so it is off in production
 * until external approval (AC9).
 *
 * NO EXTERNAL PROVIDER PICKER SHIPS YET (AC9). A real integration would open the
 * provider's search grid here; none may be introduced before approval, so the
 * asset is chosen by entering its provider id manually - the interim compose
 * path that exercises the contract end to end without any provider request. The
 * provider the send is stamped with is whatever is registered in the client
 * provider registry (firstGifProviderId); with none registered - the production
 * state - there is nothing to resolve the asset against, so send stays disabled.
 *
 * DESCRIPTION IS REQUIRED (AC3), enforced here as a disabled Send AND on the
 * server (DESCRIPTION_REQUIRED): a client that never rendered this control can
 * still emit the event, so the button-disable is a convenience, not the
 * guarantee. Because a disabled button announces nothing, the description field
 * also carries a programmatically associated ERROR once it has been touched and
 * left empty, so a screen-reader user learns WHY send is unavailable rather than
 * meeting a silent disabled button. The caption is optional.
 *
 * ACCESSIBILITY. Each field's visible label IS its accessible name (no
 * overriding aria-label, so voice control and WCAG 2.5.3 hold). Opening the
 * disclosure exposes it via aria-controls; Escape dismisses it and Enter in a
 * field submits, matching the text composer; and both close paths (Cancel and a
 * successful send) return focus to the trigger rather than stranding it on the
 * document body. All copy uses hyphens (ADR 0016).
 */
function GifComposer({ enabled = false, onSendGif }) {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [description, setDescription] = useState('');
  const [caption, setCaption] = useState('');
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const triggerRef = useRef(null);
  const panelId = useId();

  if (!enabled) return null;

  const providerId = firstGifProviderId();
  const descriptionMissing = description.trim() === '';
  const descriptionError = descriptionTouched && descriptionMissing;
  const canSend = Boolean(providerId) && assetId.trim() !== '' && !descriptionMissing;

  const reset = () => {
    setAssetId('');
    setDescription('');
    setCaption('');
    setDescriptionTouched(false);
    setOpen(false);
    // Never strand focus on the document body: the panel unmounts, so return
    // focus to the trigger, which is always rendered.
    if (triggerRef.current) triggerRef.current.focus();
  };

  const handleSend = async () => {
    if (!canSend || typeof onSendGif !== 'function') return;
    const ok = await onSendGif({
      provider: providerId,
      assetId: assetId.trim(),
      description: description.trim(),
      caption: caption.trim() || null,
    });
    if (ok) reset();
  };

  const onPanelKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      reset();
    }
  };

  const onFieldKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        ref={triggerRef}
        size="small"
        data-testid="gif-picker-trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        Add a GIF
      </Button>
      {open && (
        <Box
          id={panelId}
          data-testid="gif-picker-panel"
          onKeyDown={onPanelKeyDown}
          sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {!providerId && (
            <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
              The GIF picker becomes available once a provider is enabled.
            </Typography>
          )}
          <TextField
            label="GIF asset id"
            size="small"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            onKeyDown={onFieldKeyDown}
          />
          <TextField
            label="Description"
            size="small"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => setDescriptionTouched(true)}
            onKeyDown={onFieldKeyDown}
            error={descriptionError}
            helperText={descriptionError
              ? 'A description is required before this GIF can be sent.'
              : 'A short accessible description of the GIF. Required to send.'}
          />
          <TextField
            label="Caption (optional)"
            size="small"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={onFieldKeyDown}
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              data-testid="gif-send"
              disabled={!canSend}
              onClick={handleSend}
            >
              Send GIF
            </Button>
            {/* "Cancel GIF", not a bare "Cancel": the same conversation can show
                the moderation hide form, whose own Cancel (ChatConversation) would
                otherwise be a second button with the identical accessible name in
                one region - ambiguous in a button list and a strict-mode locator
                hazard. The visible label IS the accessible name (no aria-label),
                so WCAG 2.5.3 holds. */}
            <Button size="small" onClick={reset}>Cancel GIF</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default GifComposer;
