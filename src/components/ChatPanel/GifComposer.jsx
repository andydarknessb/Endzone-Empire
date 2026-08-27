import React, { useState } from 'react';
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
 * guarantee. The caption is optional. All copy uses hyphens (ADR 0016).
 */
function GifComposer({ enabled = false, onSendGif }) {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [description, setDescription] = useState('');
  const [caption, setCaption] = useState('');

  if (!enabled) return null;

  const providerId = firstGifProviderId();
  const canSend = Boolean(providerId) && assetId.trim() !== '' && description.trim() !== '';

  const reset = () => {
    setAssetId('');
    setDescription('');
    setCaption('');
    setOpen(false);
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

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        size="small"
        data-testid="gif-picker-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        GIF
      </Button>
      {open && (
        <Box data-testid="gif-picker-panel" sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
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
            inputProps={{ 'aria-label': 'GIF asset id' }}
          />
          <TextField
            label="Description (required)"
            size="small"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            helperText="A short accessible description of the GIF. Required to send."
            inputProps={{ 'aria-label': 'GIF description', 'aria-required': true }}
          />
          <TextField
            label="Caption (optional)"
            size="small"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            inputProps={{ 'aria-label': 'GIF caption' }}
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
            <Button size="small" onClick={reset}>Cancel</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default GifComposer;
