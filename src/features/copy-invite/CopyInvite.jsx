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

export function joinLink(code) {
  return `${window.location.origin}/#/league/join?code=${encodeURIComponent(code)}`;
}

export default function CopyInvite({ code }) {
  const [copied, setCopied] = useState(false);
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
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), REVERT_MS);
    } catch {
      // A blocked clipboard leaves the label on "Invite": the copy simply does
      // not confirm, rather than throwing at the manager.
    }
  }, [code]);

  if (!code) return null;

  return (
    <Button
      type="button"
      variant="outlined"
      size="small"
      onClick={handleCopy}
      // The dashboard island's own tokens (ADR 0020): dim label + ink code over
      // the page background (`dash-bg`), both registered pairings in
      // tokens.contrast.test.js. Hover lifts the label to ink and the border to
      // the accent line, matching the mockup's `.invite-btn`.
      sx={{
        textTransform: 'none',
        gap: 0.75,
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
  );
}
