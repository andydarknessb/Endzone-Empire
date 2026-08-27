import React from 'react';
import { Avatar, useMediaQuery } from '@mui/material';
import { initialsFor } from '../../lib/initials';
import { shouldShowStillFrame } from '../../lib/reducedMotionMedia';

/**
 * A team's logo/photo (or animated GIF) with an initials fallback when no
 * avatar has been uploaded — the same convention as PlayerAvatar. When the
 * viewer has prefers-reduced-motion enabled and a static-frame variant is
 * available (only animated GIF uploads have one — see the design doc), that
 * static frame is shown instead of the animated original. The still-versus-
 * animated DECISION lives in one shared place, lib/reducedMotionMedia
 * (shouldShowStillFrame), which GifMessage (#446) also calls, so every call
 * site here (including DraftPresenter) gets correct behavior just by passing
 * both URLs through and the rule cannot drift between the two surfaces that use
 * it.
 */
function TeamAvatar({ name, avatarUrl, avatarStaticUrl, size = 32 }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const src = (shouldShowStillFrame(prefersReducedMotion, avatarStaticUrl) ? avatarStaticUrl : avatarUrl) || undefined;
  return (
    <Avatar
      // Deliberately no `alt`: MUI's Avatar resolves an <img> with an alt
      // attribute (including alt="") to role "presentation", not "img". The
      // aria-hidden="true" below already removes this subtree from the
      // accessibility tree, so the missing alt isn't a defect to fix -
      // adding one (even alt="") flips the resolved role and breaks the
      // four `getByRole('img', { hidden: true })` queries that depend on
      // it staying "img": TeamAvatar.test.jsx (three sites) and
      // PowerRankings.test.jsx (one site). See #327.
      aria-hidden="true"
      src={src}
      imgProps={{ loading: 'lazy' }}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: 'action.selected',
        // Initials need to clear AA against the tinted fill in both themes;
        // text.secondary was short of it on dark.
        color: 'text.primary',
      }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

export default TeamAvatar;
