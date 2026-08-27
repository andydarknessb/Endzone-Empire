import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip, useMediaQuery } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
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
 *    AC8): the rendition, governed by a persistent motion TOGGLE.
 *
 * MOTION MODEL (AC4 + WCAG 2.2.2). `motionOverride` is null until the viewer
 * chooses; the DEFAULT then follows the shared reduced-motion decision
 * (reducedMotionMedia.shouldShowStillFrame, also used by TeamAvatar): a
 * reduced-motion viewer defaults to the still (and, generalising "no motion
 * unasked", holds a still-less animation behind Play rather than autoplaying),
 * while everyone else defaults to the animation. The control is a PERSISTENT
 * two-way toggle, not a one-shot button, for two accessibility reasons:
 *  - it never unmounts on activation, so keyboard focus is never stranded on the
 *    document body (the EmojiPicker never-strand-focus rule);
 *  - it gives even an autoplaying (no-preference) viewer a way to STOP the
 *    looping animation, which WCAG 2.2.2 requires.
 * It carries a STABLE accessible name with `aria-pressed` for state and a
 * changing icon, the shape #512 landed on the sound toggle, so the visible
 * affordance and the accessible name cannot drift (WCAG 2.5.3).
 *
 * WHY useMediaQuery AND NOT THE sx @media FORM. The house sx pattern
 * (App.jsx:126) turns a CSS property off under prefers-reduced-motion, but it
 * cannot swap one <img src> for another, nor drive an interactive control - both
 * of which this needs. TeamAvatar.jsx is the precedent for the still-vs-animated
 * choice and uses useMediaQuery; this follows it.
 *
 * The accessible description is the `alt` on the rendition that is shown (or
 * visible text when a still-less animation is held), so it is announced exactly
 * once whichever state is displayed. All copy uses hyphens, never an em dash
 * (ADR 0016).
 */

// User-facing, hyphens only (ADR 0016 / the guards em-dash check).
const UNAVAILABLE_LABEL = 'GIF unavailable';
// One stable accessible name in both states; aria-pressed carries on/off (#512).
const MOTION_TOGGLE_LABEL = 'Play GIF animation';

function GifMessage({ media, caption = null }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // null = follow the motion preference; true/false = the viewer's explicit
  // play/pause choice, which overrides the default.
  const [motionOverride, setMotionOverride] = useState(null);
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

  const hasStill = Boolean(rendition.still);
  const hasAnimated = Boolean(rendition.animated);
  // The DEFAULT (no explicit play/pause yet): the shared reduced-motion decision
  // (also TeamAvatar) says a reduced-motion viewer with a still defaults to the
  // still; generalise "no motion unasked" so a reduced-motion viewer with an
  // animation but NO still also holds it (a Play control, no autoplay).
  const defaultStill = shouldShowStillFrame(prefersReducedMotion, hasStill)
    || (prefersReducedMotion && hasAnimated && !hasStill);
  const animating = hasAnimated && (motionOverride === true || (motionOverride === null && !defaultStill));
  const showStill = hasStill && !animating;
  const imgSrc = animating ? rendition.animated : (showStill ? rendition.still : null);

  return (
    <Box data-testid="gif-message" sx={{ mt: 0.5 }}>
      {imgSrc && (
        <Box
          component="img"
          src={imgSrc}
          alt={description}
          data-testid={animating ? 'gif-animated' : 'gif-still'}
          sx={{ maxWidth: '100%', borderRadius: 'var(--radius-sm)', display: 'block' }}
        />
      )}
      {!imgSrc && description && (
        // A still-less animation held for reduced motion: surface the description
        // as visible text so the bubble is never empty and a screen-reader user
        // still learns what the GIF is before choosing to play it.
        <Typography variant="body2" data-testid="gif-held-description" sx={{ color: 'var(--text-muted)' }}>
          {description}
        </Typography>
      )}
      {hasAnimated && (
        <Tooltip title={MOTION_TOGGLE_LABEL}>
          <IconButton
            size="small"
            data-testid="gif-play"
            aria-label={MOTION_TOGGLE_LABEL}
            aria-pressed={animating}
            onClick={() => setMotionOverride(!animating)}
            sx={{ mt: 0.5 }}
          >
            {animating ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
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
