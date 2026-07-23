import React from 'react';
import { Avatar, useMediaQuery } from '@mui/material';
import { initialsFor } from '../../lib/initials';

/**
 * A team's logo/photo (or animated GIF) with an initials fallback when no
 * avatar has been uploaded — the same convention as PlayerAvatar. When the
 * viewer has prefers-reduced-motion enabled and a static-frame variant is
 * available (only animated GIF uploads have one — see the design doc), that
 * static frame is shown instead of the animated original. This is the only
 * place that choice is made, so every call site (including DraftPresenter)
 * gets correct behavior just by passing both URLs through.
 */
function TeamAvatar({ name, avatarUrl, avatarStaticUrl, size = 32 }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const src = (prefersReducedMotion && avatarStaticUrl) || avatarUrl || undefined;
  return (
    <Avatar
      aria-hidden="true"
      src={src}
      imgProps={{ loading: 'lazy' }}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: 'action.selected',
        color: 'text.secondary',
      }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

export default TeamAvatar;
