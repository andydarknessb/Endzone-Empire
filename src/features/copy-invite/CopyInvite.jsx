import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';

/**
 * Copy-invite feature (ADR 0020). Renders the commissioner's share control: a
 * button that writes the full join link to the clipboard and confirms.
 *
 * The presence rule lives above this component, in the page: the server strips
 * `invite_code` from the league payload for non-commissioners, so the page
 * mounts this only when a code is present. This component still returns null on
 * a missing code so it is safe to render defensively.
 *
 * The link is the same hash-route shape the legacy dashboard builds today
 * (`<origin>/#/league/join?code=<code>`): HashRouter keeps the route and query
 * behind the '#', and the recipient lands on the join form with the code
 * pre-filled. `encodeURIComponent` matches the legacy builder so a code with a
 * URL-special character survives the round trip.
 */
const REVERT_MS = 2000;

// Standard visually-hidden pattern: off-screen for sighted users, still in the
// accessibility tree so a screen reader announces the copy result.
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function joinLink(code) {
  return `${window.location.origin}/#/league/join?code=${encodeURIComponent(code)}`;
}

export default function CopyInvite({ code }) {
  const [copied, setCopied] = useState(false);
  // A polite live-region message, separate from the button label: the label
  // swap ("Invite" -> "Copied") is for sighted users, and a change to an
  // already-focused button's name is announced inconsistently across screen
  // readers, so success (and a blocked-clipboard failure) are announced here
  // instead. Distinguishing the two also gives the silent catch below a voice.
  const [announcement, setAnnouncement] = useState('');
  // The revert timer is cleared on unmount so a copy near the end of a test (or
  // a manager navigating away) never flips state on an unmounted component.
  const timerRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(joinLink(code));
      setCopied(true);
      setAnnouncement('Invite link copied');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), REVERT_MS);
    } catch {
      // A blocked clipboard leaves the label on "Invite": the copy simply does
      // not confirm rather than throwing at the manager, but AT still hears why.
      setAnnouncement('Could not copy the invite link');
    }
  }, [code]);

  if (!code) return null;

  return (
    <>
      <Button
        type="button"
        variant="outlined"
        size="small"
        onClick={handleCopy}
        // The dashboard island's own tokens (ADR 0020): dim label + ink code
        // over the page background (`dash-bg`), both registered pairings in
        // tokens.contrast.test.js. Hover lifts the label to ink and the border
        // to the accent line, matching the mockup's `.invite-btn`.
        sx={{
          textTransform: 'none',
          gap: 0.75,
          // The 44px touch floor, phone widths only. Breakpoint-scoped rather
          // than the flat MIN_TOUCH_TARGET_SX because this is a size="small"
          // outlined control the artboard draws short: an unconditional 44
          // would grow it by 14px on desktop, where a pointer needs no floor.
          // It measured 29.88px at every width before this.
          minHeight: { xs: 44, md: 'auto' },
          color: 'var(--dash-dim)',
          borderColor: 'var(--dash-line-strong)',
          borderRadius: 'var(--dash-radius-sm)',
          fontFamily: 'var(--dash-font-body)',
          fontWeight: 600,
          fontSize: '12.5px',
          letterSpacing: '0.02em',
          '&:hover': {
            color: 'var(--dash-ink)',
            borderColor: 'var(--dash-accent-line)',
            backgroundColor: 'transparent',
          },
        }}
      >
        {copied ? (
          'Copied'
        ) : (
          <>
            Invite{' '}
            <Box
              component="code"
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '12px',
                color: 'var(--dash-ink)',
              }}
            >
              {code}
            </Box>
          </>
        )}
      </Button>
      {/* Polite so it never interrupts; empty until the first copy, so it does
          not announce on mount. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </>
  );
}
