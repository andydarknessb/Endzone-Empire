import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { PixelCheck, PsButton, SR_ONLY_SX } from '../../shared/ui/playselect';

/**
 * Copy-invite feature (ADR 0020). Renders the commissioner's share control: a
 * button that writes the full join link to the clipboard and confirms.
 *
 * Play-select look (ADR 0067 wave 1b; the League Dashboard is its only composer): a ghost button,
 * square and 44px, "Invite" with the code in Archivo 600 letter-spaced tabular figures, then
 * "Copied" with a pixel check for two seconds (a word and a shape, never a colour change). Paints
 * only ps-* tokens, so it belongs inside a Play-select page root.
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
      <PsButton variant="ghost" onClick={handleCopy}>
        {copied ? (
          <>
            <PixelCheck />
            Copied
          </>
        ) : (
          <>
            Invite
            <Box component="span" sx={{ fontWeight: 600, letterSpacing: '.08em', fontVariantNumeric: 'tabular-nums' }}>
              {code}
            </Box>
          </>
        )}
      </PsButton>
      {/* Polite so it never interrupts; empty until the first copy, so it does
          not announce on mount. */}
      <Box component="span" role="status" aria-live="polite" sx={SR_ONLY_SX}>
        {announcement}
      </Box>
    </>
  );
}
