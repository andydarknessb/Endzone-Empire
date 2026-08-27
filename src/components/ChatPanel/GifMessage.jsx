import React, { useState } from 'react';
import { Box, Typography, Button, useMediaQuery } from '@mui/material';
import { resolveGifAsset } from '../../lib/gifProvider';
import { shouldShowStillFrame } from '../../lib/reducedMotionMedia';

/**
 * One GIF message's bubble content (#446). A GIF message is a chat message, so
 * this renders INSIDE the ordinary chat row (ChatConversation) beside the Team
 * name, not as a separate feed kind.
 *
 * It has two states, decided by whether the provider registry can resolve the
 * asset (gifProvider.resolveGifAsset):
 *
 *  - UNAVAILABLE (the production default, because no provider is registered
 *    until external approval, AC9): a stable "GIF unavailable" tile that still
 *    shows the caption and the accessible description (AC5), so the message is
 *    never a blank hole and a screen-reader user still hears what was sent.
 *
 *  - AVAILABLE (a provider is registered - in this ticket only the test fake,
 *    AC8): the animation, with a still rendition and an explicit PLAY control
 *    for reduced-motion viewers (AC4).
 *
 * WHY useMediaQuery AND NOT THE sx @media FORM. The house sx pattern (App.jsx:126)
 * turns a CSS property off under prefers-reduced-motion, but it cannot swap one
 * <img src> for another, nor drive the conditional RENDER of an interactive Play
 * control - both of which AC4 needs. The nearest precedent for THIS exact choice
 * (a still frame instead of an animated GIF under prefers-reduced-motion) is
 * TeamAvatar.jsx, and it uses useMediaQuery; this follows that established form.
 * Reduced-motion viewers get the still plus an explicit Play control that swaps
 * to the animation on activation; everyone else gets the animation.
 *
 * The accessible description is the `alt` on the rendition that is shown, so it
 * is announced exactly once whichever state is displayed. All copy uses hyphens,
 * never an em dash (ADR 0016).
 */

// User-facing, hyphens only (ADR 0016 / the guards em-dash check).
const UNAVAILABLE_LABEL = 'GIF unavailable';

function GifMessage({ media, caption = null }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [playing, setPlaying] = useState(false);
  const description = (media && media.description) || '';
  const rendition = resolveGifAsset(media);

  if (!rendition || (!rendition.still && !rendition.animated)) {
    // AC5: unavailable media preserves the caption and description in a stable
    // tile. The description is shown as visible text here (there is no image to
    // carry it as alt), so both sighted and screen-reader users get it.
    return (
      <Box
        data-testid="gif-unavailable"
        sx={{
          mt: 0.5,
          p: 1,
          borderRadius: 'var(--radius-sm)',
          bgcolor: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{UNAVAILABLE_LABEL}</Typography>
        {description && (
          <Typography variant="body2" data-testid="gif-unavailable-description" sx={{ color: 'var(--text-muted)' }}>
            {description}
          </Typography>
        )}
        {caption && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>{caption}</Typography>
        )}
      </Box>
    );
  }

  // The still-versus-animated default is the SHARED reduced-motion decision
  // (reducedMotionMedia.shouldShowStillFrame, also used by TeamAvatar). On top
  // of it, GifMessage lets the viewer press Play to override to the animation -
  // a GifMessage-only concern applied here, not inside the shared helper. A
  // missing still (a provider that returned only the animation) falls back to
  // the animation, since there is nothing to hold on.
  const showStill = shouldShowStillFrame(prefersReducedMotion, rendition.still) && !playing;
  const showAnimation = !showStill;
  const src = showStill ? rendition.still : (rendition.animated || rendition.still);

  return (
    <Box data-testid="gif-message" sx={{ mt: 0.5 }}>
      <Box
        component="img"
        src={src}
        alt={description}
        data-testid={showAnimation ? 'gif-animated' : 'gif-still'}
        sx={{ maxWidth: '100%', borderRadius: 'var(--radius-sm)', display: 'block' }}
      />
      {prefersReducedMotion && !showAnimation && (
        <Button
          size="small"
          data-testid="gif-play"
          onClick={() => setPlaying(true)}
          sx={{ mt: 0.5 }}
        >
          Play GIF
        </Button>
      )}
      {caption && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>{caption}</Typography>
      )}
      {rendition.attribution && (rendition.attribution.source || rendition.attribution.creator) && (
        <Typography variant="caption" data-testid="gif-attribution" sx={{ display: 'block', color: 'var(--text-muted)' }}>
          {[rendition.attribution.source, rendition.attribution.creator].filter(Boolean).join(' · ')}
        </Typography>
      )}
    </Box>
  );
}

export default GifMessage;
